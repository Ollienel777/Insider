// The drill simulation (SPEC §1, §2 beat 7, D21): the same building and
// board as the heist, run as an evacuation drill. Occupants stand in the
// floor's occupied rooms (headcount from CoStar's occupied area ÷ 250 sf),
// the scenario blocks the stair more of them would use than any other (on a
// tie, the one whose loss cuts off the most people, then costs the most time,
// then the lower node id, and the report says it was a tie), and each walks to
// the nearest open stair at 1.2 m/s over the board's node distances (the
// fixture floors are drawn in metres). A node admits a fixed number of people
// per tick, so a shared door or landing queues. The report gives the time to
// clear, per-zone clear times, the bottleneck (when anyone queued) and warden posts.
//
// Pure: no I/O, no clock, no randomness, and the inputs are never mutated.
// The seed only picks where in its room each occupant starts, so the same
// building, floor and options always give the same report.
import type { Building, FloorGraph, Provenance } from "@/domain";
import {
  DRILL_FLOOR,
  DrillError,
  headcountFor,
  placeOccupants,
  type DrillFloorChoice,
  type Headcount,
  type Placement,
} from "./occupancy";

/** Walking speed on the flat, metres per second (the ticket's figure). */
export const WALK_SPEED_M_S = 1.2;
/** One tick of the simulation, in seconds. */
export const TICK_S = 1;
/** People who can enter one node in one tick: roughly one door leaf's flow. */
export const NODE_CAPACITY = 1;
/** A drill that has not cleared after this long has a bug, not a slow floor. */
const MAX_TICKS = 3600;

export interface DrillOptions {
  /** The floor to drill. Default `DRILL_FLOOR` (the staged floor). */
  floor?: DrillFloorChoice;
  /** Only rotates where in its room each occupant starts. Default 0. */
  seed?: number;
  /**
   * The stair node to block. Default: the scenario's choice (the stair more
   * occupants would use than any other; a tie goes to the stair whose loss cuts
   * off the most, then costs the most
   * time). `null` blocks none, as the baseline.
   */
  blockedStair?: string | null;
}

export interface DrillOccupant {
  id: string;
  roomId: string;
  startNode: string;
  /** The open stair they head for, or null when none is reachable. */
  stair: string | null;
  /** Their route, start and stair included; empty when stranded. */
  path: readonly string[];
  distanceM: number;
  /** Seconds after the alarm that they enter the stair; null when stranded. */
  clearedAtS: number | null;
  /** Seconds of walking lost held at full nodes (see `walk`), to the hundredth. */
  waitedS: number;
  /** Position at each tick, from 0 to `clearedAtS`, for the drill view to play back. */
  track: readonly { x: number; y: number }[];
}

export interface DrillZone {
  roomId: string;
  label: string;
  occupants: number;
  /** When the last of them entered a stair; null when any is stranded. */
  clearedAtS: number | null;
}

/**
 * A warden post: one for each way out of an occupied room that anyone leaves by, so no one's way out
 * goes unwatched. A room with two ways out in use gets two posts.
 */
export interface WardenPost {
  roomId: string;
  label: string;
  /** The door of this way out; null when the way out has no door. */
  doorId: string | null;
  /** Where the warden stands: the room's side of that way out. */
  nodeId: string;
  /** How many of the room's occupants leave by this way out. */
  people: number;
  /** How many occupants the room holds, by every way out. */
  occupants: number;
}

/**
 * The room people spent the most time queued to get into or along. A walker
 * queues at the threshold of the next node on their path when that node has
 * already let `NODE_CAPACITY` people in this tick, and the wait is booked to
 * that node's room: the room they are waiting to enter (from a doorway) or to
 * move along (from inside it). That is where the flow is held up and where the
 * board draws the waiting dots, so it is where a warden can relieve it. Every
 * figure is the whole room's, over all of its nodes.
 */
