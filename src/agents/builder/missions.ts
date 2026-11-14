// The mission library the Game Master picks from (SPEC §4.6), read from
// fixtures/missions.json and parsed against `Mission` when this module loads,
// so a malformed library fails at startup, not in a briefing.
import { z } from "zod";
import { checkUnique, type City, Mission } from "@/domain";
import finalists from "../../../fixtures/inventory-finalists.json";
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
 * The mission a building stages when no `?m=` names one (#119): the mission
 * whose recorded finalists put this building first, as SPEC §7 casts each
 * fixture building for its own mission (F1 → `romaine-1974`). Null for a
 * building no mission casts first.
 */
export function defaultMissionId(buildingId: string): string | null {
  const entry = Object.entries(finalists as Record<string, string[]>).find(([, ids]) => ids[0] === buildingId);
  return entry && findMission(entry[0]) ? entry[0] : null;
}
