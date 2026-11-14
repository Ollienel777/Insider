// The engine's state (SPEC §4.2, D9). A run is a plain value: every engine
// function takes one and returns a new one, never changing its input. Nothing
// here reads the clock, a random source, the DOM or React (purity.test.ts
// holds that); the seed is the only source of variation, so the same level,
// seed and actions give the same run.
import type { AlarmState, CameraKind, FloorGraph, FloorNode, RunTurn } from "@/domain";
import type { AlarmEvent } from "./alarm";
import { hop } from "./guards";

/** A guard as the level places it: it starts on `patrol[0]` and walks the loop. */
export interface GuardSpec {
  id: string;
  /**
   * Waypoints of the patrol loop, visited in order and then from the last
   * back to the first. Consecutive waypoints need not be neighbours: the
   * guard walks the shortest path between them, one hop per tempo.
   */
  patrol: readonly string[];
}

/**
 * A camera and the nodes it can cover. How much of `cover` it watches on a
 * turn depends on its kind (SPEC §4.3): an analog camera sweeps between the
 * two halves of `cover`, a PTZ camera cycles through its thirds over 3 turns,
 * and an IP camera watches all of it. On turn `t` it watches part
 * `(t + phase) % parts`, so with `phase` 0 the first part is watched on turn 0;
 * the placer sets `phase` to choose which part is watched first.
 */
export interface CameraSpec {
  id: string;
  kind: CameraKind;
  cover: readonly string[];
  phase?: number;
}

/** Everything the engine needs to start a run. The placer (#15) builds it. */
export interface Level {
  buildingId: string;
  missionId: string;
  seed: number;
  floor: FloorGraph;
  /** The player's starting node. */
  start: string;
  /** The node holding the objective, taken with a `take` action. */
  objective: string;
  /** Nodes that end the run as a win once the player holds the objective. */
  exits: readonly string[];
  /** Ids of lockable doors that start locked. */
  lockedDoors: readonly string[];
  /** Consecutive `pick` actions that open a locked door (analog key locks: 2). */
  pickTurns: number;
  /** Player turns per guard hop: the security profile's `patrolTempo`. */
  patrolTempo: number;
  guards: readonly GuardSpec[];
  /** Zone id → its nodes, for guard orders (Chief orders name zones). */
  zones?: Readonly<Record<string, readonly string[]>>;
  /** The floor's cameras. None when absent. */
  cameras?: readonly CameraSpec[];
  /**
   * Night cleaners, which the placer puts in crowded zones. They walk their
   * loop and see like guards, but a cleaner's sighting only raises
   * Suspicious, and cleaners never catch the player or take orders.
   */
  cleaners?: readonly GuardSpec[];
  /** Ids of quiet zones (keys of `zones`): noise made in one carries one hop further. */
  quietZones?: readonly string[];
  /** How many hops away a guard hears a sprint or a pick. Default `DEFAULT_HEARING`. */
  hearing?: number;
}

/** Hops away a guard hears noise from, when the level does not say. */
export const DEFAULT_HEARING = 2;

/** One way out of a node. `doorId` is set when the edge has a door. */
export interface Exit {
  to: string;
  doorId?: string;
}

/** A camera as the engine runs it: its cover cut, in order, into the parts it watches in turn. */
export interface Camera {
  id: string;
  kind: CameraKind;
  parts: readonly (readonly string[])[];
  phase: number;
}

/** A zone as a destination: its id and its nodes. A guard sent there heads for the nearest node. */
export interface ZoneTarget {
  zoneId: string;
  nodes: readonly string[];
}

/** The level, indexed once per run. Shared by every state of the run. */
export interface Board {
  level: Level;
  nodes: ReadonlyMap<string, FloorNode>;
  adjacency: ReadonlyMap<string, readonly Exit[]>;
  /** The longest edge, for the A* heuristic. */
  maxEdge: number;
  /** A per-seed rank of each node, used only to break exact ties in A*. */
  tieRank: ReadonlyMap<string, number>;
  cameras: readonly Camera[];
  /** Every node inside a quiet zone. */
  quiet: ReadonlySet<string>;
  /** Hops away a guard hears noise made outside a quiet zone. */
  hearing: number;
}

/** A floor-plan direction. */
export interface Facing {
  dx: number;
  dy: number;
}

