// The one way to link to a building screen (#119): every `/b/[id]/…` address
// carries the chosen mission as `?m=<missionId>` (SPEC §4), so a link or a
// router call built anywhere else would drop it. A test fails any raw
// `/b/${…}` link outside this file.

/**
 * `/b/<id>/<screen>?m=<missionId>`. The mission is required: pass `null`
 * only where no mission is chosen yet (the map), and the building's page
 * then redirects to the building's own mission, or 404s when it has none.
 */
export function buildingHref(buildingId: string, screen: string, missionId: string | null): string {
  const path = `/b/${encodeURIComponent(buildingId)}/${screen}`;
  return missionId ? `${path}?m=${encodeURIComponent(missionId)}` : path;
}
