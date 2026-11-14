// The one way to link to a building screen (#119): every `/b/[id]/…` address
// carries the chosen mission as `?m=<missionId>` (SPEC §4), so a link or a
// router call built anywhere else would drop it. A test fails any raw
// `/b/${…}` link outside this file.

/** `/b/<id>/<screen>?m=<missionId>`; without a mission, the building's page picks its own and redirects. */
export function buildingHref(buildingId: string, screen: string, missionId?: string | null): string {
  const path = `/b/${encodeURIComponent(buildingId)}/${screen}`;
  return missionId ? `${path}?m=${encodeURIComponent(missionId)}` : path;
}
