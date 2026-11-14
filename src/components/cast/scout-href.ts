import { buildingHref } from "@/lib/building-href";

// Where picking a finalist goes: its Scout, carrying the chosen mission as
// `?m=` (SPEC §2 beat 3, §4), built by the one building-href helper (#119).
export function scoutHref(buildingId: string, missionId: string): string {
  return buildingHref(buildingId, "scout", missionId);
}
