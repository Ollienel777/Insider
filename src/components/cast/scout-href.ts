// Where picking a finalist goes: its Scout, carrying the chosen mission as
// `?m=` (SPEC §2 beat 3, §4). One small function on purpose: issue 119 adds the
// helper that builds every `/b/[id]/…` href with `?m=`, and replaces this.
export function scoutHref(buildingId: string, missionId: string): string {
  return `/b/${encodeURIComponent(buildingId)}/scout?m=${encodeURIComponent(missionId)}`;
}
