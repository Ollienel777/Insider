// The briefed crew plan, carried from Plan into Run (SPEC §2 beats 4 to 5).
// The Plan screen keeps the crew's latest answer in localStorage, beside the
// run log; the Run screen follows it as the panel's plan. Storage can be
// blocked or full, so every read and write may quietly do nothing: even
// reaching `localStorage` throws when site data is blocked.
//
// A CoStar kit building's plan is derived from a level built from its real
// record, and nothing from a kit record is stored (#93, #95). So its plan
// lives in this module's memory instead, like a scanned board's run log
// (run-log-store.ts): it reaches the Run on a client-side navigation, and a
// full reload forgets it.
import { CrewPlan } from "@/domain";

export interface StoredCrewPlan {
  plan: CrewPlan;
  /** True when a recorded reply answered, not a live model. */
  recorded: boolean;
  /** Set when no reply came and the plan was worked out from the board (issue 140), so the Run says so too. */
  source?: "board";
}

/** Keyed by building and mission (issue 119), like the run log. */
export const crewPlanKey = (buildingId: string, missionId?: string | null) =>
  missionId ? `heist:crew-plan:${buildingId}:${missionId}` : `heist:crew-plan:${buildingId}`;

/** The browser's storage, read inside the caller's `try`: the getter itself throws when site data is blocked. */
const browserStorage = (): Storage | undefined => globalThis.localStorage;

/** Kit buildings' plans, by storage key (building and mission): never written to storage. */
const held = new Map<string, StoredCrewPlan>();

/**
 * Hands the plan to the Run. `inMemory` (a kit building) keeps it in this
 * module's memory and removes any copy in storage under its key.
 */
export function saveCrewPlan(
  buildingId: string,
  stored: StoredCrewPlan,
  storage?: Pick<Storage, "setItem"> & Partial<Pick<Storage, "removeItem">>,
  missionId?: string | null,
  inMemory = false,
): void {
  const key = crewPlanKey(buildingId, missionId);
  if (inMemory) held.set(key, stored);
  else held.delete(key);
  try {
    const store = storage ?? browserStorage();
    if (inMemory) store?.removeItem?.(key);
    else store?.setItem(key, JSON.stringify(stored));
  } catch {
    // The plan on screen still stands; only the hand-off to Run is lost.
  }
}

/**
 * The plan held in memory (a kit building's), else the stored one; null when there is none or it no
 * longer parses. `inMemory` (a kit building) reads only memory and removes a copy stored before #95.
 */
export function loadCrewPlan(
  buildingId: string,
  storage?: Pick<Storage, "getItem"> & Partial<Pick<Storage, "removeItem">>,
  missionId?: string | null,
  inMemory = false,
): StoredCrewPlan | null {
  const key = crewPlanKey(buildingId, missionId);
  const kept = held.get(key) ?? null;
  try {
    const store = storage ?? browserStorage();
    if (inMemory) {
      store?.removeItem?.(key);
      return kept;
    }
    if (kept) return kept;
    const raw = store?.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as { plan?: unknown; recorded?: unknown; source?: unknown };
    const plan = CrewPlan.safeParse(value.plan);
    return plan.success ? { plan: plan.data, recorded: value.recorded === true, ...(value.source === "board" && { source: "board" as const }) } : null;
  } catch {
    // Blocked storage still leaves the plan held in memory.
    return kept;
  }
}
