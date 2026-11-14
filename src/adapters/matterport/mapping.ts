// Everything the live Matterport adapter assumes about the Showcase SDK, and
// the one place scan data becomes a `FloorGraph`.
//
// Checked once against a real model on localhost (SDK 26.11, no data kept):
// the embed URL, the SDK script and the connect call work; a sweep's `id`
// and `sid` are the same string, and its `neighbors` name those ids; a sweep
// carries `roomInfo`, but its `id` can be empty, so a sweep without one is
// placed in the room whose bounds hold it; room labels can all be empty.
// Shapes not seen there (a labelled room, a sweep with a room id, several
// floors) follow the Showcase SDK's public reference. live.ts only connects
// and reads.
//
// Terms (SPEC §4.5, DECISION risk 2): until the sponsor says yes in writing,
// what this file returns is held in browser memory only. Nothing here or in
// live.ts fetches, stores or posts; the graph goes to the caller and nowhere
// else. No scan id, label, coordinate or edge reaches the server or a model.
// One thing shaped by the scan does: on every alarm transition the Run
// screen sends the Chief opaque `area-N` zones for the rooms outside the
// manifest's zones, and which zone each guard and the last sighting is in
// (components/run/chief-request.ts). The drill narrator is not called for a
// scanned floor (components/drill/drill-screen.tsx).
import { z } from "zod";
import { FloorGraph, type FloorEdge, type FloorNode, type NodeTag, type Room } from "@/domain";

/** Where the Showcase player and its SDK are loaded from. */
export const SHOWCASE = {
  embedUrl(modelId: string, sdkKey: string): string {
    const params = new URLSearchParams({ m: modelId, applicationKey: sdkKey, play: "1", qs: "1", title: "0" });
    return `https://my.matterport.com/show/?${params}`;
  },
  sdkScript: "https://static.matterport.com/showcase-sdk/latest.js",
  /** The SDK interface version passed to `MP_SDK.connect`. */
  sdkVersion: "3.10",
} as const;

// ---- the SDK, as far as this adapter uses it ---------------------------------

/** One subscription to an observable collection (`Sweep.data`, `Room.data`). */
export interface Subscription {
  cancel(): void;
}

export interface ObservableCollection<T> {
  subscribe(observer: { onCollectionUpdated(collection: Record<string, T>): void }): Subscription;
}

/** The part of a connected Showcase SDK instance this adapter reads. */
export interface ShowcaseSdk {
  Sweep: { data: ObservableCollection<unknown> };
  Room: { data: ObservableCollection<unknown> };
}

// ---- response shapes (assumed; see the header) -------------------------------

const Vector3 = z.object({ x: z.number(), y: z.number(), z: z.number() });

const RawSweep = z.object({
  sid: z.string().min(1),
  enabled: z.boolean().optional(),
  /** Sweep ids this sweep connects to (the scan's own walk graph). */
  neighbors: z.array(z.string()).default([]),
  /** Matterport space is y-up; the board uses x and z. */
  position: Vector3,
  floorInfo: z.object({ id: z.string(), sequence: z.number().optional() }).optional(),
  roomInfo: z.object({ id: z.string().nullish() }).nullish(),
});
type RawSweep = z.infer<typeof RawSweep>;

const RawRoom = z.object({
  id: z.string().min(1),
  label: z.string().nullish(),
  bounds: z.object({ min: Vector3, max: Vector3 }),
  floorInfo: z.object({ id: z.string() }).nullish(),
});
type RawRoom = z.infer<typeof RawRoom>;

// ---- the mapping --------------------------------------------------------------

/** The room id given to sweeps the scan places in no room. */
export const UNASSIGNED_ROOM = "unassigned";
/** The label of the unassigned room: sweeps the scan puts in no room are mostly circulation. */
export const UNASSIGNED_LABEL = "Corridor";
const MIN_SIDE = 0.5;

/**
 * Game-fiction names for a room the scan left unlabelled, by floor area in
 * square metres (issue 28): the first band the area falls under. The board
 * needs a name to print and the crew a name to say; these say how big a room
 * is, never what the scan says it is.
 */
