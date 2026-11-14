// The briefed crew plan, carried from Plan into Run (SPEC §2 beats 4 to 5).
// The Plan screen keeps the crew's latest answer in localStorage, beside the
// run log; the Run screen follows it as the panel's plan. Storage can be
// blocked or full, so every read and write may quietly do nothing: even
// reaching `localStorage` throws when site data is blocked.
import { CrewPlan } from "@/domain";

export interface StoredCrewPlan {
  plan: CrewPlan;
  /** True when a recorded reply answered, not a live model. */
  recorded: boolean;
}

export const crewPlanKey = (buildingId: string) => `heist:crew-plan:${buildingId}`;

/** The browser's storage, read inside the caller's `try`: the getter itself throws when site data is blocked. */
const browserStorage = (): Storage | undefined => globalThis.localStorage;

export function saveCrewPlan(buildingId: string, stored: StoredCrewPlan, storage?: Pick<Storage, "setItem">): void {
  try {
    (storage ?? browserStorage())?.setItem(crewPlanKey(buildingId), JSON.stringify(stored));
  } catch {
    // The plan on screen still stands; only the hand-off to Run is lost.
  }
}

/** The stored plan, or null when there is none or it no longer parses. */
export function loadCrewPlan(buildingId: string, storage?: Pick<Storage, "getItem">): StoredCrewPlan | null {
  try {
    const raw = (storage ?? browserStorage())?.getItem(crewPlanKey(buildingId));
    if (!raw) return null;
    const value = JSON.parse(raw) as { plan?: unknown; recorded?: unknown };
    const plan = CrewPlan.safeParse(value.plan);
    return plan.success ? { plan: plan.data, recorded: value.recorded === true } : null;
  } catch {
    return null;
  }
}
