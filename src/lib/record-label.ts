// Where a kit building's level comes from, said plainly on the Dossier, the
// Run and the Why card (#95). A CoStar kit building's facts are its real
// record; its floor is its real Matterport scan only when the board actually
// stands on the scan. When Matterport is on fixtures, or the scan can't hold
// the level (scan-fallback.ts), the board is a stand-in fixture floor and the
// label says so. Only the Run knows which floor it placed on, so the Dossier
// names the record alone. A fixture building (F1–F5) gets no label: it
// renders as before.
import type { Building, FloorGraph, ProvenanceLayer } from "@/domain";

/** Which floor a kit building's level stands on. */
export type FloorPlan = "scan" | "stand-in";

export const RECORD_LABEL = "Real CoStar record";
/** The part of the Run's label that names its floor: the part that matters, kept whole on a narrow screen. */
export const floorLabel = (floor: FloorPlan): string => (floor === "scan" ? "real Matterport scan" : "stand-in floor plan");
export const REAL_SCAN_LABEL = `${RECORD_LABEL} · ${floorLabel("scan")}`;
export const STAND_IN_LABEL = `${RECORD_LABEL} · ${floorLabel("stand-in")}`;

/** The Run's label for a building placed on `floor`; null for a fixture building. */
export function recordLabel(source: Building["source"] | undefined, floor: FloorPlan): string | null {
  if (source !== "costar") return null;
  return floor === "scan" ? REAL_SCAN_LABEL : STAND_IN_LABEL;
}

/**
 * The Dossier's label: the real record only. No floor loads before the Run,
 * and a live scan can still fail, time out or be unable to hold the level, so
 * the floor is named only once the Run has placed on it (`placedFloor`).
 */
export function dossierLabel(source: Building["source"] | undefined): string | null {
  return source === "costar" ? RECORD_LABEL : null;
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
