// The owner's setup as a level (Owner Mode, SPEC §13, #28). `validateOwnerSetup`
// checks a setup against a floor and names every problem with a reason;
// `applyOwnerSetup` turns a valid one into the same placement the placer
// returns, with the owner's guards, cameras, locks and staffed desks in place
// of the rules table's, so the engine starts a run from it unchanged.
//
// Only the security changes: the entries, zones and objective still come from
// the manifest through the placer, as the spec has it ("the floor graph and
// entries are unchanged"). The generated cleaners are replaced too: the setup
// says who watches the floor, with its own cleaners and staffed desks. Every
// element the setup places carries owner provenance (`layer: "owner"`), so a
// Why card says the owner put it there and nothing reads as data-derived,
// except the elements the setup lists as still generated: those keep the
// data's provenance, and play as the rules table places them on each seed, so
// the generated security converted to a setup plays the generated level.
//
// It runs in the browser beside the placer, so a live Matterport floor never
// leaves the page (SPEC §4.5). Pure: no I/O, no clock, no randomness; the
// inputs are never mutated.
"use client";

import type { CameraKind, FloorGraph, LevelManifest, Provenance } from "@/domain";
import type { Compass, OwnerCameraKind, OwnerDoorLock, OwnerProvenance, OwnerSetup } from "@/domain/owner-setup";
import { compileBoard, type CameraSpec, type GuardSpec, type Level } from "@/engine";
import { roundOf } from "@/engine/autoplay";
import { placeLevel, type PlacedCamera, type PlacedGuard, type PlacedLevel, type PlacedLock } from "./placer";

// ---- validation ---------------------------------------------------------------

