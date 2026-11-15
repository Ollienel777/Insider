"use client";

// What E is doing, on the first-person HUD: the label under the crosshair
// with the engine's pick count (the door's own ring, actors.ts, is the one
// progress ring), the toast when the objective is
// taken (the objective line's carry chip, issue 192, stays for the rest of the
// run), and a live region that says each as it lands. What they show comes
// from action.ts; under reduced motion nothing fades.
import { CircleCheck, FolderClosed } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActionLabel } from "./action";

const KEYFRAMES = `
@keyframes fp-action-in { from { opacity: 0 } to { opacity: 1 } }
@media (prefers-reduced-motion: reduce) { [data-fp-action-motion] { animation: none !important; transition: none !important } }
`;

/** Under the crosshair: "Hold E · Pick the lock", "Picking the lock… 1/2", or "Lock picked · Door open". */
export function ActionLabelView({ label }: { label: ActionLabel }) {
  const landed = label.phase === "landed";
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
