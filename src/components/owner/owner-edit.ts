// The Owner screen's setup, as the editor works it (Owner Mode, SPEC §13,
// issues 125 and 128). Pure: every edit returns a new setup and never mutates
// the last. The setup starts from the building's generated security, turned
// into the owner's terms, so the editor is never empty; while it is untouched
// the batch plays the generated level itself, so the screen's first count is
// the batch debrief's (issue 127). Everything here stays in the browser.
"use client";

import type { CameraKind, ChiefFix, FloorGraph, LevelManifest } from "@/domain";
import {
  OWNER_SETUP_VERSION,
  type Compass,
  type OwnerCamera,
  type OwnerCameraKind,
  type OwnerDoorLock,
  type OwnerGuard,
  type OwnerSetup,
} from "@/domain/owner-setup";
import { compileBoard, zoneTarget, type Level } from "@/engine";
import { roundOf } from "@/engine/autoplay";
import { applyOwnerSetup, cameraCover, validateOwnerSetup, type OwnerSetupError } from "@/level/owner-setup";
import { placeLevel, type PlacedLevel } from "@/level/placer";

export const COMPASS: readonly Compass[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
export const CAMERA_KINDS: readonly OwnerCameraKind[] = ["sweeping", "ptz", "fixed"];
export const DOOR_LOCKS: readonly OwnerDoorLock[] = ["key", "badge", "open"];

/** The owner's kind for each engine kind the rules table places. */
const KIND_OF: Readonly<Record<CameraKind, OwnerCameraKind>> = {
  "analog-sweep": "sweeping",
  ptz: "ptz",
  "fixed-ip": "fixed",
  "ip-analytics": "fixed",
};

/** The name the starting setup carries. */
export const STARTING_NAME = "Generated security";

/**
 * The placed level's security as an owner's setup: each guard's round as the
 * node loop it walks, each camera on the node and facing whose view comes
 * nearest its generated cover, every locked door a key lock. The rules
 * table's night cleaners walk, and a setup has only staffed desks, so they
 * are left out.
 */
export function setupFromPlaced(placed: PlacedLevel, name: string = STARTING_NAME): OwnerSetup {
  const { level } = placed;
  const { floor } = level;
  const board = compileBoard(level);
  const guards: OwnerGuard[] = level.guards.map((g) => {
    const round = roundOf(board, g.patrol);
    return {
      id: g.id,
      post: round[0] ?? g.patrol[0],
      round: round.length > 1 ? round : [],
      tempo: level.guardTempo?.[g.id] ?? level.patrolTempo,
    };
  });
  const cameras: OwnerCamera[] = (level.cameras ?? []).map((c) => nearestCamera(floor, c.id, c.cover, KIND_OF[c.kind]));
  const doors = Object.fromEntries([...level.lockedDoors].sort().map((id) => [id, "key" as const]));
  return { version: OWNER_SETUP_VERSION, name, buildingId: level.buildingId, guards, cameras, doors, desks: [] };
}

function nearestCamera(floor: FloorGraph, id: string, cover: readonly string[], kind: OwnerCameraKind): OwnerCamera {
  const want = new Set(cover);
  let best: { node: string; facing: Compass; score: number } | null = null;
  for (const node of cover) {
    for (const facing of COMPASS) {
      const got = cameraCover(floor, node, facing, kind);
      const both = got.filter((n) => want.has(n)).length;
      const score = both / (want.size + got.length - both);
      if (!best || score > best.score) best = { node, facing, score };
    }
  }
  return { id, node: best?.node ?? cover[0], kind, facing: best?.facing ?? "n" };
}

/**
 * The level a batch plays on `seed`: the generated one while the setup is
 * untouched (`setup` null), else the owner's, applied over the placer's
 * entries and zones. Null when the setup has a problem.
 */
export function levelForSetup(manifest: LevelManifest, floor: FloorGraph, setup: OwnerSetup | null, seed: number): Level | null {
  if (!setup) return placeLevel(manifest, floor, seed).level;
  const applied = applyOwnerSetup(manifest, floor, setup, seed);
  return applied.ok ? applied.placed.level : null;
}

/** The board's picture of a setup: the placer's level, with the owner's security on it, and no data-layer provenance. */
export function boardOf(manifest: LevelManifest, floor: FloorGraph, setup: OwnerSetup | null, seed: number): PlacedLevel | null {
  const base = placeLevel(manifest, floor, seed);
  if (!setup) return base;
  const applied = applyOwnerSetup(manifest, floor, setup, seed);
  if (!applied.ok) return null;
  const { placed } = applied;
  return {
    ...base,
    level: placed.level,
    guards: placed.guards.map((g) => ({ id: g.id, roomId: g.roomId, patrol: g.patrol, provenance: [] })),
    cameras: placed.cameras.map((c) => ({ id: c.id, kind: c.kind, cover: c.cover, phase: c.phase, approach: c.approach, provenance: [] })),
    locks: placed.locks.map((l) => ({ doorId: l.doorId, zoneId: l.zoneId ?? "", provenance: [] })),
  };
}

// ---- edits ------------------------------------------------------------------------

/** The next free id with `prefix`: G4 after G1 to G3. */
export function nextId(prefix: string, taken: readonly string[]): string {
  let n = 1;
  while (taken.includes(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

const takenIds = (setup: OwnerSetup) => [...setup.guards.map((g) => g.id), ...setup.cameras.map((c) => c.id)];

export function addGuard(setup: OwnerSetup, node: string, tempo = 1): { setup: OwnerSetup; id: string } {
  const id = nextId("G", takenIds(setup));
  return { setup: { ...setup, guards: [...setup.guards, { id, post: node, round: [], tempo }] }, id };
}

/** Moves the guard's post; a round that no longer passes the post is walked from the new post instead (it stands there). */
export function moveGuard(setup: OwnerSetup, id: string, node: string): OwnerSetup {
  return {
    ...setup,
    guards: setup.guards.map((g) => (g.id === id ? { ...g, post: node, round: g.round.includes(node) ? g.round : [] } : g)),
  };
}

export function removeGuard(setup: OwnerSetup, id: string): OwnerSetup {
  return { ...setup, guards: setup.guards.filter((g) => g.id !== id) };
}

/** Starts drawing a round: the post alone, so each next click adds a node. */
export function startRound(setup: OwnerSetup, id: string): OwnerSetup {
  return { ...setup, guards: setup.guards.map((g) => (g.id === id ? { ...g, round: [g.post] } : g)) };
}

/** Adds `node` to the end of the round being drawn; the last node again takes it off. */
export function extendRound(setup: OwnerSetup, id: string, node: string): OwnerSetup {
  return {
    ...setup,
    guards: setup.guards.map((g) => {
      if (g.id !== id) return g;
      const round = g.round.length === 0 ? [g.post] : g.round;
      if (round[round.length - 1] === node && round.length > 1) return { ...g, round: round.slice(0, -1) };
      return { ...g, round: [...round, node] };
    }),
  };
}

/** The guard stands its post: no round. */
export function clearRound(setup: OwnerSetup, id: string): OwnerSetup {
  return { ...setup, guards: setup.guards.map((g) => (g.id === id ? { ...g, round: [] } : g)) };
}

export function setTempo(setup: OwnerSetup, id: string, tempo: number): OwnerSetup {
  return { ...setup, guards: setup.guards.map((g) => (g.id === id ? { ...g, tempo: Math.max(1, Math.round(tempo)) } : g)) };
}

export function addCamera(setup: OwnerSetup, node: string, kind: OwnerCameraKind = "sweeping", facing: Compass = "n"): { setup: OwnerSetup; id: string } {
  const id = nextId("C", takenIds(setup));
  return { setup: { ...setup, cameras: [...setup.cameras, { id, node, kind, facing }] }, id };
}

export function updateCamera(setup: OwnerSetup, id: string, change: Partial<Omit<OwnerCamera, "id">>): OwnerSetup {
  return { ...setup, cameras: setup.cameras.map((c) => (c.id === id ? { ...c, ...change } : c)) };
}

export function removeCamera(setup: OwnerSetup, id: string): OwnerSetup {
  return { ...setup, cameras: setup.cameras.filter((c) => c.id !== id) };
}

export function setDoor(setup: OwnerSetup, doorId: string, lock: OwnerDoorLock): OwnerSetup {
  const doors = { ...setup.doors };
  if (lock === "open") delete doors[doorId];
  else doors[doorId] = lock;
  return { ...setup, doors };
}

export function toggleDesk(setup: OwnerSetup, node: string): OwnerSetup {
  return { ...setup, desks: setup.desks.includes(node) ? setup.desks.filter((d) => d !== node) : [...setup.desks, node] };
}

// ---- validation, as the editor shows it -----------------------------------------------

/** Every problem, and each element's problems by its role (`guard:G1`). */
export function problemsOf(setup: OwnerSetup, floor: FloorGraph): { all: OwnerSetupError[]; by: Map<string, OwnerSetupError[]> } {
  const all = validateOwnerSetup(setup, floor);
  const by = new Map<string, OwnerSetupError[]>();
  for (const e of all) by.set(e.elementRole, [...(by.get(e.elementRole) ?? []), e]);
  return { all, by };
}

/**
 * The setup with every element that has a problem taken back or out, for the
 * board to show while the owner fixes it: a guard whose round is wrong stands
 * its post, and whatever still does not fit the floor is left off.
 */
export function playable(setup: OwnerSetup, floor: FloorGraph): OwnerSetup {
  const roles = (s: OwnerSetup) => new Set(validateOwnerSetup(s, floor).map((e) => e.elementRole));
  let bad = roles(setup);
  if (bad.size === 0) return setup;
  let out: OwnerSetup = { ...setup, guards: setup.guards.map((g) => (bad.has(`guard:${g.id}`) ? { ...g, round: [] } : g)) };
  bad = roles(out);
  const once = (ids: readonly string[]) => ids.filter((id, i) => ids.indexOf(id) === i && ids.lastIndexOf(id) === i);
  const guardIds = new Set(once(out.guards.map((g) => g.id)));
  const cameraIds = new Set(once(out.cameras.map((c) => c.id)));
  out = {
    ...out,
    guards: out.guards.filter((g) => guardIds.has(g.id) && !bad.has(`guard:${g.id}`)),
    cameras: out.cameras.filter((c) => cameraIds.has(c.id) && !bad.has(`camera:${c.id}`)),
    doors: Object.fromEntries(Object.entries(out.doors).filter(([id]) => !bad.has(`door:${id}`))),
    desks: [...new Set(out.desks)].filter((d) => !bad.has(`desk:${d}`)),
  };
  return out;
}

// ---- the Chief's fix, in the owner's terms --------------------------------------------

/**
 * The setup with the Chief's change made, as near as a setup can say it (the
 * fix itself is a change to the engine's level): a moved camera goes on the
 * zone's node and facing that see most of it; a retimed guard starts its
 * round further back; a locked zone's doors get key locks; a new guard walks
 * the zone. `level` is a level of this building, for the zones' nodes and the
 * doors. The fix is in the engine's zone ids (`toEngineFix`).
 */
export function setupWithFix(setup: OwnerSetup, fix: ChiefFix, level: Level, name: string): OwnerSetup {
  const board = compileBoard(level);
  const { floor } = level;
  const { change } = fix;
  const zoneNodes = (id: string | undefined) => (id === undefined ? null : zoneTarget(board, id)?.nodes ?? null);
  const named = { ...setup, name };
  switch (change.kind) {
    case "move-camera": {
      const nodes = zoneNodes(change.to);
      const camera = setup.cameras.find((c) => c.id === change.elementId);
      if (!nodes || !camera) return named;
      const placed = nearestCamera(floor, camera.id, nodes, camera.kind);
      return { ...named, cameras: setup.cameras.map((c) => (c.id === camera.id ? placed : c)) };
    }
    case "retime-guard": {
      const by = change.byTurns ?? 0;
      return {
        ...named,
        guards: setup.guards.map((g) => {
          if (g.id !== change.elementId || g.round.length < 2) return g;
          const at = g.round.indexOf(g.post);
          const n = g.round.length;
          return { ...g, post: g.round[(((at - by) % n) + n) % n] };
        }),
      };
    }
    case "lock-door": {
      const nodes = zoneNodes(change.elementId);
      if (!nodes) return named;
      const inside = new Set(nodes);
      const doors = { ...setup.doors };
      for (const e of floor.edges) {
        if (e.door?.lockable && inside.has(e.a) !== inside.has(e.b) && !doors[e.door.id]) doors[e.door.id] = "key";
      }
      return { ...named, doors };
    }
    case "add-guard": {
      const nodes = zoneNodes(change.to);
      if (!nodes || setup.guards.some((g) => g.id === change.elementId)) return named;
      const away = nodes.filter((id) => !level.exits.includes(id));
      const round = roundOf(board, away.length > 0 ? away : nodes);
      const guard: OwnerGuard = { id: change.elementId, post: round[0], round: round.length > 1 ? round : [], tempo: level.patrolTempo };
      return { ...named, guards: [...setup.guards, guard] };
    }
  }
}

/** "C2 now covers the dock corridor": the change in a line. */
export function describeFix(fix: ChiefFix, zoneName: (id: string) => string): string {
  const { change } = fix;
  switch (change.kind) {
    case "move-camera":
      return `${change.elementId} now covers the ${zoneName(change.to ?? "")}`;
    case "retime-guard": {
      const by = change.byTurns ?? 0;
      return `${change.elementId} walks its round ${Math.abs(by)} ${Math.abs(by) === 1 ? "turn" : "turns"} ${by > 0 ? "later" : "earlier"}`;
    }
    case "lock-door":
      return `Lock the doors into the ${zoneName(change.elementId)}`;
    case "add-guard":
      return `Add ${change.elementId} on a round of the ${zoneName(change.to ?? "")}`;
  }
}
