import Link from "next/link";
import { Check } from "lucide-react";
import { buildingHref } from "@/lib/building-href";
import { cn } from "@/lib/utils";
import { STEPS, stepStates, type StepState } from "./steps";

const RUN_STEPS = STEPS.filter((step) => step.segment !== "drill");
const DRILL = STEPS.find((step) => step.segment === "drill")!;

function StepLink({ href, label, state }: { href: string; label: string; state: StepState }) {
  return (
    <Link
      href={href}
      aria-current={state === "current" ? "page" : undefined}
      data-state={state}
      className={cn(
        // The 2px underline sits on the rail's bottom edge, over its border.
        // Tighter below md, so the rail with five steps done (Drill) fits 390px without scrolling the page (#71).
        "relative inline-flex h-11 items-center gap-1 rounded-sm px-1 text-sm md:gap-2 md:px-3 transition-colors duration-fast",
        "after:absolute after:inset-x-1 md:after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:transition-colors after:duration-fast",
        state === "current"
          ? "font-medium text-text-1 after:bg-accent"
          : "text-text-2 after:bg-transparent hover:text-text-1",
      )}
    >
      {state === "done" ? <Check aria-hidden className="size-4 stroke-[1.5] text-text-2" /> : null}
      {label}
      {state === "done" ? <span className="sr-only">(done)</span> : null}
    </Link>
  );
}

/** The rail itself, with the current step given; `StepRail` supplies it from the route. */
export function StepRailView({
  buildingId,
  current,
  missionId = null,
}: {
  buildingId: string;
  current: string | null;
  /** The chosen mission, carried on every step as `?m=` (issue 119). */
  missionId?: string | null;
}) {
  const states = stepStates(current);
  const href = (segment: string) => buildingHref(buildingId, segment, missionId);
  return (
    <nav aria-label="Steps" className="border-b border-border bg-surface-1 px-1 md:px-3">
      <ol className="flex h-11 items-center">
        {RUN_STEPS.map((step) => (
          <li key={step.segment}>
            <StepLink href={href(step.segment)} label={step.label} state={states[step.segment]} />
          </li>
        ))}
        <li aria-hidden className="ml-auto h-5 w-px bg-border" />
        <li className="pl-1 md:pl-3">
          <StepLink href={href(DRILL.segment)} label={DRILL.label} state={states[DRILL.segment]} />
        </li>
      </ol>
    </nav>
  );
}