export type OwnerSetupErrorCode =
  | "duplicate-id"
  | "guard-off-floor"
  | "round-off-floor"
  | "round-broken"
  | "post-off-round"
  | "camera-off-floor"
  | "cleaner-off-floor"
  | "generated-unknown"
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
  duplicates((setup.cleaners ?? []).map((c) => c.id), "cleaner", (id) => `cleaner:${id}`);

  // A loop: each node a neighbour of the next, and the last of the first (for two nodes, the same edge).
  const loop = (round: readonly string[], role: string, who: string) =>
    round.forEach((id, i) => {
      const next = round[(i + 1) % round.length];
      if (round.length === 1 || (i === round.length - 1 && round.length === 2)) return;
      if (!linked.has(`${id} ${next}`)) {
        add("round-broken", role, `${who} round is not a connected loop: "${id}" and "${next}" are not neighbours`);
      }
    });

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
    loop(guard.round, role, `Guard ${guard.id}'s`);
  }

  for (const cleaner of setup.cleaners ?? []) {
    const role = `cleaner:${cleaner.id}`;
    const off = cleaner.round.filter((id) => !nodes.has(id));
    for (const id of new Set(off)) {
      add("cleaner-off-floor", role, `Cleaner ${cleaner.id}'s round passes "${id}", which is not a node of this floor`);
    }
    if (off.length === 0) loop(cleaner.round, role, `Cleaner ${cleaner.id}'s`);
  }

  for (const camera of setup.cameras) {
    const role = `camera:${camera.id}`;
    if (!nodes.has(camera.node)) {
      add("camera-off-floor", role, `Camera ${camera.id} is mounted over "${camera.node}", which is not a node of this floor`);
    }
    for (const id of new Set((camera.cover ?? []).filter((n) => !nodes.has(n)))) {
      add("camera-off-floor", role, `Camera ${camera.id} covers "${id}", which is not a node of this floor`);
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

  // The generated list names only elements the setup has.
  const has = {
    guards: new Set(setup.guards.map((g) => g.id)),
    cameras: new Set(setup.cameras.map((c) => c.id)),
    cleaners: new Set((setup.cleaners ?? []).map((c) => c.id)),
    doors: new Set(Object.entries(setup.doors).flatMap(([id, lock]) => (lock === "open" ? [] : [id]))),
  };
  const what = { guards: "guard", cameras: "camera", cleaners: "cleaner", doors: "locked door" } as const;
  for (const list of ["guards", "cameras", "cleaners", "doors"] as const) {
    for (const id of new Set(setup.generated?.[list] ?? [])) {
      if (!has[list].has(id)) {
        add("generated-unknown", `generated:${id}`, `The setup lists ${what[list]} "${id}" as generated, but has no such ${what[list]}`);
      }
    }
  }
  return errors;
}

// ---- what applying a setup returns -----------------------------------------------

/** The rule every element the setup places carries: the Why card's line for it. */
export const OWNER_RULE = "Placed by the owner's setup";

/** Picks to open a locked door, by what locks it. A key lock is SPEC §4.3's 2; a badge reader's 3 is Owner Mode's own (§4.3 gives readers no pick time). */
export const OWNER_PICK_TURNS: Readonly<Record<Exclude<OwnerDoorLock, "open">, number>> = { key: 2, badge: 3 };

/** The owner's kind for each engine kind the rules table places. */
export const OWNER_KIND_OF: Readonly<Record<CameraKind, OwnerCameraKind>> = {
  "analog-sweep": "sweeping",
  ptz: "ptz",
  "fixed-ip": "fixed",
  "ip-analytics": "fixed",
};

/** The engine's camera kind for each kind the owner picks from. */
export const OWNER_CAMERA_KIND: Readonly<Record<OwnerCameraKind, CameraKind>> = {
  sweeping: "analog-sweep",
  ptz: "ptz",
  fixed: "fixed-ip",
};

/** The owner's provenance, or, for an element still as generated, the data's. */
type Owned<T> = Omit<T, "provenance"> & { provenance: readonly (OwnerProvenance | Provenance)[] };

export interface OwnerPlacedGuard extends Owned<PlacedGuard> {
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

export interface OwnerPlacedCleaner {
  id: string;
  roomId: string;
  /** Waypoints, as the engine's cleaner patrol: it starts on the first. */
  patrol: readonly string[];
  provenance: readonly (OwnerProvenance | Provenance)[];
}

export interface OwnerPlacedDesk {
  /** The desk's watcher in the engine: a cleaner that never moves. */
  id: string;
  nodeId: string;
  roomId: string;
  provenance: readonly OwnerProvenance[];
}

/** The placer's level with the owner's security in it. Entries, zones and the objective are the placer's. */
export interface OwnerPlacedLevel extends Omit<PlacedLevel, "guards" | "cameras" | "locks" | "cleaners"> {
  setupName: string;
  guards: readonly OwnerPlacedGuard[];
  cameras: readonly OwnerPlacedCamera[];
  locks: readonly OwnerPlacedLock[];
  cleaners: readonly OwnerPlacedCleaner[];
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

/** True when `a` is `b` begun at another point: the same loop. */
function sameLoop(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.length === 0 || a.some((_, k) => b.every((id, i) => a[(i + k) % a.length] === id));
}

const sameCover = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

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
 * varies in a generated run: the engine's tie-breaks, and where a walker still
 * listed as generated starts its round (where the rules table starts it). The
 * owner's own guards start on their posts.
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

  const generated = {
    guards: new Set(setup.generated?.guards ?? []),
    cameras: new Set(setup.generated?.cameras ?? []),
    cleaners: new Set(setup.generated?.cleaners ?? []),
    doors: new Set(setup.generated?.doors ?? []),
  };
  const baseBoard = compileBoard(base.level);
  /** The rules table's walk for a walker listed as generated, when it walks the same loop as the setup's. */
  const asGenerated = (patrol: readonly string[] | undefined, round: readonly string[]) =>
    patrol && sameLoop(roundOf(baseBoard, patrol), round) ? patrol : null;

  const guards: OwnerPlacedGuard[] = setup.guards.map((g) => {
    // The guard starts on its post and walks the round on from there.
    const at = g.round.indexOf(g.post);
    const round = at < 0 ? [g.post] : [...g.round.slice(at), ...g.round.slice(0, at)];
    const from = generated.guards.has(g.id) ? base.guards.find((b) => b.id === g.id) : undefined;
    const kept = from && asGenerated(from.patrol, round) ? from : null;
    return {
      id: g.id,
      roomId: kept ? kept.roomId : roomOf.get(g.post)!,
      patrol: kept ? kept.patrol : round,
      ...(kept?.post && { post: kept.post }),
      tempo: g.tempo,
      provenance: kept ? kept.provenance : owner(`guard:${g.id}`, `guards.${g.id}`),
    };
  });

  const cleaners: OwnerPlacedCleaner[] = (setup.cleaners ?? []).map((c) => {
    const from = generated.cleaners.has(c.id) ? base.level.cleaners?.find((b) => b.id === c.id) : undefined;
    const kept = asGenerated(from?.patrol, c.round);
    // A generated cleaner walks a crowded zone: that zone's data says why it is there.
    const zone = kept ? base.zones.find((z) => z.role === "crowded" && z.nodes.includes(kept[0])) : undefined;
    return {
      id: c.id,
      roomId: roomOf.get(c.round[0])!,
      patrol: kept ?? c.round,
      provenance: kept && zone ? zone.provenance : owner(`cleaner:${c.id}`, `cleaners.${c.id}`),
    };
  });

  const fromStart = hopsFrom(floor, base.level.start);
  const sightFromStart = new Set(floor.sightlines[base.level.start] ?? []);
  const cameras: OwnerPlacedCamera[] = setup.cameras.map((c) => {
    const cover = c.cover ? [...c.cover] : cameraCover(floor, c.node, c.facing, c.kind);
    const from = generated.cameras.has(c.id) ? base.cameras.find((b) => b.id === c.id) : undefined;
    // Still as generated: the same cover and kind, so the rules table's camera, with its phase and provenance.
    const kept = from && OWNER_KIND_OF[from.kind] === c.kind && sameCover(from.cover, cover) ? from : null;
    const first = [...cover].sort((a, b) => (fromStart.get(a) ?? Infinity) - (fromStart.get(b) ?? Infinity) || a.localeCompare(b))[0];
    return {
      id: c.id,
      kind: kept ? kept.kind : OWNER_CAMERA_KIND[c.kind],
      cover,
      phase: kept ? kept.phase : 0,
      facing: c.facing,
      approach: { nodeId: first, hops: fromStart.get(first) ?? 0, visibleFromStart: sightFromStart.has(first) },
      provenance: kept ? kept.provenance : owner(`camera:${c.id}`, `cameras.${c.id}`),
    };
  });

  const locks: OwnerPlacedLock[] = Object.entries(setup.doors)
    .flatMap(([doorId, lock]) => (lock === "open" ? [] : [{ doorId, lock }]))
    .sort((a, b) => a.doorId.localeCompare(b.doorId))
    .map(({ doorId, lock }) => {
      const ends = floor.edges.filter((e) => e.door?.id === doorId).flatMap((e) => [e.a, e.b]);
      const closes = base.zones.find((z) => ends.filter((id) => z.nodes.includes(id)).length === 1);
      // Still as generated: the rules table's lock, its pick turns and why it is there.
      const from = generated.doors.has(doorId) ? base.locks.find((l) => l.doorId === doorId) : undefined;
      return {
        doorId,
        lock,
        pickTurns: from ? base.level.pickTurns : OWNER_PICK_TURNS[lock],
        zoneId: from?.zoneId ?? closes?.zoneId ?? null,
        provenance: from ? from.provenance : owner(`lock:${doorId}`, `doors.${doorId}`),
      };
    });

  // Each desk's watcher takes the next D id no cleaner has.
  const taken = new Set(cleaners.map((c) => c.id));
  const desks: OwnerPlacedDesk[] = setup.desks.map((nodeId) => {
    let n = 1;
    while (taken.has(`D${n}`)) n++;
    taken.add(`D${n}`);
    return { id: `D${n}`, nodeId, roomId: roomOf.get(nodeId)!, provenance: owner(`desk:${nodeId}`, `desks.${nodeId}`) };
  });

  const level: Level = {
    ...base.level,
    lockedDoors: locks.map((l) => l.doorId),
    pickTurns: base.level.pickTurns,
    doorPickTurns: Object.fromEntries(locks.map((l) => [l.doorId, l.pickTurns])),
    guards: guards.map((g): GuardSpec => ({ id: g.id, patrol: g.patrol })),
    guardTempo: Object.fromEntries(guards.map((g) => [g.id, g.tempo])),
    cameras: cameras.map(({ id, kind, cover, phase }): CameraSpec => ({ id, kind, cover, phase })),
    cleaners: [
      ...cleaners.map((c): GuardSpec => ({ id: c.id, patrol: c.patrol })),
      ...desks.map((d): GuardSpec => ({ id: d.id, patrol: [d.nodeId] })),
    ],
  };

  // The placer's own security misses are not this level's: only its entries' and zones' stay.
  const unplaced = base.unplaced.filter((u) => !/^(guard|camera|lock|cleaner):/.test(u.elementRole));
  return {
    ok: true,
    placed: { ...base, level, setupName: setup.name, guards, cameras, locks, cleaners, desks, unplaced },
  };
}