export interface GuardState {
  id: string;
  nodeId: string;
  patrol: readonly string[];
  /** Index into `patrol` of the waypoint the guard is walking to. */
  waypoint: number;
  /** Set by an order: the guard heads for the nearest of these nodes and holds there. */
  target: ZoneTarget | null;
  /** Turns since the guard last hopped. It hops when this reaches the tempo. */
  idle: number;
  /**
   * The way the guard faces: the direction of its last hop, or of its first
   * one before it has moved. Null for a guard with nowhere to go, which
   * watches all around.
   */
  facing: Facing | null;
}

export type RunStatus = "playing" | "won" | "caught";

export interface RunState {
  board: Board;
  /** The number of turns taken; the next turn logged gets this number. */
  turn: number;
  playerNode: string;
  carrying: boolean;
  /** The door the player is part-way through picking, and how many picks it has had. */
  picking: { doorId: string; progress: number } | null;
  /** Ids of the doors locked now, sorted. */
  locked: readonly string[];
  guards: readonly GuardState[];
  alarm: AlarmState;
  /** Turns in a row that nothing has held the alarm at its level (see alarm.ts). */
  alarmQuiet: number;
  /** The zone the player was last detected in; null until they first are. */
  lastKnown: ZoneTarget | null;
  /** Every alarm transition of the run, in order. */
  alarmEvents: readonly AlarmEvent[];
  /** The night cleaners, in the level's order. */
  cleaners: readonly GuardState[];
  status: RunStatus;
  turns: readonly RunTurn[];
}

/** A level the engine cannot run; the message says what is wrong. */
export class LevelError extends Error {
  override name = "LevelError";
}

/** Turns in a camera's cycle, by kind (SPEC §4.3). */
const CYCLE: Readonly<Record<CameraKind, number>> = {
  "analog-sweep": 2,
  ptz: 3,
  "fixed-ip": 1,
  "ip-analytics": 1,
};

/** Indexes the level's floor and checks every id the level names. */
export function compileBoard(level: Level): Board {
  const { floor } = level;
  const nodes = new Map(floor.nodes.map((n) => [n.id, n]));
  const need = (id: string, what: string) => {
    if (!nodes.has(id)) throw new LevelError(`${what} "${id}" is not a node of the floor`);
  };
  const whole = (value: number, min: number) => Number.isInteger(value) && value >= min;

  const adjacency = new Map<string, Exit[]>(floor.nodes.map((n) => [n.id, []]));
  const doors = new Map<string, boolean>();
  let maxEdge = 0;
  for (const edge of floor.edges) {
    const doorId = edge.door?.id;
    if (edge.door) doors.set(edge.door.id, edge.door.lockable);
    adjacency.get(edge.a)!.push({ to: edge.b, doorId });
    adjacency.get(edge.b)!.push({ to: edge.a, doorId });
    const a = nodes.get(edge.a)!;
    const b = nodes.get(edge.b)!;
    maxEdge = Math.max(maxEdge, Math.hypot(a.x - b.x, a.y - b.y));
  }

  if (!Number.isInteger(level.seed)) throw new LevelError(`seed ${level.seed} is not an integer`);
  for (const [name, value] of [["pickTurns", level.pickTurns], ["patrolTempo", level.patrolTempo]] as const) {
    if (!whole(value, 1)) throw new LevelError(`${name} ${value} is not a positive integer`);
  }
  need(level.start, "start");
  need(level.objective, "objective");
  if (level.exits.length === 0) throw new LevelError("the level has no exits");
  level.exits.forEach((id) => need(id, "exit"));
  for (const id of level.lockedDoors) {
    if (!doors.has(id)) throw new LevelError(`locked door "${id}" is not a door of the floor`);
    if (!doors.get(id)) throw new LevelError(`door "${id}" is not lockable`);
  }
  for (const [what, walkers] of [["guard", level.guards], ["cleaner", level.cleaners ?? []]] as const) {
    const ids = new Set<string>();
    for (const walker of walkers) {
      if (ids.has(walker.id)) throw new LevelError(`duplicate ${what} id "${walker.id}"`);
      ids.add(walker.id);
      if (walker.patrol.length === 0) throw new LevelError(`${what} "${walker.id}" has an empty patrol`);
      walker.patrol.forEach((id) => need(id, `${what} "${walker.id}" patrol waypoint`));
    }
  }
  const zones = level.zones ?? {};
  for (const [zoneId, zoneNodes] of Object.entries(zones)) {
    if (zoneNodes.length === 0) throw new LevelError(`zone "${zoneId}" has no nodes`);
    zoneNodes.forEach((id) => need(id, `zone "${zoneId}" node`));
  }
  const quiet = new Set<string>();
  for (const zoneId of level.quietZones ?? []) {
    if (!Object.hasOwn(zones, zoneId)) throw new LevelError(`quiet zone "${zoneId}" is not a zone of the level`);
    zones[zoneId].forEach((id) => quiet.add(id));
  }
  const hearing = level.hearing ?? DEFAULT_HEARING;
  if (!whole(hearing, 0)) throw new LevelError(`hearing ${hearing} is not a whole number of hops`);

  const cameraIds = new Set<string>();
  const cameras = (level.cameras ?? []).map((spec): Camera => {
    if (cameraIds.has(spec.id)) throw new LevelError(`duplicate camera id "${spec.id}"`);
    cameraIds.add(spec.id);
    if (spec.cover.length === 0) throw new LevelError(`camera "${spec.id}" covers no nodes`);
    spec.cover.forEach((id) => need(id, `camera "${spec.id}" cover node`));
    const phase = spec.phase ?? 0;
    if (!whole(phase, 0)) throw new LevelError(`camera "${spec.id}" phase ${phase} is not a whole number`);
    const n = CYCLE[spec.kind];
    if (n === undefined) throw new LevelError(`camera "${spec.id}" has unknown kind "${spec.kind}"`);
    const { cover } = spec;
    const parts = Array.from({ length: n }, (_, i) =>
      cover.slice(Math.floor((i * cover.length) / n), Math.floor(((i + 1) * cover.length) / n)),
    );
    return { id: spec.id, kind: spec.kind, parts, phase };
  });

  const tieRank = new Map(floor.nodes.map((n) => [n.id, hash(level.seed, n.id)]));
  return { level, nodes, adjacency, maxEdge, tieRank, cameras, quiet, hearing };
}

