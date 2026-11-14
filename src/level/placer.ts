// The placer (SPEC §4, §4.5, D13): turns a cached `LevelManifest` into a
// playable level on a `FloorGraph`. It maps the manifest's roles onto the
// floor: zones onto rooms (quiet = available suites, crowded = an occupied
// suite room with its night cleaners, objective = the records room, secure =
// the server closet), entries onto `entry` nodes, locks onto
// the lockable doors of the objective and secure rooms, cameras onto corridor
// nodes, one guard onto a post for the dock entry and the rest onto patrol
// rounds. Every placed element carries the
// manifest's provenance entries for it (the same objects, not copies), which
// is what the Why card (#21) reads.
//
// It runs in the browser, so a live Matterport floor never leaves the page
// (SPEC §4.5): hence the directive below, which also lets it read the F1 demo
// ids from the fake adapter.
//
// Pure: no I/O, no clock, no randomness. The seed is the only source of
// variation (it picks where on its round each guard starts), so the same
// manifest, floor and seed always give the same placement, and the inputs are
// never mutated.
"use client";

import { F1_DEMO } from "@/adapters/matterport/fake";
import type {
  CameraKind,
  EntryKind,
  FloorGraph,
  LevelManifest,
  LockKind,
  Provenance,
  Zone,
  ZoneRole,
} from "@/domain";
import { DEFAULT_HEARING, type CameraSpec, type GuardSpec, type Level } from "@/engine";

// The quiet route is computed from a placement (quiet-route.ts); it is
// exported here too, since the placer owns it (#15, #19).
export { quietRoute } from "./quiet-route";

// ---- what the placer returns ------------------------------------------------

/** A camera as the engine takes it, with its phase always set. */
export interface PlacedCamera extends CameraSpec {
  phase: number;
  /** The cover node a player reaches first from the start, how many moves away, and whether the start sees it. */
  approach: { nodeId: string; hops: number; visibleFromStart: boolean };
  provenance: readonly Provenance[];
}

export interface PlacedGuard {
  id: string;
  /** The room the round walks, or the post stands in. */
  roomId: string;
  /** Waypoints, as the engine's `GuardSpec.patrol`: the guard starts on the first. A post has one. */
  patrol: readonly string[];
  /**
   * Set when the guard stands a post for an entry instead of walking a round:
   * the entry, and how the placer chose the node (see `DOCK_POST_RULE`).
   */
  post?: { entryId: string; rule: string };
  provenance: readonly Provenance[];
}

export interface PlacedLock {
  doorId: string;
  /** The zone the door closes: the objective or the secure zone. */
  zoneId: string;
  provenance: readonly Provenance[];
}

export interface PlacedEntry {
  entryId: string;
  kind: EntryKind;
  label: string;
  nodeId: string;
  provenance: readonly Provenance[];
}

export interface PlacedZone {
  zoneId: string;
  role: ZoneRole;
  name: string;
  roomIds: readonly string[];
  nodes: readonly string[];
  provenance: readonly Provenance[];
}

/** A manifest element with no place on this floor, and why. */
export interface Unplaced {
  elementRole: string;
  reason: string;
}

export interface PlacedLevel {
  /** The engine's level, ready for `createRun`. */
  level: Level;
  entries: readonly PlacedEntry[];
  zones: readonly PlacedZone[];
  objective: { nodeId: string; zoneId: string; provenance: readonly Provenance[] };
  locks: readonly PlacedLock[];
  cameras: readonly PlacedCamera[];
  guards: readonly PlacedGuard[];
  unplaced: readonly Unplaced[];
}

/**
 * Fixed placements for one building's fixture floor, used only where every id
 * they name is on the floor (a live Matterport floor has its own ids, and
 * falls back to the general rules).
 */
export interface PlacementAnchors {
  /** Entry kind → its node. */
  entries?: Partial<Record<EntryKind, string>>;
  /** Camera id → its cover, nearest the start first. */
  cameras?: Readonly<Record<string, readonly string[]>>;
  objective?: string;
}

