// The chosen mission of a building screen, read from `?m=` (SPEC §4, #119).
// Server only. An address with no `m` (an old link, the map) is redirected to
// the same screen with the building's own mission (F1 → `romaine-1974`), so
// the address always says which level is on screen. A building that has no
// own mission needs an `m`: without one it is a 404, as is an `m` that names
// no mission, except on the screens that need no level (`optionalMissionParam`).
// A repeated `m` reads its first value.
import { notFound, redirect } from "next/navigation";
import { defaultMissionId, findMission } from "@/agents/builder/missions";
import { buildingHref } from "./building-href";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The first `m` of the query, or null when there is none or it is empty. */
export function firstM(m: string | string[] | undefined): string | null {
  const first = Array.isArray(m) ? m[0] : m;
  return first ? first : null;
}

export interface MissionParamOptions {
  /** Keep an `m` that names no mission instead of a 404: for a screen that reads no level (Drill). */
  tolerant?: boolean;
}

export async function missionParam(
  buildingId: string,
  screen: string,
  searchParams: SearchParams,
  options: MissionParamOptions = {},
): Promise<string> {
  const m = firstM((await searchParams).m);
  if (m) {
    if (!findMission(m) && !options.tolerant) notFound();
    return m;
  }
  const own = defaultMissionId(buildingId);
  if (!own) notFound();
  redirect(buildingHref(buildingId, screen, own));
}

/**
 * As `missionParam`, but a building with no own mission and no `m` (a kit
 * building opened from the map) reads as null instead of a 404: for the
 * screens such a building still has, Scout and the Dossier's facts. Every
 * other address behaves exactly as `missionParam`.
 */
export async function optionalMissionParam(
  buildingId: string,
  screen: string,
  searchParams: SearchParams,
): Promise<string | null> {
  if (!firstM((await searchParams).m) && !defaultMissionId(buildingId)) return null;
  return missionParam(buildingId, screen, searchParams);
}
