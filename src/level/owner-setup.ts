// The owner's setup as a level (Owner Mode, SPEC §13, #125). `validateOwnerSetup`
// checks a setup against a floor and names every problem with a reason;
// `applyOwnerSetup` turns a valid one into the same placement the placer
// returns, with the owner's guards, cameras, locks and staffed desks in place
// of the rules table's, so the engine starts a run from it unchanged.
//
// Only the security changes: the entries, zones and objective still come from
// the manifest through the placer, as the spec has it ("the floor graph and
// entries are unchanged"). The generated cleaners are dropped too: the setup
// says who watches the floor, and its staffed desks take their place. Every
// element the setup places carries owner provenance (`layer: "owner"`), so a
// Why card says the owner put it there and nothing reads as data-derived.
//
// It runs in the browser beside the placer, so a live Matterport floor never
// leaves the page (SPEC §4.5). Pure: no I/O, no clock, no randomness; the
// inputs are never mutated.
"use client";

import type { CameraKind, FloorGraph, LevelManifest } from "@/domain";
import type { Compass, OwnerCameraKind, OwnerDoorLock, OwnerProvenance, OwnerSetup } from "@/domain/owner-setup";
import type { CameraSpec, GuardSpec, Level } from "@/engine";
import { placeLevel, type PlacedCamera, type PlacedGuard, type PlacedLevel, type PlacedLock } from "./placer";

// ---- validation ---------------------------------------------------------------

export type OwnerSetupErrorCode =
  | "duplicate-id"
  | "guard-off-floor"
  | "round-off-floor"
  | "round-broken"
  | "post-off-round"
  | "camera-off-floor"
  | "desk-off-floor"
  | "unknown-door"
  | "door-not-lockable"
  | "wrong-building";

/** One problem with a setup: what it is, the element it is on (`guard:G1`), and why, in words. */
export interface OwnerSetupError {
  code: OwnerSetupErrorCode;
  elementRole: string;
  reason: string;
}

/** Every problem with `setup` on `floor`, in the setup's order; empty when it can be played. */
export function validateOwnerSetup(setup: OwnerSetup, floor: FloorGraph): OwnerSetupError[] {
  const errors: OwnerSetupError[] = [];
  const add = (code: OwnerSetupErrorCode, elementRole: string, reason: string) => errors.push({ code, elementRole, reason });
  const nodes = new Set(floor.nodes.map((n) => n.id));
  const linked = new Set(floor.edges.flatMap((e) => [`${e.a} ${e.b}`, `${e.b} ${e.a}`]));
  const doors = new Map(floor.edges.flatMap((e) => (e.door ? [[e.door.id, e.door.lockable] as const] : [])));

  const duplicates = (ids: readonly string[], what: string, role: (id: string) => string) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) add("duplicate-id", role(id), `The setup has more than one ${what} "${id}"`);
      seen.add(id);
    }
  };
  duplicates(setup.guards.map((g) => g.id), "guard", (id) => `guard:${id}`);
  duplicates(setup.cameras.map((c) => c.id), "camera", (id) => `camera:${id}`);
  duplicates(setup.desks, "desk on node", (id) => `desk:${id}`);

  for (const guard of setup.guards) {
    const role = `guard:${guard.id}`;
    if (!nodes.has(guard.post)) {
      add("guard-off-floor", role, `Guard ${guard.id} is posted on "${guard.post}", which is not a node of this floor`);
    }
    const off = guard.round.filter((id) => !nodes.has(id));
    for (const id of new Set(off)) {
      add("round-off-floor", role, `Guard ${guard.id}'s round passes "${id}", which is not a node of this floor`);
    }
    if (off.length > 0 || guard.round.length === 0) continue;
    if (!guard.round.includes(guard.post)) {
      add("post-off-round", role, `Guard ${guard.id}'s post "${guard.post}" is not on its round`);
    }
    if (guard.round.length === 1) continue;
    // A loop: each node a neighbour of the next, and the last of the first (for two nodes, the same edge).
    guard.round.forEach((id, i) => {
      const next = guard.round[(i + 1) % guard.round.length];
      if (i === guard.round.length - 1 && guard.round.length === 2) return;
      if (!linked.has(`${id} ${next}`)) {
        add("round-broken", role, `Guard ${guard.id}'s round is not a connected loop: "${id}" and "${next}" are not neighbours`);
      }
    });
  }

  for (const camera of setup.cameras) {
    if (!nodes.has(camera.node)) {
      add("camera-off-floor", `camera:${camera.id}`, `Camera ${camera.id} is mounted over "${camera.node}", which is not a node of this floor`);
    }
  }

  for (const [doorId, lock] of Object.entries(setup.doors)) {
    if (!doors.has(doorId)) {
      add("unknown-door", `door:${doorId}`, `"${doorId}" is not a door of this floor`);
    } else if (lock !== "open" && !doors.get(doorId)) {
      add("door-not-lockable", `door:${doorId}`, `Door "${doorId}" cannot take a ${lock === "key" ? "key lock" : "badge reader"}: it does not lock`);
    }
  }

  for (const desk of new Set(setup.desks)) {
    if (!nodes.has(desk)) add("desk-off-floor", `desk:${desk}`, `The staffed desk at "${desk}" is not on a node of this floor`);
  }
  return errors;
}

