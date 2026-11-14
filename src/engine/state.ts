// The engine's state (SPEC §4.2, D9). A run is a plain value: every engine
// function takes one and returns a new one, never changing its input. Nothing
// here reads the clock, a random source, the DOM or React (purity.test.ts
// holds that); the seed is the only source of variation, so the same level,
// seed and actions give the same run.
import type { AlarmState, FloorGraph, FloorNode, RunTurn } from "@/domain";

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
}

/** One way out of a node. `doorId` is set when the edge has a door. */
export interface Exit {
  to: string;
  doorId?: string;
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
}

export interface GuardState {
  id: string;
  nodeId: string;
  patrol: readonly string[];
  /** Index into `patrol` of the waypoint the guard is walking to. */
  waypoint: number;
  /** Set by an order: the guard heads for the nearest of these nodes and holds there. */
  target: { zoneId: string; nodes: readonly string[] } | null;
  /** Turns since the guard last hopped. It hops when this reaches the tempo. */
  idle: number;
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
  status: RunStatus;
  turns: readonly RunTurn[];
}

/** A level the engine cannot run; the message says what is wrong. */
export class LevelError extends Error {
  override name = "LevelError";
}

/** Indexes the level's floor and checks every id the level names. */
export function compileBoard(level: Level): Board {
  const { floor } = level;
  const nodes = new Map(floor.nodes.map((n) => [n.id, n]));
  const need = (id: string, what: string) => {
    if (!nodes.has(id)) throw new LevelError(`${what} "${id}" is not a node of the floor`);
  };

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
    if (!Number.isInteger(value) || value < 1) throw new LevelError(`${name} ${value} is not a positive integer`);
  }
  need(level.start, "start");
  need(level.objective, "objective");
  if (level.exits.length === 0) throw new LevelError("the level has no exits");
  level.exits.forEach((id) => need(id, "exit"));
  for (const id of level.lockedDoors) {
    if (!doors.has(id)) throw new LevelError(`locked door "${id}" is not a door of the floor`);
    if (!doors.get(id)) throw new LevelError(`door "${id}" is not lockable`);
  }
  const guardIds = new Set<string>();
  for (const guard of level.guards) {
    if (guardIds.has(guard.id)) throw new LevelError(`duplicate guard id "${guard.id}"`);
    guardIds.add(guard.id);
    if (guard.patrol.length === 0) throw new LevelError(`guard "${guard.id}" has an empty patrol`);
    guard.patrol.forEach((id) => need(id, `guard "${guard.id}" patrol waypoint`));
  }
  for (const [zoneId, zoneNodes] of Object.entries(level.zones ?? {})) {
    if (zoneNodes.length === 0) throw new LevelError(`zone "${zoneId}" has no nodes`);
    zoneNodes.forEach((id) => need(id, `zone "${zoneId}" node`));
  }

  const tieRank = new Map(floor.nodes.map((n) => [n.id, hash(level.seed, n.id)]));
  return { level, nodes, adjacency, maxEdge, tieRank };
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
    guards: level.guards.map((g) => ({
      id: g.id,
      nodeId: g.patrol[0],
      patrol: g.patrol,
      waypoint: 0,
      target: null,
      idle: 0,
    })),
    alarm: "calm",
    status: "playing",
    turns: [],
  };
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