/** F1's demo path (SPEC §2, beats 4 and 5): C2 watches the dock corridor. */
export const ANCHORS: Readonly<Record<string, PlacementAnchors>> = Object.freeze({
  F1: {
    entries: { dock: F1_DEMO.dockEntry, roof: F1_DEMO.roofEntry },
    cameras: { C2: F1_DEMO.c2Cover },
    objective: F1_DEMO.objective,
  },
});

/** A manifest the placer cannot turn into a runnable level on this floor. */
export class PlacementError extends Error {
  override name = "PlacementError";
}

// ---- the placer's values ----------------------------------------------------

/** No guard's round starts this close (in moves) to an entry node, nor in a room this close to the start. */
export const ENTRY_CLEARANCE = 2;

/** Consecutive picks that open a locked door, by lock kind. SPEC §4.3 sets key locks at 2. */
const PICK_TURNS: Readonly<Record<LockKind, number>> = {
  key: 2,
  magstripe: 3,
  prox: 3,
  "badge-pin": 4,
};

/** Turns in a camera's watch cycle, by kind (SPEC §4.3; the same table as the engine's `CYCLE`, which it does not export). */
const CYCLE: Readonly<Record<CameraKind, number>> = {
  "analog-sweep": 2,
  ptz: 3,
  "fixed-ip": 1,
  "ip-analytics": 1,
};

/** The node tag each entry kind prefers: a dock arrives by the freight lift, the roof by a stair. */
const ENTRY_TAG: Readonly<Record<EntryKind, "lift" | "stair">> = {
  dock: "lift",
  garage: "lift",
  lobby: "lift",
  roof: "stair",
  service: "stair",
};

/** Words that find a zone's room in the floor's room labels, after the zone's own name. */
const ROOM_WORDS: Partial<Record<ZoneRole, readonly string[]>> = {
  objective: ["records", "archive", "vault"],
  secure: ["server", "secure", "security"],
};

/**
 * How the dock post is chosen, in the words the Why card shows. The node is
 * the nearest to the dock entry that keeps the quiet way in open: nothing in
 * sight of it within ENTRY_CLEARANCE moves of the start, out of earshot of
 * where the objective's door is picked (only that lock: the words say no
 * more), off the cameras' covers, the quiet zones and the locked rooms.
 */
const DOCK_POST_RULE = "Posted on the nearest node to the dock that keeps out of sight of the way in and out of earshot of the door to the files";

const CORRIDOR = /corridor|hall/i;
const SUITE_ROOM = /suite|office/i;
/** Rooms people pass through: never the objective or the secure room, whatever a model names the zone. */
const CIRCULATION = /corridor|hall|lobby|stair|lift|elevator|landing/i;

// ---- graph helpers ----------------------------------------------------------

type Adjacency = ReadonlyMap<string, readonly string[]>;

function adjacencyOf(floor: FloorGraph): Adjacency {
  const adj = new Map<string, string[]>(floor.nodes.map((n) => [n.id, []]));
  for (const edge of floor.edges) {
    adj.get(edge.a)!.push(edge.b);
    adj.get(edge.b)!.push(edge.a);
  }
  return adj;
}

