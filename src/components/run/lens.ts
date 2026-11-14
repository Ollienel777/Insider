// The Layer lens's model (SPEC §3 the CoStar row, DESIGN.md "The signature
// element", #33): which data layer produced each element on the board, and
// how many elements each layer produced, for the legend.
//
// Nothing here is a hand-written map from element kind to layer. A guard's,
// camera's, lock's, zone's or entry's layers are the layers of the provenance
// entries the placer attached to it, the same entries its Why card lists, so
// an element with entries from two layers carries both. Game fiction (the
// mission) is not a data layer, so an element whose only entries are fiction
// carries none. The manifest never holds Matterport data (manifest.ts), so the
// Matterport layer is read off the board itself: every room tile is a room of
// the floor graph, whose `source` says whether it came from the scan or from
// the adapter's fixture floor.
//
// Pure: no DOM.
import type { FloorGraph, ProvenanceLayer } from "@/domain";
import type { PlacedLevel } from "@/level/placer";
import { whyKey, whyTargets } from "./why";

export type LensLayer = "costar" | "vexcel" | "matterport";

/** The legend's order, and the order an element's marks are drawn in. */
export const LENS_LAYERS: readonly LensLayer[] = ["costar", "vexcel", "matterport"];

/** The letter mark each layer draws beside its elements, so a layer reads without its colour. */
export const LENS_MARK: Readonly<Record<LensLayer, string>> = { costar: "C", vexcel: "V", matterport: "M" };

export const LENS_LABEL: Readonly<Record<LensLayer, string>> = {
  costar: "CoStar",
  vexcel: "Vexcel",
  matterport: "Matterport",
};

export type LensKind = "guard" | "camera" | "lock" | "zone" | "entry" | "room";

/** One element on the board as the lens tints it. `key` is what the board marks it with (`data-lens`). */
export interface LensElement {
  key: string;
  kind: LensKind;
  /** Its layers in `LENS_LAYERS` order, each once; empty when nothing but fiction produced it. */
  layers: readonly LensLayer[];
}

const DATA_LAYERS: Readonly<Record<ProvenanceLayer, LensLayer | null>> = {
  costar: "costar",
  vexcel: "vexcel",
  fiction: null,
};

/** The data layers among some provenance entries' layers, plus `extra`, in `LENS_LAYERS` order. */
function layersOf(entries: readonly { layer: ProvenanceLayer }[], extra: readonly LensLayer[] = []): LensLayer[] {
  const found = new Set<LensLayer>(extra);
  for (const entry of entries) {
    const layer = DATA_LAYERS[entry.layer];
    if (layer) found.add(layer);
  }
  return LENS_LAYERS.filter((layer) => found.has(layer));
}

export const lensKey = {
  ...whyKey,
  entry: (entryId: string) => `entry:${entryId}`,
};

/**
 * Every element the board draws, with its layers: each guard, camera and
 * entry, each lock on a door still `locked`, and each room tile. A room that
 * holds a zone is a `zone` and carries its zones' layers on top of the
 * floor's; any other room is a `room`, from the floor alone.
 */
export function lensElements(placed: PlacedLevel, locked: readonly string[]): LensElement[] {
  const { floor } = placed.level;
  const elements: LensElement[] = [];
  const zoneRooms = new Set<string>();
  for (const target of whyTargets(placed)) {
    if (target.kind === "lock" && !locked.includes(target.key.slice("lock:".length))) continue;
    if (target.kind === "zone") {
      zoneRooms.add(target.key);
      elements.push({ key: target.key, kind: "zone", layers: layersOf(target.provenance, floorLayers(floor)) });
      continue;
    }
    elements.push({ key: target.key, kind: target.kind, layers: layersOf(target.provenance) });
  }
  for (const entry of placed.entries) {
    elements.push({ key: lensKey.entry(entry.entryId), kind: "entry", layers: layersOf(entry.provenance) });
  }
  for (const room of floor.rooms) {
    const key = whyKey.room(room.id);
    if (!zoneRooms.has(key)) elements.push({ key, kind: "room", layers: floorLayers(floor) });
  }
  return elements;
}

/**
 * The layer a floor's own rooms come from, by the floor's recorded `source`.
 * Both are the Matterport adapter's: the scan live, its fixture floor keyless
 * (the legend says which).
 */
const FLOOR_LAYER: Readonly<Record<FloorGraph["source"], LensLayer>> = {
  matterport: "matterport",
  fixture: "matterport",
};

function floorLayers(floor: FloorGraph): LensLayer[] {
  return [FLOOR_LAYER[floor.source]];
}

export interface LayerCount {
  layer: LensLayer;
  /** How many elements carry this layer. */
  total: number;
  /** The same, by kind, for the kinds that have any, in `KIND_ORDER`. */
  byKind: readonly { kind: LensKind; count: number }[];
}

const KIND_ORDER: readonly LensKind[] = ["guard", "camera", "lock", "zone", "entry", "room"];

/**
 * The legend's counts: for each layer, the elements that carry it. An element
 * with two layers counts once under each. Also the elements no data layer
 * produced, which the legend names as game fiction.
 */
export function layerCounts(elements: readonly LensElement[]): { layers: LayerCount[]; unsourced: number } {
  const layers = LENS_LAYERS.map((layer): LayerCount => {
    const carrying = elements.filter((e) => e.layers.includes(layer));
    return {
      layer,
      total: carrying.length,
      byKind: KIND_ORDER.flatMap((kind) => {
        const count = carrying.filter((e) => e.kind === kind).length;
        return count > 0 ? [{ kind, count }] : [];
      }),
    };
  });
  return { layers, unsourced: elements.filter((e) => e.layers.length === 0).length };
}

const NOUN: Readonly<Record<LensKind, [string, string]>> = {
  guard: ["guard", "guards"],
  camera: ["camera", "cameras"],
  lock: ["lock", "locks"],
  zone: ["zone room", "zone rooms"],
  entry: ["entry", "entries"],
  room: ["other room", "other rooms"],
};

/** "4 guards, 2 cameras and 1 lock". Matterport's elements are all room tiles, so it reads "14 rooms". */
export function describeKinds({ layer, total, byKind }: LayerCount): string {
  if (layer === "matterport") return `${total} ${total === 1 ? "room" : "rooms"}`;
  const parts = byKind.map(({ kind, count }) => `${count} ${NOUN[kind][count === 1 ? 0 : 1]}`);
  if (parts.length <= 1) return parts[0] ?? "nothing";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
