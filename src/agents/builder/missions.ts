// The mission library the Game Master picks from (SPEC §4.6), read from
// fixtures/missions.json and parsed against `Mission` when this module loads,
// so a malformed library fails at startup, not in a briefing.
import { z } from "zod";
import { checkUnique, type City, Mission } from "@/domain";
import finalists from "../../../fixtures/inventory-finalists.json";
import { showcaseMission } from "@/lib/showcase";
import raw from "../../../fixtures/missions.json";

const Library = z.array(Mission).superRefine((missions, ctx) =>
  checkUnique(
    missions.map((m) => m.id),
    "mission",
    [],
    ctx,
  ),
);

export const MISSIONS: readonly Mission[] = Object.freeze(Library.parse(raw));

/** The missions staged in `city`, as copies, in library order. */
export function missionsFor(city: City, library: readonly Mission[] = MISSIONS): Mission[] {
  return library.filter((m) => m.city === city).map((m) => structuredClone(m));
}

/** The library mission with this id, or undefined. */
export function findMission(id: string, library: readonly Mission[] = MISSIONS): Mission | undefined {
  return library.find((m) => m.id === id);
}

/**
 * The mission a building stages when no `?m=` names one (#119): its "own"
 * mission. SPEC §7 gives each fixture building one (F1 → `romaine-1974`) and
 * C1 makes each the first finalist of that mission's funnel, but no fixture
 * carries it as a field. The one place that records it is
 * fixtures/inventory-finalists.json, the finalists each mission's funnel ends
 * with, so this reads it there: the mission that casts this building first.
 * A showcase kit building (`SHOWCASE_LEVELS`, #93) stages its paired
 * mission. Null for any other building (an inventory property, a live id).
 */
export function defaultMissionId(buildingId: string): string | null {
  const entry = Object.entries(finalists as Record<string, string[]>).find(([, ids]) => ids[0] === buildingId);
  if (entry && findMission(entry[0])) return entry[0];
  // A showcase kit building stages the mission it is paired with (#93).
  const paired = showcaseMission(buildingId);
  return paired && findMission(paired) ? paired : null;
}
