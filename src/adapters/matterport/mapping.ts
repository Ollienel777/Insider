// Everything the live Matterport adapter assumes about the Showcase SDK, and
// the one place scan data becomes a `FloorGraph`.
//
// Not verified against Matterport: there is no SDK key yet (open question Q2,
// SPEC §11). The embed URL, the SDK script, the connect call and the shapes of
// `Sweep.data` and `Room.data` below are taken from the Showcase SDK's
// public documentation as remembered, not from a recorded response. When a
// key arrives (#26), this is the file to check; live.ts only connects and
// reads.
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
});
type RawRoom = z.infer<typeof RawRoom>;

// ---- the mapping --------------------------------------------------------------

/** The room id given to sweeps the scan places in no room. */
export const UNASSIGNED_ROOM = "unassigned";
const UNLABELLED = "Unlabelled area";
const MIN_SIDE = 0.5;

const STAIR = /\bstair/i;
const LIFT = /\b(elevator|lift)/i;

function roomTags(label: string): NodeTag[] {
  const tags: NodeTag[] = [];
  if (STAIR.test(label)) tags.push("stair");
  if (LIFT.test(label)) tags.push("lift");
  return tags;
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
 * - `stair` and `lift` tags come from room labels. `entry` tags are left to
 *   the placer, which chooses entries from the Vexcel tags (SPEC §4.3).
 */
export function toFloorGraph(sweepCollection: Record<string, unknown>, roomCollection: Record<string, unknown>): FloorGraph {
  const all = Object.values(sweepCollection).map((s) => RawSweep.parse(s));
  const floor = busiestFloor(all.filter((s) => s.enabled !== false));
  const sweeps = all.filter((s) => s.enabled !== false && s.floorInfo?.id === floor);
  if (sweeps.length === 0) throw new Error("Matterport: the model has no enabled sweeps on any floor");

  const rawRooms = new Map<string, RawRoom>();
  for (const r of Object.values(roomCollection)) {
    const room = RawRoom.parse(r);
    rawRooms.set(room.id, room);
  }
  const roomOf = (s: RawSweep) => {
    const id = s.roomInfo?.id;
    return id && rawRooms.has(id) ? id : UNASSIGNED_ROOM;
  };
  const labelOf = (roomId: string) =>
    roomId === UNASSIGNED_ROOM ? UNLABELLED : rawRooms.get(roomId)?.label?.trim() || UNLABELLED;

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

  const nodes: FloorNode[] = sweeps
    .filter((s) => keep.has(s.sid))
    .map((s) => ({ id: s.sid, x: s.position.x, y: s.position.z, roomId: roomOf(s), tags: roomTags(labelOf(roomOf(s))) }));
  const nodeRoom = new Map(nodes.map((n) => [n.id, n.roomId]));

  const edges: FloorEdge[] = [...pairs.values()]
    .filter(({ a }) => keep.has(a))
    .map(({ a, b }) =>
      nodeRoom.get(a) === nodeRoom.get(b) ? { a, b } : { a, b, door: { id: `door:${a}:${b}`, lockable: false } },
    );

  const roomIds = [...new Set(nodes.map((n) => n.roomId))];
  const rooms: Room[] = roomIds.map((id) => {
    const raw = rawRooms.get(id);
    if (raw) {
      const { min, max } = raw.bounds;
      return {
        id,
        label: labelOf(id),
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
      label: UNLABELLED,
      rect: { x, y, w: Math.max(Math.max(...xs) - x, MIN_SIDE), h: Math.max(Math.max(...ys) - y, MIN_SIDE) },
    };
  });

  const sightlines: Record<string, string[]> = {};
  for (const n of nodes) {
    sightlines[n.id] = nodes.filter((m) => m.id !== n.id && m.roomId === n.roomId).map((m) => m.id);
  }

  return FloorGraph.parse({ nodes, edges, rooms, sightlines, source: "matterport" });
}
