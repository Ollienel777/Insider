// Where a kit building's level comes from, said plainly on the Dossier, the
// Run and the Why card (#95). A CoStar kit building's facts are its real
// record; its floor is its real Matterport scan only when the board actually
// stands on the scan. When Matterport is on fixtures, or the scan can't hold
// the level (scan-fallback.ts), the board is a stand-in fixture floor and the
// label says so. A fixture building (F1–F5) gets no label: it renders as before.
import type { Building, FloorGraph, ProvenanceLayer } from "@/domain";

/** Which floor a kit building's level stands on. */
export type FloorPlan = "scan" | "stand-in";

export const REAL_SCAN_LABEL = "Real CoStar record · real Matterport scan";
export const STAND_IN_LABEL = "Real CoStar record · stand-in floor plan";

/** The label for a building on `floor`; null for a fixture building. */
export function recordLabel(source: Building["source"] | undefined, floor: FloorPlan): string | null {
  if (source !== "costar") return null;
  return floor === "scan" ? REAL_SCAN_LABEL : STAND_IN_LABEL;
}

/**
 * The floor the Dossier can promise before any floor loads: the building's
 * scan when it has one and Matterport serves live, else the stand-in. The Run
 * says what it actually placed on (`placedFloor`).
 */
export function expectedFloor(building: Pick<Building, "matterportModelId">, matterportLive: boolean): FloorPlan {
  return building.matterportModelId && matterportLive ? "scan" : "stand-in";
}

/** The floor the Run placed the level on: the scan only when the floor came from Matterport. */
export function placedFloor(source: FloorGraph["source"]): FloorPlan {
  return source === "matterport" ? "scan" : "stand-in";
}

/**
 * The Why card's line for a kit building: the CoStar fields its rows cite,
 * once each, in order. Null for a fixture building or a card with no CoStar row.
 */
export function recordNote(
  source: Building["source"] | undefined,
  rows: readonly { layer: ProvenanceLayer; field: string }[],
): string | null {
  if (source !== "costar") return null;
  const fields = [...new Set(rows.filter((r) => r.layer === "costar").map((r) => r.field))];
  return fields.length > 0 ? `From its real CoStar record: ${fields.join(", ")}` : null;
}