/** Moves from the nearest of `from` to every node reachable, inside `allowed` when given. */
function hops(adj: Adjacency, from: readonly string[], allowed?: ReadonlySet<string>): Map<string, number> {
  const dist = new Map<string, number>();
  const queue: string[] = [];
  for (const id of from) {
    if (!dist.has(id)) {
      dist.set(id, 0);
      queue.push(id);
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    for (const next of adj.get(id) ?? []) {
      if (dist.has(next) || (allowed && !allowed.has(next))) continue;
      dist.set(next, dist.get(id)! + 1);
      queue.push(next);
    }
  }
  return dist;
}

/** A shortest path from `a` to `b` inside `allowed`, both ends included. */
function pathWithin(adj: Adjacency, a: string, b: string, allowed: ReadonlySet<string>): string[] {
  const back = hops(adj, [b], allowed);
  const path = [a];
  let at = a;
  while (at !== b) {
    const d = back.get(at)!;
    // Neighbours are tried in id order, so the path does not depend on edge order.
    at = [...(adj.get(at) ?? [])].sort().find((n) => allowed.has(n) && back.get(n) === d - 1)!;
    path.push(at);
  }
  return path;
}

/**
 * The longest shortest path through `nodes` (a room's run of nodes, end to
 * end), starting from the end nearest the start. Ties go to the lower ids.
 */
function chainOf(adj: Adjacency, nodes: readonly string[], fromStart: ReadonlyMap<string, number>): string[] {
  const allowed = new Set(nodes);
  const sorted = [...nodes].sort();
  const near = (id: string) => fromStart.get(id) ?? Infinity;
  let best: { a: string; b: string; d: number } | null = null;
  for (const a of sorted) {
    const dist = hops(adj, [a], allowed);
    for (const b of sorted) {
      const d = dist.get(b);
      if (d === undefined) continue;
      // Orient each pair from the end nearer the start.
      const [x, y] = near(b) < near(a) || (near(b) === near(a) && b < a) ? [b, a] : [a, b];
      const better =
        !best ||
        d > best.d ||
        (d === best.d && (near(x) < near(best.a) || (near(x) === near(best.a) && `${x} ${y}` < `${best.a} ${best.b}`)));
      if (better) best = { a: x, b: y, d };
    }
  }
  return best ? pathWithin(adj, best.a, best.b, allowed) : [];
}

/** FNV-1a over the seed and a key, then an avalanche: a stable 32-bit number. */
function hash(seed: number, key: string): number {
  let h = 0x811c9dc5 ^ (seed | 0);
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

const mod = (n: number, m: number) => ((n % m) + m) % m;

/** The part of a cover of `length` nodes, cut into `parts` as the engine cuts it, that holds node `index`. */
function partOf(index: number, length: number, parts: number): number {
  for (let i = 0; i < parts; i++) {
    if (index < Math.floor(((i + 1) * length) / parts)) return i;
  }
  return parts - 1;
}

/** Suite numbers a room label names: "Suites 2202–2205" covers 2202 to 2205. */
function suitesIn(label: string): (suite: string) => boolean {
  const ranges = [...label.matchAll(/(\d+)(?:\s*[–-]\s*(\d+))?/g)].map((m) => [Number(m[1]), Number(m[2] ?? m[1])]);
  return (suite) => {
    const n = Number(suite);
    return Number.isFinite(n) && ranges.some(([lo, hi]) => n >= lo && n <= hi);
  };
}

// ---- the placer -------------------------------------------------------------

/**
 * Places the manifest's level on the floor. `anchors` default to the
 * building's entry in `ANCHORS`. Throws `PlacementError` when the floor offers
 * no entry or no objective room, or the seed is not an integer.
 */
export function placeLevel(
  manifest: LevelManifest,
  floor: FloorGraph,
  seed: number,
  anchors: PlacementAnchors = ANCHORS[manifest.buildingId] ?? {},
): PlacedLevel {
  if (!Number.isInteger(seed)) throw new PlacementError(`seed ${seed} is not an integer`);

  const unplaced: Unplaced[] = [];
  const adj = adjacencyOf(floor);
  const nodeIds = new Set(floor.nodes.map((n) => n.id));
  const nodeById = new Map(floor.nodes.map((n) => [n.id, n]));
  const roomNodes = new Map<string, string[]>(floor.rooms.map((r) => [r.id, []]));
  for (const node of floor.nodes) roomNodes.get(node.roomId)!.push(node.id);
  const onFloor = (ids: readonly string[]) => ids.length > 0 && ids.every((id) => nodeIds.has(id));

  const provenanceOf = (role: string, ...fallbacks: string[]): Provenance[] => {
    for (const r of [role, ...fallbacks]) {
      const found = manifest.provenance.filter((p) => p.elementRole === r);
      if (found.length > 0) return found;
    }
    return [];
  };
  const profileProvenance = (field: string) => provenanceOf(`profile:${field}`);

  // Entries: each takes an entry node, the anchored one or the first free one with its preferred tag.
  const entryNodes = floor.nodes.filter((n) => n.tags.includes("entry"));
  const taken = new Set<string>();
  const entries: PlacedEntry[] = [];
  for (const entry of manifest.entries) {
    const anchored = anchors.entries?.[entry.kind];
    const free = entryNodes.filter((n) => !taken.has(n.id));
    const node =
      free.find((n) => n.id === anchored) ??
      free.find((n) => n.tags.includes(ENTRY_TAG[entry.kind])) ??
      free[0];
    if (!node) {
      unplaced.push({ elementRole: `entry:${entry.id}`, reason: "the floor has no free entry node for it" });
      continue;
    }
    taken.add(node.id);
    entries.push({
      entryId: entry.id,
      kind: entry.kind,
      label: entry.label,
      nodeId: node.id,
      provenance: provenanceOf(`entry:${entry.id}`),
    });
  }
  if (entries.length === 0) throw new PlacementError("the floor has no entry node for any of the manifest's entries");
  const start = entries[0].nodeId;
  const fromStart = hops(adj, [start]);
  const fromEntries = hops(adj, entryNodes.map((n) => n.id));

  // Zones onto rooms.
  const claimed = new Set<string>();
  const suiteOf = (zone: Zone) => /suite\s+(\S+)/i.exec(zone.name)?.[1] ?? zone.id.replace(/^quiet-/, "");
  const quietSuites = manifest.zones.filter((z) => z.role === "quiet").map(suiteOf);
  const suiteRooms = floor.rooms.filter((r) => SUITE_ROOM.test(r.label));
  // The occupied rest of the floor always has a room when the manifest has a
  // crowded zone (SPEC §4.3: its night cleaners). Where every suite room
  // holds an available suite, the crowded zone keeps the one farthest from
  // the start, off the way in, and the quiet zones leave it alone.
  const reserved = new Set<string>();
  if (manifest.zones.some((z) => z.role === "crowded") && suiteRooms.length > 0) {
    const allAvailable = suiteRooms.every((r) => quietSuites.some((s) => suitesIn(r.label)(s)));
    if (allAvailable) {
      const nearest = (roomId: string) => Math.min(...(roomNodes.get(roomId) ?? []).map((id) => fromStart.get(id) ?? Infinity));
      const far = [...suiteRooms].sort((a, b) => nearest(b.id) - nearest(a.id) || a.id.localeCompare(b.id))[0];
      reserved.add(far.id);
    }
  }
  const roomsFor = (zone: Zone): string[] => {
    if (zone.role === "quiet") {
      const suite = suiteOf(zone);
      return floor.rooms.filter((r) => suitesIn(r.label)(suite) && !reserved.has(r.id)).map((r) => r.id);
    }
    if (zone.role === "crowded") {
      // Occupied suites: suite and office rooms that no quiet zone took.
      return suiteRooms.filter((r) => !claimed.has(r.id)).map((r) => r.id);
    }
    // The fixed keywords first, then the zone's own (model-written) name; never a room people pass through.
    const words = [...(ROOM_WORDS[zone.role] ?? []), zone.name.trim().toLowerCase()].filter(Boolean);
    for (const word of words) {
      const room = floor.rooms.find(
        (r) => r.label.toLowerCase().includes(word) && !claimed.has(r.id) && !reserved.has(r.id) && !CIRCULATION.test(r.label),
      );
      if (room) return [room.id];
    }
    return [];
  };
  // Quiet zones first, so a crowded zone gets only the suites they leave.
  const order: ZoneRole[] = ["quiet", "objective", "secure", "entry", "crowded"];
  const zoneList = [...manifest.zones].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
  const placedZones = new Map<string, PlacedZone>();
  for (const zone of zoneList) {
    const roomIds = roomsFor(zone);
    if (roomIds.length === 0) {
      const inReserved = zone.role === "quiet" && floor.rooms.some((r) => reserved.has(r.id) && suitesIn(r.label)(suiteOf(zone)));
      const reason = inReserved
        ? "its room is staged as the floor's occupied space, for the night cleaners"
        : `no room on the floor fits a ${zone.role} zone`;
      unplaced.push({ elementRole: `zone:${zone.id}`, reason });
      continue;
    }
    roomIds.forEach((id) => claimed.add(id));
    placedZones.set(zone.id, {
      zoneId: zone.id,
      role: zone.role,
      name: zone.name,
      roomIds,
      nodes: roomIds.flatMap((id) => roomNodes.get(id) ?? []),
      provenance: zone.provenance,
    });
  }
  const zones = manifest.zones.flatMap((z) => placedZones.get(z.id) ?? []);
  const byRole = (role: ZoneRole) => zones.filter((z) => z.role === role);

  // The objective: the anchored node, or the objective room's node farthest from the start.
  const objectiveZone = byRole("objective")[0];
  if (!objectiveZone) throw new PlacementError("no room on the floor fits the objective zone");
  const objectiveNode =
    anchors.objective && objectiveZone.nodes.includes(anchors.objective)
      ? anchors.objective
      : [...objectiveZone.nodes].sort(
          (a, b) => (fromStart.get(b) ?? -1) - (fromStart.get(a) ?? -1) || a.localeCompare(b),
        )[0];
  const objective = { nodeId: objectiveNode, zoneId: objectiveZone.zoneId, provenance: objectiveZone.provenance };

  // Locks: every lockable door into the objective and secure rooms.
  const locks: PlacedLock[] = [];
  const lockProvenance = profileProvenance("lockKind");
  for (const zone of [objectiveZone, ...byRole("secure")]) {
    const inside = new Set(zone.nodes);
    const doors = floor.edges
      .filter((e) => e.door?.lockable && inside.has(e.a) !== inside.has(e.b))
      .map((e) => e.door!.id)
      .sort();
    if (doors.length === 0) unplaced.push({ elementRole: `lock:${zone.zoneId}`, reason: "the room has no lockable door" });
    for (const doorId of doors) {
      // The lock's kind (from the era) first, then the zone that puts it on this door.
      locks.push({ doorId, zoneId: zone.zoneId, provenance: [...lockProvenance, ...zone.provenance] });
    }
  }

  // Where the player stands to pick the way to the objective: its doors' outside ends.
  const pickNodes = new Set(
    locks.filter((lock) => lock.zoneId === objectiveZone.zoneId).flatMap((lock) => {
      const inside = new Set(placedZones.get(lock.zoneId)!.nodes);
      return floor.edges
        .filter((e) => e.door?.id === lock.doorId)
        .flatMap((e) => [e.a, e.b].filter((id) => !inside.has(id)));
    }),
  );
  const quietNodes = new Set(byRole("quiet").flatMap((z) => z.nodes));
  // The night cleaners' rooms: guards walk their rounds elsewhere.
  const crowdedNodes = new Set(byRole("crowded").flatMap((z) => z.nodes));
  const lockedRooms = new Set([objectiveZone, ...byRole("secure")].flatMap((z) => z.roomIds));
  const isEntry = (id: string) => nodeById.get(id)!.tags.includes("entry");

  // Cameras: anchored covers first, then corridor runs nearest the start. No
  // camera watches where a lock is picked: a pick takes several turns, and a
  // sweeping camera would see one of them, so the objective could never be
  // reached quietly.
  const { cameraCount, cameraKind } = manifest.securityProfile;
  const cameraIds = Array.from({ length: cameraCount }, (_, i) => `C${i + 1}`);
  const covers = new Map<string, string[]>();
  for (const [id, cover] of Object.entries(anchors.cameras ?? {})) {
    const kept = cover.filter((node) => !pickNodes.has(node));
    if (cameraIds.includes(id) && onFloor(cover) && kept.length > 0) covers.set(id, kept);
  }
  const anchoredNodes = new Set([...covers.values()].flat());
  let runs: string[][] = floor.rooms
    .filter((r) => !claimed.has(r.id) && CORRIDOR.test(r.label))
    .map((r) => chainOf(adj, (roomNodes.get(r.id) ?? []).filter((id) => !anchoredNodes.has(id) && !isEntry(id) && !pickNodes.has(id)), fromStart))
    .filter((run) => run.length > 0);
  const wanted = cameraIds.length - covers.size;
  // Too few corridors: cut the longest run in two until there are enough.
  while (runs.length < wanted) {
    const longest = runs.reduce((best, run, i) => (run.length > runs[best].length ? i : best), 0);
    const run = runs[longest];
    if (!run || run.length < 2) break;
    const half = Math.ceil(run.length / 2);
    runs = [...runs.slice(0, longest), run.slice(0, half), run.slice(half), ...runs.slice(longest + 1)];
  }
  const near = (run: readonly string[]) => fromStart.get(run[0]) ?? Infinity;
  runs.sort((a, b) => near(a) - near(b) || a[0].localeCompare(b[0]));
  const freeIds = cameraIds.filter((id) => !covers.has(id));
  freeIds.forEach((id, i) => {
    if (runs[i]) covers.set(id, runs[i]);
    else unplaced.push({ elementRole: `camera:${id}`, reason: "the floor has no corridor left to cover" });
  });
  const cycle = CYCLE[cameraKind];
  const sightFromStart = new Set(floor.sightlines[start] ?? []);
  const cameras: PlacedCamera[] = cameraIds.flatMap((id): PlacedCamera[] => {
    const cover = covers.get(id);
    if (!cover) return [];
    const first = [...cover].sort((a, b) => (fromStart.get(a) ?? Infinity) - (fromStart.get(b) ?? Infinity) || a.localeCompare(b))[0];
    const moves = fromStart.get(first) ?? 0;
    // A player walking straight in steps onto `first` on turn `moves - 1`: the camera watches it then.
    const phase = mod(partOf(cover.indexOf(first), cover.length, cycle) - (moves - 1), cycle);
    return [
      {
        id,
        kind: cameraKind,
        cover,
        phase,
        approach: { nodeId: first, hops: moves, visibleFromStart: sightFromStart.has(first) },
        provenance: [...provenanceOf(`camera:${id}`, "profile:cameraCount"), ...profileProvenance("cameraKind")],
      },
    ];
  });

  // Guards: rounds in rooms clear of the way in and out of earshot of the
  // locks, each starting clear of every entry.
  const nearStart = new Set([...fromStart].filter(([, d]) => d <= ENTRY_CLEARANCE).map(([id]) => id));
  const earshot = new Set(
    [...pickNodes].flatMap((id) => {
      const range = DEFAULT_HEARING + (quietNodes.has(id) ? 1 : 0);
      return [...hops(adj, [id])].filter(([, d]) => d <= range).map(([node]) => node);
    }),
  );
  const covered = new Set(cameras.flatMap((c) => c.cover));

  // The dock post (SPEC §2 beat 5): the last guard of the force holds the
  // way in from the dock, on the nearest node to it that leaves the quiet
  // way in open. It carries the dock entry's Vexcel provenance first, then
  // its own from the guard force. With fewer than two guards, or no such
  // node, every guard walks a round.
  const { guardCount } = manifest.securityProfile;
  const dock = entries.find((e) => e.kind === "dock");
  let post: { node: string; entry: PlacedEntry } | null = null;
  if (dock && guardCount >= 2) {
    const fromDock = hops(adj, [dock.nodeId]);
    const candidates = floor.nodes
      .filter((n) => !lockedRooms.has(n.roomId) && !quietNodes.has(n.id) && !crowdedNodes.has(n.id) && !isEntry(n.id) && !covered.has(n.id))
      .filter((n) => !nearStart.has(n.id) && !earshot.has(n.id) && (fromEntries.get(n.id) ?? Infinity) > ENTRY_CLEARANCE)
      .filter((n) => !(floor.sightlines[n.id] ?? []).some((id) => nearStart.has(id)))
      .filter((n) => fromDock.has(n.id))
      .sort((a, b) => fromDock.get(a.id)! - fromDock.get(b.id)! || a.id.localeCompare(b.id));
    if (candidates[0]) post = { node: candidates[0].id, entry: dock };
  }
  const roundCount = post ? guardCount - 1 : guardCount;

  let chains = floor.rooms
    .filter((r) => !lockedRooms.has(r.id))
    .filter((r) => !(roomNodes.get(r.id) ?? []).some((id) => nearStart.has(id) || earshot.has(id)))
    .map((r) => ({
      roomId: r.id,
      chain: chainOf(
        adj,
        (roomNodes.get(r.id) ?? []).filter((id) => !quietNodes.has(id) && !crowdedNodes.has(id) && !isEntry(id) && id !== post?.node),
        fromStart,
      ),
    }))
    .filter((route) => route.chain.length > 0);
  // Too few rooms for the guard force: cut the longest round in two while both halves stay rounds.
  while (chains.length > 0 && chains.length < roundCount) {
    const longest = chains.reduce((best, c, i) => (c.chain.length > chains[best].chain.length ? i : best), 0);
    const { roomId, chain } = chains[longest];
    if (chain.length < 4) break;
    const half = Math.ceil(chain.length / 2);
    chains = [
      ...chains.slice(0, longest),
      { roomId, chain: chain.slice(0, half) },
      { roomId, chain: chain.slice(half) },
      ...chains.slice(longest + 1),
    ];
  }
  const routes = chains
    .map((route) => ({
      ...route,
      starts: route.chain.flatMap((id, i) => ((fromEntries.get(id) ?? Infinity) > ENTRY_CLEARANCE ? [i] : [])),
    }))
    .filter((route) => route.starts.length > 0)
    .sort((a, b) => b.chain.length - a.chain.length || a.chain[0].localeCompare(b.chain[0]));
  const guards: PlacedGuard[] = [];
  const tempo = profileProvenance("patrolTempo");
  for (let g = 0; g < roundCount; g++) {
    const id = `G${g + 1}`;
    if (routes.length === 0) {
      unplaced.push({ elementRole: `guard:${id}`, reason: "the floor has no room clear of the entries for a round" });
      continue;
    }
    const route = routes[g % routes.length];
    const sharing = Math.ceil((roundCount - (g % routes.length)) / routes.length);
    const nth = Math.floor(g / routes.length);
    const { chain, starts } = route;
    const turn = hash(seed, chain[0]) % starts.length;
    const at = starts[(turn + Math.floor((nth * starts.length) / sharing)) % starts.length];
    const last = chain.length - 1;
    const patrol =
      last === 0
        ? [chain[0]]
        : at === 0
          ? [chain[0], chain[last]]
          : at === last
            ? [chain[last], chain[0]]
            : [chain[at], chain[last], chain[0]];
    guards.push({ id, roomId: route.roomId, patrol, provenance: [...provenanceOf(`guard:${id}`, "profile:guardCount"), ...tempo] });
  }
  if (post) {
    const id = `G${guardCount}`;
    guards.push({
      id,
      roomId: nodeById.get(post.node)!.roomId,
      patrol: [post.node],
      post: { entryId: post.entry.entryId, rule: DOCK_POST_RULE },
      provenance: [...post.entry.provenance, ...provenanceOf(`guard:${id}`, "profile:guardCount")],
    });
  }

  // The engine's zones: the placed zones, and each entry as a zone of its own node.
  const engineZones: Record<string, readonly string[]> = {};
  for (const zone of zones) if (zone.nodes.length > 0) engineZones[zone.zoneId] = zone.nodes;
  for (const entry of entries) if (!Object.hasOwn(engineZones, entry.entryId)) engineZones[entry.entryId] = [entry.nodeId];

  // Night cleaners walk each crowded zone's room (SPEC §4.3).
  const cleaners: GuardSpec[] = byRole("crowded").flatMap((zone, i) => {
    const chain = chainOf(adj, zone.nodes.filter((id) => !isEntry(id)), fromStart);
    if (chain.length === 0) return [];
    return [{ id: `K${i + 1}`, patrol: chain.length > 1 ? [chain[0], chain[chain.length - 1]] : chain }];
  });

  const level: Level = {
    buildingId: manifest.buildingId,
    missionId: manifest.mission.id,
    seed,
    floor,
    start,
    objective: objective.nodeId,
    exits: entries.map((e) => e.nodeId),
    lockedDoors: locks.map((l) => l.doorId),
    pickTurns: PICK_TURNS[manifest.securityProfile.lockKind],
    patrolTempo: manifest.securityProfile.patrolTempo,
    guards: guards.map((g) => ({ id: g.id, patrol: g.patrol })),
    zones: engineZones,
    cameras: cameras.map(({ id, kind, cover, phase }) => ({ id, kind, cover, phase })),
    cleaners,
    quietZones: byRole("quiet").map((z) => z.zoneId).filter((id) => Object.hasOwn(engineZones, id)),
    hearing: DEFAULT_HEARING,
  };

  return { level, entries, zones, objective, locks, cameras, guards, unplaced };
}
