// The chosen mission of a building screen, read from `?m=` (SPEC §4, #119).
// Server only. An address with no `m` (an old link, the map) is redirected to
// the same screen with the building's own mission (F1 → `romaine-1974`), so
// the address always says which level is on screen; a building no mission
// casts first stays without one. An `m` that names no mission is a 404.
import { notFound, redirect } from "next/navigation";
import { defaultMissionId, findMission } from "@/agents/builder/missions";
import { buildingHref } from "./building-href";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function missionParam(buildingId: string, screen: string, searchParams: SearchParams): Promise<string | null> {
  const m = (await searchParams).m;
  if (typeof m === "string" && m !== "") {
    if (!findMission(m)) notFound();
    return m;
  }
  const own = defaultMissionId(buildingId);
  if (own) redirect(buildingHref(buildingId, screen, own));
  return null;
}