export const FICTION_BANDS: readonly { under: number; label: string }[] = [
  { under: 4, label: "Closet" },
  { under: 12, label: "Office" },
  { under: 30, label: "Meeting Room" },
  { under: 80, label: "Workroom" },
  { under: Infinity, label: "Open Floor" },
];

/** The game-fiction name for an unlabelled room of `areaM2` square metres. */
export function fictionLabel(areaM2: number): string {
  return FICTION_BANDS.find((band) => areaM2 < band.under)!.label;
}

const STAIR = /\bstair/i;
const LIFT = /\b(elevator|lift)/i;

function roomTags(label: string): NodeTag[] {
  const tags: NodeTag[] = [];
  if (STAIR.test(label)) tags.push("stair");
  if (LIFT.test(label)) tags.push("lift");
  return tags;
}

/**
 * One landing per room: the sweep with the most edges out of the room (where
 * the door is), a tie to the lower id. A scan has several sweeps in a
 * stairwell, and the drill, the placer and the drill board each count a
 * tagged node as one stair or lift, so only the landing carries the room's
 * `stair` or `lift` tag; tagging every sweep would turn one stairwell into
 * several.
 */
function landings(nodes: { id: string; roomId: string }[], outward: Map<string, number>): Map<string, string> {
  const byRoom = new Map<string, string[]>();
  for (const n of nodes) byRoom.set(n.roomId, [...(byRoom.get(n.roomId) ?? []), n.id]);
  return new Map([...byRoom].map(([roomId, ids]) => [roomId, doorSide(ids, outward)]));
}

/** For each node, how many of its edges lead out of its room. */
function outwardEdges(nodes: { id: string; roomId: string }[], edges: { a: string; b: string }[]): Map<string, number> {
  const room = new Map(nodes.map((n) => [n.id, n.roomId]));
  const outward = new Map<string, number>();
  for (const { a, b } of edges) {
    if (room.get(a) === room.get(b)) continue;
    outward.set(a, (outward.get(a) ?? 0) + 1);
    outward.set(b, (outward.get(b) ?? 0) + 1);
  }
  return outward;
}

/** The id with the most edges out of its room; a tie goes to the lower id. */
function doorSide(ids: string[], outward: Map<string, number>): string {
  return [...ids].sort().reduce((best, id) => ((outward.get(id) ?? 0) > (outward.get(best) ?? 0) ? id : best));
}

/**
 * Stairs the scan shows by itself: sweeps whose neighbours include a sweep on
 * another floor. Such sweeps that touch, in one room, are one landing, so a
 * flight scanned from three spots is still one stair; each landing's
 * door-side sweep is the one tagged.
 */
function crossFloorLandings(
  nodes: { id: string; roomId: string }[],
  edges: { a: string; b: string }[],
  crossing: Set<string>,
  outward: Map<string, number>,
): Set<string> {
  const room = new Map(nodes.map((n) => [n.id, n.roomId]));
  const linked = edges.filter(({ a, b }) => crossing.has(a) && crossing.has(b) && room.get(a) === room.get(b));
  const tagged = new Set<string>();
  let rest = nodes.map((n) => n.id).filter((id) => crossing.has(id));
  while (rest.length > 0) {
    const left = new Set(rest);
    const group = largestComponent(rest, linked.filter(({ a, b }) => left.has(a) && left.has(b)));
    tagged.add(doorSide([...group], outward));
    rest = rest.filter((id) => !group.has(id));
  }
  return tagged;
}

/** The floor with the most enabled sweeps; a tie goes to the lower floor. */
function busiestFloor(sweeps: RawSweep[]): string | undefined {
  const count = new Map<string, { n: number; seq: number }>();
  for (const s of sweeps) {
    if (!s.floorInfo) continue;
    const entry = count.get(s.floorInfo.id) ?? { n: 0, seq: s.floorInfo.sequence ?? 0 };
    entry.n += 1;
    count.set(s.floorInfo.id, entry);
  }
  let best: [string, { n: number; seq: number }] | undefined;
  for (const candidate of count) {
    if (!best || candidate[1].n > best[1].n || (candidate[1].n === best[1].n && candidate[1].seq < best[1].seq)) {
      best = candidate;
    }
  }
  return best?.[0];
}