// ---- what applying a setup returns -----------------------------------------------

/** The rule every element the setup places carries: the Why card's line for it. */
export const OWNER_RULE = "Placed by the owner's setup";

/** Picks to open a locked door, by what locks it. A key lock is SPEC §4.3's 2; a badge reader's 3 is Owner Mode's own (§4.3 gives readers no pick time). */
export const OWNER_PICK_TURNS: Readonly<Record<Exclude<OwnerDoorLock, "open">, number>> = { key: 2, badge: 3 };

/** The engine's camera kind for each kind the owner picks from. */
export const OWNER_CAMERA_KIND: Readonly<Record<OwnerCameraKind, CameraKind>> = {
  sweeping: "analog-sweep",
  ptz: "ptz",
  fixed: "fixed-ip",
};

type Owned<T> = Omit<T, "provenance"> & { provenance: readonly OwnerProvenance[] };

export interface OwnerPlacedGuard extends Owned<Omit<PlacedGuard, "post">> {
  /** Turns per hop, from the setup. */
  tempo: number;
}

export interface OwnerPlacedCamera extends Owned<PlacedCamera> {
  facing: Compass;
}

export interface OwnerPlacedLock extends Owned<Omit<PlacedLock, "zoneId">> {
  lock: Exclude<OwnerDoorLock, "open">;
  pickTurns: number;
  /** The placed zone the door closes, when one zone holds exactly one side of it. */
  zoneId: string | null;
}

export interface OwnerPlacedDesk {
  /** The desk's watcher in the engine: a cleaner that never moves. */
  id: string;
  nodeId: string;
  roomId: string;
  provenance: readonly OwnerProvenance[];
}

/** The placer's level with the owner's security in it. Entries, zones and the objective are the placer's. */
export interface OwnerPlacedLevel extends Omit<PlacedLevel, "guards" | "cameras" | "locks"> {
  setupName: string;
  guards: readonly OwnerPlacedGuard[];
  cameras: readonly OwnerPlacedCamera[];
  locks: readonly OwnerPlacedLock[];
  desks: readonly OwnerPlacedDesk[];
}

export type OwnerSetupResult = { ok: true; placed: OwnerPlacedLevel } | { ok: false; errors: readonly OwnerSetupError[] };

// ---- applying a setup ---------------------------------------------------------------

/** Floor-plan directions; y grows down the plan, so north is -y. */
const DIRECTION: Readonly<Record<Compass, { dx: number; dy: number }>> = {
  n: { dx: 0, dy: -1 },
  ne: { dx: Math.SQRT1_2, dy: -Math.SQRT1_2 },
  e: { dx: 1, dy: 0 },
  se: { dx: Math.SQRT1_2, dy: Math.SQRT1_2 },
  s: { dx: 0, dy: 1 },
  sw: { dx: -Math.SQRT1_2, dy: Math.SQRT1_2 },
  w: { dx: -1, dy: 0 },
  nw: { dx: -Math.SQRT1_2, dy: -Math.SQRT1_2 },
};

/** A fixed camera sees this far either side of where it points; a sweeping or PTZ camera, up to 90°. */
const FIXED_HALF_ANGLE = Math.PI / 4;

/**
 * The nodes a camera on `node` facing `facing` can cover, in sweep order:
 * itself and the nodes in its sightlines ahead of it, from its left to its
 * right, so the engine's halves (sweep) and thirds (PTZ) are arcs of its view.
 */
export function cameraCover(floor: FloorGraph, node: string, facing: Compass, kind: OwnerCameraKind): string[] {
  const at = new Map(floor.nodes.map((n) => [n.id, n]));
  const here = at.get(node)!;
  const { dx, dy } = DIRECTION[facing];
  const limit = kind === "fixed" ? FIXED_HALF_ANGLE : Math.PI / 2;
  const seen = (floor.sightlines[node] ?? [])
    .filter((id) => id !== node && at.has(id))
    .map((id) => {
      const there = at.get(id)!;
      const [vx, vy] = [there.x - here.x, there.y - here.y];
      return { id, angle: Math.atan2(dx * vy - dy * vx, dx * vx + dy * vy), dist: Math.hypot(vx, vy) };
    })
    .filter((n) => n.dist > 0 && Math.abs(n.angle) < limit - 1e-9);
  return [{ id: node, angle: 0, dist: 0 }, ...seen]
    .sort((a, b) => a.angle - b.angle || a.dist - b.dist || a.id.localeCompare(b.id))
    .map((n) => n.id);
}

