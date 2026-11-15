import Link from "next/link";
import { Check, Lock } from "lucide-react";
import { buildingHref } from "@/lib/building-href";
import { cn } from "@/lib/utils";
import { FACTS_ONLY_NOTE, FACTS_ONLY_STEPS, STEPS, stepStates, type StepSegment, type StepState } from "./steps";

// The steps as folder tabs on the case file's top edge (issue 166). A step you
// have not reached yet is pushed back into the stack, shaded and locked; Owner
// Mode is always open. The row never wraps: the tabs shrink first.
const TAB = cn(
  "relative inline-flex h-10 min-w-0 shrink items-center gap-1.5 overflow-hidden rounded-t-[12px] border-[3px] border-b-0 border-border-strong",
  "px-[clamp(6px,0.9vw,12px)] font-hand text-[clamp(12px,1.05vw,15px)] whitespace-nowrap",
  "transition-transform duration-fast ease-out",
);
const NUM = "grid h-5 min-w-5 shrink-0 place-items-center rounded-[6px] border-2 border-border-strong bg-n-950 px-1 font-display text-xs leading-none";

function StepLink({ href, label, n, state }: { href: string; label: string; n: number; state: StepState }) {
  return (
    <Link
      href={href}
      aria-current={state === "current" ? "page" : undefined}
      data-state={state}
      className={cn(
        TAB,
        state === "current"
          ? "z-10 translate-y-0 bg-manila text-text-1"
          : "translate-y-[5px] bg-manila-2 text-text-1 hover:translate-y-[2px]",
      )}
    >
      <span aria-hidden className={NUM}>{n}</span>
      {state === "done" ? <Check aria-hidden className="size-4 shrink-0 stroke-[2.5] text-success" /> : null}
      <span className="min-w-0 truncate">{label}</span>
      {state === "done" ? <span className="sr-only">(done)</span> : null}
    </Link>
  );
}

/** A step not reached yet, or one a building does not have: shown in the stack, shaded, not linked. */
function StepLocked({ label, n, why, state }: { label: string; n: number; why: string; state: string }) {
  return (
    <span
      aria-disabled="true"
      title={why}
      data-state={state}
      className={cn(TAB, "translate-y-[9px] cursor-not-allowed bg-manila-locked text-text-1/55")}
    >
      <span aria-hidden className={cn(NUM, "bg-n-800")}>{n}</span>
      <span className="min-w-0 truncate">{label}</span>
      <Lock aria-hidden className="size-3.5 shrink-0 stroke-[2.5] opacity-60" />
      <span className="sr-only"> ({why})</span>
    </span>
  );
}

/** The rail itself, with the current step given; `StepRail` supplies it from the route. */
export function StepRailView({
  buildingId,
  current,
  missionId = null,
  factsOnly = false,
}: {
  buildingId: string;
  current: string | null;
  /** The chosen mission, carried on every step as `?m=` (issue 119). */
  missionId?: string | null;
  /** A kit building (`isFactsOnly`): only Scout and the Dossier are linked; the rest are shown off. */
  factsOnly?: boolean;
}) {
  const states = stepStates(current);
  const href = (segment: string) => buildingHref(buildingId, segment, missionId);
  const owner = current === "owner";
  const steps = STEPS.map((s, i) => ({ ...s, n: i + 1 }));
  const renderStep = ({ segment, label, n }: { segment: StepSegment; label: string; n: number }, i: number) => {
    if (factsOnly && !FACTS_ONLY_STEPS.includes(segment)) return <StepLocked label={label} n={n} why={FACTS_ONLY_NOTE} state="off" />;
    // On Owner Mode every step is open: the owner came from a finished run.
    if (!owner && states[segment] === "upcoming") {
      const before = steps[i - 1]?.label ?? "the step before";
      return <StepLocked label={label} n={n} why={`Finish ${before} first`} state="upcoming" />;
    }
    return <StepLink href={href(segment)} label={label} n={n} state={owner ? "done" : states[segment]} />;
  };
  return (
    <nav aria-label="Steps" className="min-w-0 flex-1 pl-[clamp(8px,1.6vw,22px)]">
      <ol className="flex min-w-0 flex-nowrap items-end gap-1">
        {steps.map((s, i) => (
          <li key={s.segment} className="flex min-w-0 shrink">
            {renderStep(s, i)}
          </li>
        ))}
        {factsOnly ? null : (
          <li className="flex min-w-0 shrink">
            <StepLink href={href("owner")} label="Owner Mode" n={steps.length + 1} state={owner ? "current" : "upcoming"} />
          </li>
        )}
      </ol>
    </nav>
  );
}