/** The opening state of a run. Throws `LevelError` on a level it cannot run. */
export function createRun(level: Level): RunState {
  const board = compileBoard(level);
  return {
    board,
    turn: 0,
    playerNode: level.start,
    carrying: false,
    picking: null,
    locked: [...new Set(level.lockedDoors)].sort(),
    guards: level.guards.map((g) => placeWalker(board, g)),
    alarm: "calm",
    alarmQuiet: 0,
    lastKnown: null,
    alarmEvents: [],
    cleaners: (level.cleaners ?? []).map((c) => placeWalker(board, c)),
    status: "playing",
    turns: [],
  };
}

/** A guard or cleaner on the first node of its loop, facing its first hop. */
function placeWalker(board: Board, spec: GuardSpec): GuardState {
  const placed: GuardState = {
    id: spec.id,
    nodeId: spec.patrol[0],
    patrol: spec.patrol,
    waypoint: 0,
    target: null,
    idle: 0,
    facing: null,
  };
  return { ...placed, facing: hop(board, placed).facing };
}

/** The zone a node is in: the first of the level's zones that holds it, else the node's room. */
export function zoneOf(board: Board, nodeId: string): ZoneTarget {
  for (const [zoneId, nodes] of Object.entries(board.level.zones ?? {})) {
    if (nodes.includes(nodeId)) return { zoneId, nodes };
  }
  const roomId = board.nodes.get(nodeId)!.roomId;
  const nodes = board.level.floor.nodes.filter((n) => n.roomId === roomId).map((n) => n.id);
  return { zoneId: roomId, nodes };
}

/** Whether the alarm is high enough that sharing a node with a guard is capture. */
export function isAlert(alarm: AlarmState): boolean {
  return alarm === "alert" || alarm === "lockdown";
}

/** Whether a guard stands on any of `nodeIds`. */
export function guardOn(guards: readonly GuardState[], nodeIds: readonly string[]): boolean {
  return guards.some((g) => nodeIds.includes(g.nodeId));
}

/** FNV-1a over the seed and the id, then a final avalanche: a stable 32-bit rank. */
function hash(seed: number, id: string): number {
  let h = 0x811c9dc5 ^ (seed | 0);
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}
