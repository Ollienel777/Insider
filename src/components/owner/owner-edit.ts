// The Owner screen's setup, as the editor works it (Owner Mode, SPEC §13,
// issues 125 and 128). Pure: every edit returns a new setup and never mutates
// the last. The setup starts from the building's generated security, turned
// into the owner's terms, so the editor is never empty. The batch always plays
// the setup applied (`applyOwnerSetup`), and the conversion is exact: the
// untouched setup plays the generated level, so the screen's first count is
// the batch debrief's (issue 127), and an edit changes the count only by what
// it changes. Everything here stays in the browser.
"use client";

import type { ChiefFix, FloorGraph, LevelManifest, Provenance } from "@/domain";
import {
  OWNER_SETUP_VERSION,
  type Compass,
  type OwnerCamera,
  type OwnerCameraKind,
  type OwnerDoorLock,
  type OwnerGenerated,
  type OwnerGuard,
  type OwnerProvenance,
  type OwnerSetup,
} from "@/domain/owner-setup";
import { compileBoard, zoneTarget, type Level } from "@/engine";
import { roundOf } from "@/engine/autoplay";
import {
  applyOwnerSetup,
  cameraCover,
  OWNER_KIND_OF,
  OWNER_PICK_TURNS,
  validateOwnerSetup,
  type OwnerSetupError,
} from "@/level/owner-setup";
import type { PlacedLevel } from "@/level/placer";

