"use client";

// What E is doing, on the first-person HUD: the label under the crosshair
// with a ring that fills over the hold, the toast when the objective is
// taken (the objective line's carry chip, #192, stays for the rest of the
// run), and a live region that says each as it lands. What they show comes
// from action.ts; under reduced motion the ring jumps and nothing fades.
import { CircleCheck, FolderClosed } from "lucide-react";
import { cn } from "@/lib/utils";
import { ringFill, type ActionLabel } from "./action";

const KEYFRAMES = `
@keyframes fp-action-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes fp-ring { from { stroke-dashoffset: var(--fp-ring-from) } to { stroke-dashoffset: var(--fp-ring-to) } }
@media (prefers-reduced-motion: reduce) { [data-fp-action-motion] { animation: none !important; transition: none !important } }
`;

const RING_R = 9;
const RING_C = 2 * Math.PI * RING_R;

/** Under the crosshair: "Hold E · Pick the lock", "Picking the lock…" with its ring, or "Lock picked · Door open". */
export function ActionLabelView({ label, turnMs, still }: { label: ActionLabel; turnMs: number; still: boolean }) {
  const landed = label.phase === "landed";
  const fill = ringFill(label, still);
  return (
    <>
      <style>{KEYFRAMES}</style>
      <div
        data-testid="fp-action"
        data-phase={label.phase}
        data-kind={label.kind}
        data-fp-action-motion
        className={cn(
          "pointer-events-none absolute top-1/2 left-1/2 mt-6 flex -translate-x-1/2 items-center gap-2.5 rounded-md border bg-surface-1/92 px-3.5 py-2 text-base whitespace-nowrap text-text-1 shadow-e-1",
          landed ? "border-success" : "border-border",
        )}
        style={{ animation: landed ? `fp-action-in var(--t-base) var(--ease)` : undefined }}
      >
        {landed ? (
          <>
            <CircleCheck aria-hidden className="size-5 shrink-0 stroke-[1.75] text-success" />
            <span className="font-semibold">{label.text}</span>
          </>
        ) : (
          <>
            {label.phase === "hold" || label.done > 0 ? <Ring fill={fill} turnMs={turnMs} done={label.done} /> : null}
            {label.phase === "hold" ? (
              <span className="font-semibold">{label.words.doing}</span>
            ) : (
              <span className="flex items-center gap-2">
                <span className="text-text-2">Hold</span>{" "}
                <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-sm border border-border-strong bg-surface-2 px-1.5 font-mono text-xs text-text-1">E</kbd>{" "}
                <span aria-hidden className="text-text-3">·</span>{" "}
                <span className="font-semibold">{label.words.prompt}</span>
              </span>
            )}
            {label.kind === "pick" && label.of > 1 && (label.phase === "hold" || label.done > 0) ? (
              <span data-testid="fp-action-count" className="font-mono text-sm text-text-2 tabular-nums">
                {label.done}/{label.of}
              </span>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

/** A ring that fills to `fill.now`, then on to `fill.towards` over a turn, restarted at each pick (keyed on `done`). */
function Ring({ fill, turnMs, done }: { fill: { now: number; towards: number }; turnMs: number; done: number }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-6 shrink-0 -rotate-90" data-testid="fp-action-ring">
      <circle cx="12" cy="12" r={RING_R} fill="none" stroke="var(--n-600)" strokeWidth="3" />
      <RingArc key={done} fill={fill} turnMs={turnMs} />
    </svg>
  );
}

function RingArc({ fill, turnMs }: { fill: { now: number; towards: number }; turnMs: number }) {
  const moving = fill.towards > fill.now;
  return (
    <circle
      cx="12"
      cy="12"
      r={RING_R}
      fill="none"
      stroke="var(--text-1)"
      strokeWidth="3"
      strokeLinecap="round"
      strokeDasharray={RING_C}
      data-fp-action-motion
      style={{
        strokeDashoffset: RING_C * (1 - fill.towards),
        // Starts at `now` and runs on to `towards` over the turn: the next pick lands as it fills.
        animation: moving ? `fp-ring ${turnMs}ms linear both` : undefined,
        ["--fp-ring-from" as string]: `${RING_C * (1 - fill.now)}`,
        ["--fp-ring-to" as string]: `${RING_C * (1 - fill.towards)}`,
      }}
    />
  );
}

/** The toast the turn the objective is taken: "Files collected", and the way on. */
export function PickupToast({ title, line }: { title: string; line: string }) {
  return (
    <div
      data-testid="fp-pickup"
      data-fp-action-motion
      className="pointer-events-none absolute top-28 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-md border border-success bg-surface-1 px-4 py-3 shadow-e-2"
      style={{ animation: "fp-action-in var(--t-slow) var(--ease)" }}
    >
      <FolderClosed aria-hidden className="size-5 shrink-0 stroke-[1.75] text-success" />
      <span className="flex flex-col">
        <span className="text-base font-semibold text-text-1">{title}</span>
        <span className="text-sm text-text-2">{line}</span>
      </span>
    </div>
  );
}

/** Says what landed, once, to a screen reader. */
export function ActionAnnouncer({ text }: { text: string | null }) {
  return (
    <p data-testid="fp-announce" role="status" aria-live="polite" className="sr-only">
      {text ?? ""}
    </p>
  );
}