/** The ids in the largest connected component of `nodes` under `edges`. */
function largestComponent(nodes: string[], edges: { a: string; b: string }[]): Set<string> {
  const adjacent = new Map(nodes.map((id) => [id, [] as string[]]));
  for (const { a, b } of edges) {
    adjacent.get(a)!.push(b);
    adjacent.get(b)!.push(a);
  }
  const seen = new Set<string>();
  let best = new Set<string>();
  for (const start of nodes) {
    if (seen.has(start)) continue;
    const component = new Set([start]);
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      for (const next of adjacent.get(queue.shift()!)!) {
        if (!seen.has(next)) {
          seen.add(next);
          component.add(next);
          queue.push(next);
        }
      }
    }
    if (component.size > best.size) best = component;
  }
  return best;
}

/**
 * The SDK's sweep and room collections as a `FloorGraph`, following SPEC
 * §4.3's last row: sweeps are nodes, the scan's sweep neighbours are edges,
 * an edge that crosses rooms gets a door, and sightlines are same-room.
 *
 * - One floor: the scan's floor with the most enabled sweeps.
 * - Disabled sweeps are dropped; so is anything outside the largest connected
 *   part of the walk graph, since the engine needs a connected board.
 * - Doors are never lockable here. Which doors lock is game fiction from the
 *   rules table (SPEC §4.3), not something a scan says.
 * - A sweep the scan puts in no room (an empty `roomInfo.id`) goes to the
 *   smallest room on the floor whose bounds hold it, else to the unassigned
 *   room.
 * - `stair` and `lift` tags come from room labels, one landing per room, and
 *   `stair` also from sweeps with a neighbour on another floor, one per
 *   landing. `entry` tags are left to the placer, which chooses entries from
 *   the Vexcel tags (SPEC §4.3).
 * - A room the scan left unlabelled gets a game-fiction name by its size, and
 *   repeated names are numbered.
 */
