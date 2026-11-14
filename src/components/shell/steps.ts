// The building screens, in demo order (SPEC §2). The rail shows the first five
// as the run's steps and Drill set apart after a divider (DESIGN.md, Layout).

export const STEPS = [
  { segment: "scout", label: "Scout" },
  { segment: "dossier", label: "Dossier" },
  { segment: "plan", label: "Plan" },
  { segment: "run", label: "Run" },
  { segment: "debrief", label: "Debrief" },
  { segment: "drill", label: "Drill" },
] as const;

export type StepSegment = (typeof STEPS)[number]["segment"];
export type StepState = "done" | "current" | "upcoming";

export function isStepSegment(value: string | null | undefined): value is StepSegment {
  return STEPS.some((step) => step.segment === value);
}

/**
 * Each step's state for the rail. The demo walks the steps in order, so every
 * step before the current one is shown done. With no current step (an unknown
 * segment), nothing is done or current.
 */
export function stepStates(current: string | null | undefined): Record<StepSegment, StepState> {
  const index = STEPS.findIndex((step) => step.segment === current);
  const states = {} as Record<StepSegment, StepState>;
  STEPS.forEach((step, i) => {
    states[step.segment] = index < 0 ? "upcoming" : i < index ? "done" : i === index ? "current" : "upcoming";
  });
  return states;
}

/** The step after `current`, for a screen's primary action; none after Drill. */
export function nextStep(current: StepSegment): (typeof STEPS)[number] | undefined {
  const index = STEPS.findIndex((step) => step.segment === current);
  return STEPS[index + 1];
}
