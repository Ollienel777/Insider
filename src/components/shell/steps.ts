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

/**
 * A building from the CoStar data kit (`source: "costar"`) has facts and no
 * level: nothing builds one for it, so only Scout and the Dossier's facts
 * exist. Every other step is a 404 for it, and the screens must not offer one.
 */
export function isFactsOnly(source: string | undefined): boolean {
  return source === "costar";
}

/** The steps a facts-only building has. */
export const FACTS_ONLY_STEPS: readonly StepSegment[] = ["scout", "dossier"];

/** Why a facts-only building offers no further step, in the map's "Facts only" wording. */
export const FACTS_ONLY_NOTE = "Facts only: no level is built for this building.";

/** Why a kit building's level can't be built while the model is forced to fixtures; the Dossier's and the cast card's wording. */
export const MODEL_FORCED_NOTE =
  "The model is forced to fixtures in the demo settings, so the Level Builder can't build this level. Turn the model back on there to build it.";

/** Why a kit building's level can't be built while the model is configured on fixtures; the Dossier's and the cast card's wording. */
export const MODEL_FIXTURES_NOTE = "The model is on fixtures, so the Level Builder can't build this level here. It needs the live model.";