export function toFloorGraph(sweepCollection: Record<string, unknown>, roomCollection: Record<string, unknown>): FloorGraph {
  const all = Object.values(sweepCollection).map((s) => RawSweep.parse(s));
  const enabled = all.filter((s) => s.enabled !== false);
  const floor = busiestFloor(enabled);
  const sweeps = enabled.filter((s) => s.floorInfo?.id === floor);
  if (sweeps.length === 0) throw new Error("Matterport: the model has no enabled sweeps on any floor");

  const rawRooms = new Map<string, RawRoom>();
  for (const r of Object.values(roomCollection)) {
    const room = RawRoom.parse(r);
    rawRooms.set(room.id, room);
  }
  const floorRooms = [...rawRooms.values()].filter((r) => !r.floorInfo || r.floorInfo.id === floor);
  const area = (r: RawRoom) => (r.bounds.max.x - r.bounds.min.x) * (r.bounds.max.z - r.bounds.min.z);
  const roomOf = (s: RawSweep) => {
    const id = s.roomInfo?.id;
    if (id && rawRooms.has(id)) return id;
    const { x, z } = s.position;
    const holding = floorRooms.filter(({ bounds: { min, max } }) => x >= min.x && x <= max.x && z >= min.z && z <= max.z);
    holding.sort((p, q) => area(p) - area(q) || (p.id < q.id ? -1 : 1));
    return holding[0]?.id ?? UNASSIGNED_ROOM;
  };
  const floorOf = new Map(enabled.map((s) => [s.sid, s.floorInfo?.id]));
  const crossing = new Set(
    sweeps.filter((s) => s.neighbors.some((n) => floorOf.has(n) && floorOf.get(n) !== floor)).map((s) => s.sid),
  );
  /** The scan's own label, or "" when it has none (`withFictionLabels` names those). */
  const scanLabel = (roomId: string) =>
    roomId === UNASSIGNED_ROOM ? UNASSIGNED_LABEL : (rawRooms.get(roomId)?.label?.trim() ?? "");

  const ids = new Set(sweeps.map((s) => s.sid));
  const pairs = new Map<string, { a: string; b: string }>();
  for (const s of sweeps) {
    for (const n of s.neighbors) {
      if (n === s.sid || !ids.has(n)) continue;
      const [a, b] = s.sid < n ? [s.sid, n] : [n, s.sid];
      pairs.set(`${a} ${b}`, { a, b });
    }
  }
  const keep = largestComponent([...ids], [...pairs.values()]);

  const kept = sweeps
    .filter((s) => keep.has(s.sid))
    .map((s) => ({ id: s.sid, x: s.position.x, y: s.position.z, roomId: roomOf(s) }));
  const keptEdges = [...pairs.values()].filter(({ a }) => keep.has(a));
  const outward = outwardEdges(kept, keptEdges);
  const landing = landings(kept, outward);
  // A room whose label already makes it a stair or lift has its one landing;
  // its sweeps that reach another floor are that landing, not more stairs.
  const unlabelledCrossing = new Set(kept.filter((n) => crossing.has(n.id) && roomTags(scanLabel(n.roomId)).length === 0).map((n) => n.id));
  const stairs = crossFloorLandings(kept, keptEdges, unlabelledCrossing, outward);
  const nodes: FloorNode[] = kept.map((n) => {
    const tags = landing.get(n.roomId) === n.id ? roomTags(scanLabel(n.roomId)) : [];
    if (stairs.has(n.id)) tags.push("stair");
    return { ...n, tags };
  });
  const nodeRoom = new Map(nodes.map((n) => [n.id, n.roomId]));

  const edges: FloorEdge[] = [...pairs.values()]
    .filter(({ a }) => keep.has(a))
    .map(({ a, b }) =>
      nodeRoom.get(a) === nodeRoom.get(b) ? { a, b } : { a, b, door: { id: `door:${a}:${b}`, lockable: false } },
    );

  const roomIds = [...new Set(nodes.map((n) => n.roomId))];
  const boxed: Room[] = roomIds.map((id) => {
    const raw = rawRooms.get(id);
    if (raw) {
      const { min, max } = raw.bounds;
      return {
        id,
        label: scanLabel(id),
        rect: { x: min.x, y: min.z, w: Math.max(max.x - min.x, MIN_SIDE), h: Math.max(max.z - min.z, MIN_SIDE) },
      };
    }
    // The unassigned room: the box around its nodes.
    const xs = nodes.filter((n) => n.roomId === id).map((n) => n.x);
    const ys = nodes.filter((n) => n.roomId === id).map((n) => n.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return {
      id,
      label: UNASSIGNED_LABEL,
      rect: { x, y, w: Math.max(Math.max(...xs) - x, MIN_SIDE), h: Math.max(Math.max(...ys) - y, MIN_SIDE) },
    };
  });
  const rooms = withFictionLabels(boxed);

  const sightlines: Record<string, string[]> = {};
  for (const n of nodes) {
    sightlines[n.id] = nodes.filter((m) => m.id !== n.id && m.roomId === n.roomId).map((m) => m.id);
  }

  return FloorGraph.parse({ nodes, edges, rooms, sightlines, source: "matterport" });
}

/**
 * Rooms with the scan's blank labels filled in by size (`fictionLabel`).
 * Rooms that end up with the same name, whether the scan gave it or this
 * did, are numbered together, north-west first (board y, then x), so every
 * name is unique and the crew can tell them apart: "Office 1", "Office 2".
 * A label the scan gave is otherwise kept as it is.
 */
export function withFictionLabels(rooms: Room[]): Room[] {
  const named = new Map<string, Room[]>();
  for (const room of rooms) {
    const label = room.label || fictionLabel(room.rect.w * room.rect.h);
    named.set(label, [...(named.get(label) ?? []), room]);
  }
  const labels = new Map<string, string>();
  // Every name that stands as it is, so a number never repeats one (a scan's own "Office 1").
  const used = new Set([...named].filter(([, group]) => group.length === 1).map(([name]) => name));
  for (const [name, group] of named) {
    if (group.length === 1) {
      labels.set(group[0].id, name);
      continue;
    }
    const ordered = [...group].sort((p, q) => p.rect.y - q.rect.y || p.rect.x - q.rect.x || (p.id < q.id ? -1 : 1));
    let n = 0;
    for (const room of ordered) {
      let label: string;
      do label = `${name} ${++n}`;
      while (used.has(label));
      used.add(label);
      labels.set(room.id, label);
    }
  }
  return rooms.map((room) => ({ ...room, label: labels.get(room.id)! }));
}