export const COMPASS: readonly Compass[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
export const CAMERA_KINDS: readonly OwnerCameraKind[] = ["sweeping", "ptz", "fixed"];
export const DOOR_LOCKS: readonly OwnerDoorLock[] = ["key", "badge", "open"];

/** The name the starting setup carries. */
export const STARTING_NAME = "Generated security";

/**
 * The placed level's security as an owner's setup: each guard's and night
 * cleaner's round as the node loop it walks, each camera on the node and
 * facing whose view comes nearest its generated cover and keeping that cover
 * exactly, every locked door a key lock or a badge reader by its pick turns.
 * Every element is listed as generated, so `applyOwnerSetup` plays it as the
 * rules table placed it, data provenance and all, until it is edited.
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
  const cameras: OwnerCamera[] = (level.cameras ?? []).map((c) => ({
    ...nearestCamera(floor, c.id, c.cover, OWNER_KIND_OF[c.kind]),
    cover: [...c.cover],
  }));
  const lock = level.pickTurns === OWNER_PICK_TURNS.key ? ("key" as const) : ("badge" as const);
  const doors = Object.fromEntries([...level.lockedDoors].sort().map((id) => [id, lock]));
  const cleaners = (level.cleaners ?? []).map((c) => ({ id: c.id, round: roundOf(board, c.patrol) }));
  const generated: OwnerGenerated = {
    guards: guards.map((g) => g.id),
    cameras: cameras.map((c) => c.id),
    cleaners: cleaners.map((c) => c.id),
    doors: Object.keys(doors),
  };
  return { version: OWNER_SETUP_VERSION, name, buildingId: level.buildingId, guards, cameras, doors, desks: [], cleaners, generated };
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

/** The level a batch plays on `seed`: the setup applied over the placer's entries and zones. Null when the setup has a problem. */
export function levelForSetup(manifest: LevelManifest, floor: FloorGraph, setup: OwnerSetup, seed: number): Level | null {
  const applied = applyOwnerSetup(manifest, floor, setup, seed);
  return applied.ok ? applied.placed.level : null;
}

/** Only the data's rows: an element the owner placed has none, so its Why card says the owner placed it. */
const dataRows = (rows: readonly (OwnerProvenance | Provenance)[]): Provenance[] =>
  rows.filter((row): row is Provenance => row.layer !== "owner");

/**
 * The board's picture of a setup: the placer's level with the setup's
 * security on it. Elements still as generated keep their data provenance, so
 * the Why card shows its rows; the owner's carry none.
 */
export function boardOf(manifest: LevelManifest, floor: FloorGraph, setup: OwnerSetup, seed: number): PlacedLevel | null {
  const applied = applyOwnerSetup(manifest, floor, setup, seed);
  if (!applied.ok) return null;
  const { placed } = applied;
  return {
    level: placed.level,
    entries: placed.entries,
    zones: placed.zones,
    objective: placed.objective,
    unplaced: placed.unplaced,
    // The placer's watch names one of its own guards: it holds only while that guard is still on the board.
    watch: placed.watch && placed.guards.some((g) => g.id === placed.watch!.guardId) ? placed.watch : null,
    cleaners: placed.cleaners.map((c) => ({
      id: c.id,
      zoneId: c.zoneId,
      roomId: c.roomId,
      patrol: c.patrol,
      rule: c.rule,
      provenance: dataRows(c.provenance),
    })),
    guards: placed.guards.map((g) => ({
      id: g.id,
      roomId: g.roomId,
      patrol: g.patrol,
      ...(g.post && { post: g.post }),
      provenance: dataRows(g.provenance),
    })),
    cameras: placed.cameras.map((c) => ({
      id: c.id,
      kind: c.kind,
      cover: c.cover,
      phase: c.phase,
      approach: c.approach,
      provenance: dataRows(c.provenance),
    })),
    locks: placed.locks.map((l) => ({ doorId: l.doorId, zoneId: l.zoneId ?? "", provenance: dataRows(l.provenance) })),
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

/** The setup with the element taken off the generated list: an edited element is the owner's. */
export function touched(setup: OwnerSetup, list: keyof OwnerGenerated, id: string): OwnerSetup {
  const ids = setup.generated?.[list];
  if (!ids?.includes(id)) return setup;
  return { ...setup, generated: { ...setup.generated, [list]: ids.filter((x) => x !== id) } };
}

const guardEdit = (setup: OwnerSetup, id: string, edit: (g: OwnerGuard) => OwnerGuard): OwnerSetup => {
  const out = touched(setup, "guards", id);
  return { ...out, guards: out.guards.map((g) => (g.id === id ? edit(g) : g)) };
};

export function addGuard(setup: OwnerSetup, node: string, tempo = 1): { setup: OwnerSetup; id: string } {
  const id = nextId("G", takenIds(setup));
  return { setup: { ...setup, guards: [...setup.guards, { id, post: node, round: [], tempo }] }, id };
}

/** Moves the guard's post; a round that no longer passes the post is walked from the new post instead (it stands there). */
export function moveGuard(setup: OwnerSetup, id: string, node: string): OwnerSetup {
  // Onto its own post: nothing moves, and the guard stays as generated.
  if (setup.guards.find((g) => g.id === id)?.post === node) return setup;
  return guardEdit(setup, id, (g) => ({ ...g, post: node, round: g.round.includes(node) ? g.round : [] }));
}

export function removeGuard(setup: OwnerSetup, id: string): OwnerSetup {
  const out = touched(setup, "guards", id);
  return { ...out, guards: out.guards.filter((g) => g.id !== id) };
}

/** Starts drawing a round: the post alone, so each next click adds a node. */
export function startRound(setup: OwnerSetup, id: string): OwnerSetup {
  return guardEdit(setup, id, (g) => ({ ...g, round: [g.post] }));
}

/**
 * Adds `node` to the end of the round being drawn; the last node again takes
 * it off. The round's first node closes the loop: a round already ends by
 * walking back to it, so nothing is added and the setup stays as it was.
 */
export function extendRound(setup: OwnerSetup, id: string, node: string): OwnerSetup {
  const guard = setup.guards.find((g) => g.id === id);
  if (!guard) return setup;
  if ((guard.round.length === 0 ? guard.post : guard.round[0]) === node) return setup;
  return guardEdit(setup, id, (g) => {
    const round = g.round.length === 0 ? [g.post] : g.round;
    if (round[round.length - 1] === node && round.length > 1) return { ...g, round: round.slice(0, -1) };
    return { ...g, round: [...round, node] };
  });
}

/** The guard stands its post: no round. */
export function clearRound(setup: OwnerSetup, id: string): OwnerSetup {
  return guardEdit(setup, id, (g) => ({ ...g, round: [] }));
}

export function setTempo(setup: OwnerSetup, id: string, tempo: number): OwnerSetup {
  return guardEdit(setup, id, (g) => ({ ...g, tempo: Math.max(1, Math.round(tempo)) }));
}

export function addCamera(setup: OwnerSetup, node: string, kind: OwnerCameraKind = "sweeping", facing: Compass = "n"): { setup: OwnerSetup; id: string } {
  const id = nextId("C", takenIds(setup));
  return { setup: { ...setup, cameras: [...setup.cameras, { id, node, kind, facing }] }, id };
}

/** Changes a camera. Moved, turned or of another kind, it covers what it now sees: a kept cover goes. */
export function updateCamera(setup: OwnerSetup, id: string, change: Partial<Omit<OwnerCamera, "id" | "cover">>): OwnerSetup {
  const camera = setup.cameras.find((c) => c.id === id);
  // Nothing differs (a click on the active kind or facing): the camera stays as generated.
  if (!camera || Object.entries(change).every(([k, v]) => camera[k as keyof OwnerCamera] === v)) return setup;
  const out = touched(setup, "cameras", id);
  return {
    ...out,
    cameras: out.cameras.map((c) => {
      if (c.id !== id) return c;
      const next = { ...c, ...change };
      const moved = next.node !== c.node || next.facing !== c.facing || next.kind !== c.kind;
      if (!moved) return next;
      const recomputed: OwnerCamera = { ...next };
      delete recomputed.cover;
      return recomputed;
    }),
  };
}

export function removeCamera(setup: OwnerSetup, id: string): OwnerSetup {
  const out = touched(setup, "cameras", id);
  return { ...out, cameras: out.cameras.filter((c) => c.id !== id) };
}

export function setDoor(setup: OwnerSetup, doorId: string, lock: OwnerDoorLock): OwnerSetup {
  // The lock it already has (a door left out is open): nothing changes, and the door stays as generated.
  if ((setup.doors[doorId] ?? "open") === lock) return setup;
  const out = touched(setup, "doors", doorId);
  const doors = { ...out.doors };
  if (lock === "open") delete doors[doorId];
  else doors[doorId] = lock;
  return { ...out, doors };
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
  const cleanerIds = new Set(once((out.cleaners ?? []).map((c) => c.id)));
  out = {
    ...out,
    guards: out.guards.filter((g) => guardIds.has(g.id) && !bad.has(`guard:${g.id}`)),
    cameras: out.cameras.filter((c) => cameraIds.has(c.id) && !bad.has(`camera:${c.id}`)),
    doors: Object.fromEntries(Object.entries(out.doors).filter(([id]) => !bad.has(`door:${id}`))),
    desks: [...new Set(out.desks)].filter((d) => !bad.has(`desk:${d}`)),
    ...(out.cleaners && { cleaners: out.cleaners.filter((c) => cleanerIds.has(c.id) && !bad.has(`cleaner:${c.id}`)) }),
  };
  // The generated list keeps only what is left.
  if (out.generated) {
    const left = {
      guards: new Set(out.guards.map((g) => g.id)),
      cameras: new Set(out.cameras.map((c) => c.id)),
      cleaners: new Set((out.cleaners ?? []).map((c) => c.id)),
      doors: new Set(Object.keys(out.doors).filter((id) => out.doors[id] !== "open")),
    };
    const generated: OwnerGenerated = {};
    for (const list of ["guards", "cameras", "cleaners", "doors"] as const) {
      const ids = out.generated[list];
      if (ids) generated[list] = ids.filter((id) => left[list].has(id));
    }
    out = { ...out, generated };
  }
  return out;
}

// ---- the Chief's fix, in the owner's terms --------------------------------------------

/**
 * The setup with the Chief's change made, as near as a setup can say it (the
 * fix itself is a change to the engine's level). The Owner screen's After
 * batch plays this setup (`rerunOwner`), so its count is this setup's. A
 * moved camera goes on the zone's node and facing that see most of it and
 * covers the zone's nodes; a retimed guard starts its
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
      // On the zone's nearest node and facing, covering exactly the zone, as the engine's fix does.
      const placed: OwnerCamera = { ...nearestCamera(floor, camera.id, nodes, camera.kind), cover: [...nodes] };
      const out = touched(named, "cameras", camera.id);
      return { ...out, cameras: out.cameras.map((c) => (c.id === camera.id ? placed : c)) };
    }
    case "retime-guard": {
      const by = change.byTurns ?? 0;
      const guard = setup.guards.find((g) => g.id === change.elementId);
      if (!guard || guard.round.length < 2) return named;
      return guardEdit(named, guard.id, (g) => {
        const at = g.round.indexOf(g.post);
        const n = g.round.length;
        return { ...g, post: g.round[(((at - by) % n) + n) % n] };
      });
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