export interface Bottleneck {
  roomId: string;
  /** The room's label. */
  label: string;
  /** The room's node with the most queued time, where the board marks the queue. */
  nodeId: string;
  /**
   * Person-seconds spent queued to enter any of the room's nodes: the sum, over
   * everyone, of the seconds each waited, to the whole second. Not a span of time on the clock.
   */
  personSeconds: number;
  /** The most people queued at once to enter any of the room's nodes (held there at the end of one tick). */
  peakQueue: number;
  /** Distinct people who queued for any of the room's nodes. */
  waiters: number;
  /**
   * The most seconds any one person spent queued for the room's nodes, all of
   * their waits added together, to the whole second. One person's total over
   * several stops, not one unbroken wait: in a stop-start queue a person waits,
   * moves a node, and waits again.
   */
  mostWaitedS: number;
  /** Distinct people who were in any of the room's nodes on their way out: who entered one, and who started in one. */
  throughput: number;
}

export interface StrandedOccupant {
  occupantId: string;
  roomId: string | null;
  reason: string;
}

export interface DrillScenario {
  /** The blocked stair's node and its room's label; null when none is blocked. */
  blockedStair: { nodeId: string; label: string } | null;
  /** How many occupants would have used it with every stair open. */
  wouldUse: number;
  /** The sentence the report prints for the choice; on a tie it says so and gives the tie-break. */
  rule: string;
}

export interface DrillReport {
  buildingId: string;
  seed: number;
  headcount: Headcount;
  placement: Placement["basis"];
  scenario: DrillScenario;
  openStairs: readonly string[];
  occupants: readonly DrillOccupant[];
  /** When the last occupant who can reach a stair entered it; 0 with nobody to move. */
  timeToClearS: number;
  /** True when every occupant reached a stair. */
  allClear: boolean;
  zones: readonly DrillZone[];
  /** The room with the most person-seconds queued for it, with the whole room's figures; null when nobody queued. */
  bottleneck: Bottleneck | null;
  wardenPosts: readonly WardenPost[];
  /** Everyone who cannot reach an open stair, and why. */
  stranded: readonly StrandedOccupant[];
  provenance: readonly Provenance[];
}

// ---- routing ----------------------------------------------------------------

interface Graph {
  nodes: ReadonlyMap<string, FloorGraph["nodes"][number]>;
  /** Neighbours with the edge's length and door, in id order. */
  adj: ReadonlyMap<string, readonly { to: string; m: number; doorId?: string }[]>;
  roomLabel: ReadonlyMap<string, string>;
  stairs: readonly string[];
}

function graphOf(floor: FloorGraph): Graph {
  const nodes = new Map(floor.nodes.map((n) => [n.id, n]));
  const adj = new Map<string, { to: string; m: number; doorId?: string }[]>(floor.nodes.map((n) => [n.id, []]));
  for (const e of floor.edges) {
    const a = nodes.get(e.a)!;
    const b = nodes.get(e.b)!;
    const m = Math.hypot(a.x - b.x, a.y - b.y);
    adj.get(e.a)!.push({ to: e.b, m, doorId: e.door?.id });
    adj.get(e.b)!.push({ to: e.a, m, doorId: e.door?.id });
  }
  for (const list of adj.values()) list.sort((x, y) => x.to.localeCompare(y.to));
  const stairs = floor.nodes.filter((n) => n.tags.includes("stair")).map((n) => n.id).sort();
  return { nodes, adj, roomLabel: new Map(floor.rooms.map((r) => [r.id, r.label])), stairs };
}

/**
 * The shortest walk (in metres) from `from` to the nearest of `goals`,
 * avoiding `blocked`, by Dijkstra. Exact ties go to the lower node id, so the
 * route depends only on the board. Null when no goal is reachable.
 */
function nearestStair(
  g: Graph,
  from: string,
  goals: ReadonlySet<string>,
  blocked: ReadonlySet<string>,
): { path: string[]; m: number } | null {
  if (blocked.has(from)) return null;
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const done = new Set<string>();
  for (;;) {
    let at: string | null = null;
    for (const [id, d] of dist) {
      if (done.has(id)) continue;
      if (at === null || d < dist.get(at)! || (d === dist.get(at)! && id < at)) at = id;
    }
    if (at === null) return null;
    if (goals.has(at)) {
      const path = [at];
      while (prev.has(path[0])) path.unshift(prev.get(path[0])!);
      return { path, m: dist.get(at)! };
    }
    done.add(at);
    for (const { to, m } of g.adj.get(at)!) {
      if (done.has(to) || blocked.has(to)) continue;
      const d = dist.get(at)! + m;
      const known = dist.get(to);
      if (known === undefined || d < known - 1e-9 || (Math.abs(d - known) <= 1e-9 && at < prev.get(to)!)) {
        dist.set(to, d);
        prev.set(to, at);
      }
    }
  }
}