/** Moves from `from` to every node it reaches. */
function hopsFrom(floor: FloorGraph, from: string): Map<string, number> {
  const adj = new Map<string, string[]>(floor.nodes.map((n) => [n.id, []]));
  for (const e of floor.edges) {
    adj.get(e.a)!.push(e.b);
    adj.get(e.b)!.push(e.a);
  }
  const dist = new Map([[from, 0]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    for (const next of adj.get(queue[i]) ?? []) {
      if (!dist.has(next)) {
        dist.set(next, dist.get(queue[i])! + 1);
        queue.push(next);
      }
    }
  }
  return dist;
}

/**
 * The manifest's level on `floor` with the owner's security in place of the
 * rules table's. Returns every validation problem instead when the setup does
 * not fit the floor or names another building. The seed varies only what it
 * varies in a generated run (the engine's tie-breaks); the owner's guards
 * start on their posts.
 */
export function applyOwnerSetup(manifest: LevelManifest, floor: FloorGraph, setup: OwnerSetup, seed: number): OwnerSetupResult {
  const errors = validateOwnerSetup(setup, floor);
  if (setup.buildingId !== manifest.buildingId) {
    errors.unshift({
      code: "wrong-building",
      elementRole: `setup:${setup.name}`,
      reason: `The setup "${setup.name}" is for building ${setup.buildingId}, not ${manifest.buildingId}`,
    });
  }
  if (errors.length > 0) return { ok: false, errors };

  const base = placeLevel(manifest, floor, seed);
  const roomOf = new Map(floor.nodes.map((n) => [n.id, n.roomId]));
  const owner = (elementRole: string, field: string): OwnerProvenance[] => [
    { elementRole, layer: "owner", field, value: setup.name, rule: OWNER_RULE },
  ];

  const guards: OwnerPlacedGuard[] = setup.guards.map((g) => {
    // The guard starts on its post and walks the round on from there.
    const at = g.round.indexOf(g.post);
    const patrol = at < 0 ? [g.post] : [...g.round.slice(at), ...g.round.slice(0, at)];
    return { id: g.id, roomId: roomOf.get(g.post)!, patrol, tempo: g.tempo, provenance: owner(`guard:${g.id}`, `guards.${g.id}`) };
  });

  const fromStart = hopsFrom(floor, base.level.start);
  const sightFromStart = new Set(floor.sightlines[base.level.start] ?? []);
  const cameras: OwnerPlacedCamera[] = setup.cameras.map((c) => {
    const cover = cameraCover(floor, c.node, c.facing, c.kind);
    const first = [...cover].sort((a, b) => (fromStart.get(a) ?? Infinity) - (fromStart.get(b) ?? Infinity) || a.localeCompare(b))[0];
    return {
      id: c.id,
      kind: OWNER_CAMERA_KIND[c.kind],
      cover,
      phase: 0,
      facing: c.facing,
      approach: { nodeId: first, hops: fromStart.get(first) ?? 0, visibleFromStart: sightFromStart.has(first) },
      provenance: owner(`camera:${c.id}`, `cameras.${c.id}`),
    };
  });

  const locks: OwnerPlacedLock[] = Object.entries(setup.doors)
    .flatMap(([doorId, lock]) => (lock === "open" ? [] : [{ doorId, lock }]))
    .sort((a, b) => a.doorId.localeCompare(b.doorId))
    .map(({ doorId, lock }) => {
      const ends = floor.edges.filter((e) => e.door?.id === doorId).flatMap((e) => [e.a, e.b]);
      const closes = base.zones.find((z) => ends.filter((id) => z.nodes.includes(id)).length === 1);
      return {
        doorId,
        lock,
        pickTurns: OWNER_PICK_TURNS[lock],
        zoneId: closes?.zoneId ?? null,
        provenance: owner(`lock:${doorId}`, `doors.${doorId}`),
      };
    });

  const desks: OwnerPlacedDesk[] = setup.desks.map((nodeId, i) => ({
    id: `D${i + 1}`,
    nodeId,
    roomId: roomOf.get(nodeId)!,
    provenance: owner(`desk:${nodeId}`, `desks.${nodeId}`),
  }));

  const level: Level = {
    ...base.level,
    lockedDoors: locks.map((l) => l.doorId),
    pickTurns: OWNER_PICK_TURNS.key,
    doorPickTurns: Object.fromEntries(locks.map((l) => [l.doorId, l.pickTurns])),
    guards: guards.map((g): GuardSpec => ({ id: g.id, patrol: g.patrol })),
    guardTempo: Object.fromEntries(guards.map((g) => [g.id, g.tempo])),
    cameras: cameras.map(({ id, kind, cover, phase }): CameraSpec => ({ id, kind, cover, phase })),
    cleaners: desks.map((d): GuardSpec => ({ id: d.id, patrol: [d.nodeId] })),
  };

  // The placer's own security misses are not this level's: only its entries' and zones' stay.
  const unplaced = base.unplaced.filter((u) => !/^(guard|camera|lock):/.test(u.elementRole));
  return {
    ok: true,
    placed: { ...base, level, setupName: setup.name, guards, cameras, locks, desks, unplaced },
  };
}