// ---- the walk ---------------------------------------------------------------

interface Walker {
  id: string;
  path: readonly string[];
  /** Length of each leg: `legs[i]` runs from `path[i]` to `path[i + 1]`. */
  legs: readonly number[];
  leg: number;
  along: number;
  clearedAt: number | null;
  waited: number;
  track: { x: number; y: number }[];
}

function walkerOf(g: Graph, id: string, path: readonly string[]): Walker {
  const legs = path.slice(1).map((to, i) => {
    const a = g.nodes.get(path[i])!;
    const b = g.nodes.get(to)!;
    return Math.hypot(a.x - b.x, a.y - b.y);
  });
  return { id, path, legs, leg: 0, along: 0, clearedAt: null, waited: 0, track: [] };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function positionOf(g: Graph, w: Walker): { x: number; y: number } {
  const a = g.nodes.get(w.path[w.leg])!;
  if (w.leg >= w.legs.length) return { x: a.x, y: a.y };
  const b = g.nodes.get(w.path[w.leg + 1])!;
  const t = w.legs[w.leg] === 0 ? 1 : w.along / w.legs[w.leg];
  return { x: round2(a.x + (b.x - a.x) * t), y: round2(a.y + (b.y - a.y) * t) };
}

const remaining = (w: Walker) => w.legs.slice(w.leg).reduce((s, m) => s + m, 0) - w.along;

/**
 * Walks everyone to their stair, a tick at a time. In each tick the walkers
 * nearest their stair move first, so the front of a queue goes through first;
 * a walker who reaches a node that has already admitted `NODE_CAPACITY`
 * people this tick waits at its threshold for the rest of the tick. A wait is
 * walking time lost: the part of the tick left when they were stopped.
 */
interface WalkTally {
  /** Person-seconds queued to enter each node. */
  waits: Map<string, number>;
  /** People who entered each node. */
  through: Map<string, number>;
  /** The most people queued at once for any of a room's nodes, by room id. */
  roomPeaks: Map<string, number>;
  /** Seconds each walker spent queued for any of a room's nodes, by room id, then walker id. */
  roomWaiters: Map<string, Map<string, number>>;
  /** The distinct walkers who started in or entered any of a room's nodes, by room id. */
  roomThrough: Map<string, Set<string>>;
}

function walk(g: Graph, walkers: Walker[]): WalkTally {
  const waits = new Map<string, number>();
  const through = new Map<string, number>();
  const roomPeaks = new Map<string, number>();
  const roomThrough = new Map<string, Set<string>>();
  const roomWaiters = new Map<string, Map<string, number>>();
  const roomOf = (nodeId: string) => g.nodes.get(nodeId)!.roomId;
  for (const w of walkers) {
    w.track.push(positionOf(g, w));
    if (w.legs.length === 0) w.clearedAt = 0;
    // Someone who starts in a room passes through it too, though they never enter one of its nodes.
    const start = roomThrough.get(roomOf(w.path[0])) ?? new Set<string>();
    start.add(w.id);
    roomThrough.set(roomOf(w.path[0]), start);
  }
  const step = WALK_SPEED_M_S * TICK_S;
  for (let t = 1; walkers.some((w) => w.clearedAt === null); t++) {
    if (t > MAX_TICKS) throw new DrillError(`the drill did not clear in ${MAX_TICKS} ticks`);
    const moving = walkers
      .filter((w) => w.clearedAt === null)
      .sort((a, b) => remaining(a) - remaining(b) || a.id.localeCompare(b.id));
    const entered = new Map<string, number>();
    const queued = new Map<string, number>();
    for (const w of moving) {
      let budget = step;
      while (budget > 1e-9) {
        const room = w.legs[w.leg] - w.along;
        if (budget < room - 1e-9) {
          w.along += budget;
          budget = 0;
          break;
        }
        const next = w.path[w.leg + 1];
        const used = entered.get(next) ?? 0;
        if (used >= NODE_CAPACITY) {
          // Held at the threshold for the rest of the tick. The wait is the time it costs them: the walking they
          // could not use this tick, which is none when they reach the threshold just as the tick ends, since next
          // tick they go in and still walk a full step. At their stair it is the whole tick, since they go in a
          // tick later, and going in is the end of their walk.
          const held = w.leg + 1 === w.legs.length ? TICK_S : (budget - room) / WALK_SPEED_M_S;
          w.along = w.legs[w.leg];
          budget = 0;
          if (held > 1e-6) {
            w.waited += held;
            waits.set(next, (waits.get(next) ?? 0) + held);
            queued.set(next, (queued.get(next) ?? 0) + 1);
            const waiting = roomWaiters.get(roomOf(next)) ?? new Map<string, number>();
            waiting.set(w.id, (waiting.get(w.id) ?? 0) + held);
            roomWaiters.set(roomOf(next), waiting);
          }
          break;
        }
        entered.set(next, used + 1);
        through.set(next, (through.get(next) ?? 0) + 1);
        const seen = roomThrough.get(roomOf(next)) ?? new Set<string>();
        seen.add(w.id);
        roomThrough.set(roomOf(next), seen);
        budget -= room;
        w.leg += 1;
        w.along = 0;
        if (w.leg === w.legs.length) {
          w.clearedAt = t * TICK_S;
          break;
        }
      }
      w.track.push(positionOf(g, w));
    }
    // Each walker queues for one node at most per tick, so a room's sum counts nobody twice.
    const inRoom = new Map<string, number>();
    for (const [id, n] of queued) inRoom.set(roomOf(id), (inRoom.get(roomOf(id)) ?? 0) + n);
    for (const [room, n] of inRoom) roomPeaks.set(room, Math.max(roomPeaks.get(room) ?? 0, n));
  }
  return { waits, through, roomPeaks, roomThrough, roomWaiters };
}

// ---- the drill --------------------------------------------------------------

/**
 * Runs the drill on `floor` (the building's board) for the floor that
 * `options.floor` names. Throws `DrillError` on a floor the building does not
 * have or a seed that is not an integer, and when `blockedStair` is not a
 * stair of the board.
 */
export function simulateDrill(building: Building, floor: FloorGraph, options: DrillOptions = {}): DrillReport {
  const seed = options.seed ?? 0;
  if (!Number.isInteger(seed)) throw new DrillError(`seed ${seed} is not an integer`);
  const headcount = headcountFor(building, options.floor ?? DRILL_FLOOR);
  const placement = placeOccupants(building, floor, headcount.floor, headcount.count, seed);
  const g = graphOf(floor);
  const allStairs = new Set(g.stairs);
  const label = (nodeId: string) => g.roomLabel.get(g.nodes.get(nodeId)!.roomId) ?? nodeId;

  // The scenario: with every stair open, who would use which stair.
  const open = (blocked: ReadonlySet<string>) =>
    placement.occupants.map((o) => ({ o, route: nearestStair(g, o.nodeId, new Set(g.stairs.filter((s) => !blocked.has(s))), blocked) }));
  const baseline = open(new Set());
  const users = new Map(g.stairs.map((s) => [s, 0]));
  for (const { route } of baseline) if (route) users.set(route.path.at(-1)!, users.get(route.path.at(-1)!)! + 1);

  let blockedStair: string | null;
  let rule: string;
  if (options.blockedStair !== undefined) {
    blockedStair = options.blockedStair;
    if (blockedStair !== null && !allStairs.has(blockedStair)) {
      throw new DrillError(`"${blockedStair}" is not a stair of the floor`);
    }
    rule = blockedStair === null ? "Baseline: every stair open" : `${label(blockedStair)} blocked, as chosen`;
  } else if (g.stairs.length < 2 || placement.occupants.length === 0) {
    // Blocking a floor's only stair leaves no drill to run, and with nobody on the floor no stair is "most used".
    blockedStair = null;
    rule =
      g.stairs.length < 2
        ? `The floor has ${g.stairs.length === 0 ? "no stair" : "one stair"}, so none is blocked`
        : "Nobody is on the floor, so no stair is blocked";
  } else {
    const most = Math.max(...users.values());
    const leaders = g.stairs.filter((s) => users.get(s) === most);
    const of = `${most} of ${placement.occupants.length}`;
    if (most === 0) {
      // Nobody can reach any stair, so none is "most used".
      blockedStair = null;
      rule = "No occupant can reach a stair, so none is blocked";
    } else if (leaders.length === 1) {
      blockedStair = leaders[0];
      // "Most" only for a true majority; a plurality is "more than any other stair".
      const which =
        most * 2 > placement.occupants.length
          ? "the stair most occupants would use"
          : "the stair more occupants would use than any other";
      rule = `${label(blockedStair)} is ${which} (${of}), so the scenario blocks it`;
    } else {
      // A tie: block the stair whose loss strands the most people, then costs the most time, then the lower id.
      const cost = new Map(leaders.map((s) => [s, lossOf(g, open(new Set([s])))]));
      blockedStair = [...leaders].sort(
        (a, b) =>
          cost.get(b)!.stranded - cost.get(a)!.stranded || cost.get(b)!.timeS - cost.get(a)!.timeS || a.localeCompare(b),
      )[0];
      const chosen = blockedStair;
      // What losing a stair does, as a clause. "Clears the floor" only when nobody is cut off.
      const outcome = (s: string) => {
        const c = cost.get(s)!;
        if (c.stranded === 0) return `the floor clears in ${c.timeS} s`;
        if (c.walking === 0) return `nobody can reach a stair`;
        return `${c.stranded} cannot reach a stair and the rest are in a stair in ${c.timeS} s`;
      };
      // The same, as a short comparison: "47 s", or "47 s with 1 cut off".
      const brief = (s: string) => {
        const c = cost.get(s)!;
        return c.stranded === 0 ? `${c.timeS} s` : `${c.timeS} s with ${c.stranded} cut off`;
      };
      const same = (s: string) =>
        cost.get(s)!.timeS === cost.get(chosen)!.timeS && cost.get(s)!.stranded === cost.get(chosen)!.stranded;
      const each = `${listOf(leaders.map(label))} would each be used by ${of} occupants`;
      const others = leaders.filter((s) => s !== chosen);
      const tieRule = leaders.some((s) => cost.get(s)!.stranded > 0)
        ? "A tie goes to the stair whose loss cuts off the most occupants, then costs the most time"
        : "A tie goes to the stair whose loss costs the most time";
      if (others.every(same)) {
        rule =
          `${each}, a tie. ${tieRule}, but losing any of them gives the same result (${outcome(chosen)}), ` +
          `so the scenario blocks ${label(chosen)}, the first by node id`;
      } else {
        const against = listOf(others.map((s) => `${brief(s)} without ${label(s)}`));
        rule =
          `${each}, a tie. ${tieRule}: without ${label(chosen)} ` +
          `${outcome(chosen)}, against ${against}, so the scenario blocks ${label(chosen)}`;
      }
    }
  }
  const blocked = new Set(blockedStair === null ? [] : [blockedStair]);
  const routes = blockedStair === null ? baseline : open(blocked);

  const walkers: Walker[] = [];
  const stranded: StrandedOccupant[] = placement.unplaced.map((id) => ({
    occupantId: id,
    roomId: null,
    reason: "the board has no occupied room to place them in",
  }));
  for (const { o, route } of routes) {
    if (!route) {
      stranded.push({
        occupantId: o.id,
        roomId: o.roomId,
        reason: blocked.has(o.nodeId) ? "they start on the blocked stair" : "no open stair is reachable from their room",
      });
      continue;
    }
    walkers.push(walkerOf(g, o.id, route.path));
  }
  const { waits, through, roomPeaks, roomThrough, roomWaiters } = walk(g, walkers);
  const byId = new Map(walkers.map((w) => [w.id, w]));

  const occupants: DrillOccupant[] = placement.occupants.map((o) => {
    const w = byId.get(o.id);
    return {
      id: o.id,
      roomId: o.roomId,
      startNode: o.nodeId,
      stair: w ? w.path.at(-1)! : null,
      path: w ? w.path : [],
      distanceM: w ? round2(w.legs.reduce((s, m) => s + m, 0)) : 0,
      clearedAtS: w ? w.clearedAt : null,
      waitedS: w ? round2(w.waited) : 0,
      track: w ? w.track : [],
    };
  });

  const zones: DrillZone[] = placement.rooms
    .filter((r) => r.count > 0)
    .map((r) => {
      const inRoom = occupants.filter((o) => o.roomId === r.roomId);
      const times = inRoom.map((o) => o.clearedAtS);
      return {
        roomId: r.roomId,
        label: r.label,
        occupants: inRoom.length,
        clearedAtS: times.some((t) => t === null) ? null : Math.max(...(times as number[])),
      };
    });

  const wardenPosts: WardenPost[] = zones.flatMap((z) => {
    const exits = new Map<string, { doorId: string | null; nodeId: string; n: number }>();
    for (const o of occupants.filter((x) => x.roomId === z.roomId && x.path.length > 1)) {
      const i = o.path.findIndex((id, k) => k > 0 && g.nodes.get(id)!.roomId !== z.roomId);
      if (i <= 0) continue;
      const inside = o.path[i - 1];
      const doorId = g.adj.get(inside)!.find((e) => e.to === o.path[i])?.doorId ?? null;
      const key = `${inside}>${o.path[i]}`;
      const found = exits.get(key) ?? { doorId, nodeId: inside, n: 0 };
      found.n += 1;
      exits.set(key, found);
    }
    // Every way out anyone takes, the busiest first (then the lower key).
    return [...exits.entries()]
      .sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
      .map(([, e]) => ({ roomId: z.roomId, label: z.label, doorId: e.doorId, nodeId: e.nodeId, people: e.n, occupants: z.occupants }));
  });

  // The bottleneck is a room: the one with the most person-seconds queued for it, then the most people through it, then the
  // lower room id. Only a room someone queued in is one; with no queue there is none. Its figures are the
  // whole room's, and the board marks the room's node with the most queued time (then through, then id). Waits are
  // fractions of a tick, so they are compared to the hundredth and reported to the whole second.
  const byRoom = new Map<string, { nodeId: string; personSeconds: number }>();
  for (const [nodeId, exact] of [...waits.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const wait = round2(exact);
    if (wait === 0) continue;
    const roomId = g.nodes.get(nodeId)!.roomId;
    const room = byRoom.get(roomId);
    if (!room) {
      byRoom.set(roomId, { nodeId, personSeconds: wait });
      continue;
    }
    const best = room.nodeId;
    if (wait > round2(waits.get(best)!) || (wait === round2(waits.get(best)!) && (through.get(nodeId) ?? 0) > (through.get(best) ?? 0))) {
      room.nodeId = nodeId;
    }
    room.personSeconds += wait;
  }
  let bottleneck: Bottleneck | null = null;
  for (const [roomId, room] of [...byRoom.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const candidate: Bottleneck = {
      roomId,
      label: label(room.nodeId),
      nodeId: room.nodeId,
      personSeconds: Math.round(room.personSeconds),
      peakQueue: roomPeaks.get(roomId) ?? 0,
      waiters: roomWaiters.get(roomId)?.size ?? 0,
      mostWaitedS: Math.round(Math.max(0, ...(roomWaiters.get(roomId)?.values() ?? []))),
      throughput: roomThrough.get(roomId)?.size ?? 0,
    };
    if (
      !bottleneck ||
      candidate.personSeconds > bottleneck.personSeconds ||
      (candidate.personSeconds === bottleneck.personSeconds && candidate.throughput > bottleneck.throughput)
    ) {
      bottleneck = candidate;
    }
  }

  const cleared = walkers.map((w) => w.clearedAt!);
  return {
    buildingId: building.id,
    seed,
    headcount,
    placement: placement.basis,
    scenario: {
      blockedStair: blockedStair === null ? null : { nodeId: blockedStair, label: label(blockedStair) },
      wouldUse: blockedStair === null ? 0 : users.get(blockedStair)!,
      rule,
    },
    openStairs: g.stairs.filter((s) => !blocked.has(s)),
    occupants,
    timeToClearS: cleared.length === 0 ? 0 : Math.max(...cleared),
    allClear: stranded.length === 0,
    zones,
    bottleneck,
    wardenPosts,
    stranded,
    provenance: headcount.provenance,
  };
}

/** "A", "A and B", "A, B and C". */
function listOf(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** What losing a stair costs (used to rank scenario ties): who is cut off, and when the rest are in a stair. */
function lossOf(
  g: Graph,
  routes: { o: { id: string }; route: { path: string[] } | null }[],
): { stranded: number; walking: number; timeS: number } {
  const walkers = routes.flatMap(({ o, route }) => (route ? [walkerOf(g, o.id, route.path)] : []));
  walk(g, walkers);
  return {
    stranded: routes.length - walkers.length,
    walking: walkers.length,
    timeS: walkers.reduce((m, w) => Math.max(m, w.clearedAt!), 0),
  };
}
