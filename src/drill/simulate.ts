// The drill simulation (SPEC §1, §2 beat 7, D21): the same building and
// board as the heist, run as an evacuation drill. Occupants stand in the
// floor's occupied rooms (headcount from CoStar's occupied area ÷ 250 sf),
// the scenario blocks the stair most of them would use (on a tie, the one
// whose loss costs the most time, and the report says it was a tie), and each walks to
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
   * The stair node to block. Default: the scenario's choice (the stair most
   * occupants would use; a tie goes to the stair whose loss costs the most
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
  /** Seconds spent queued at a full node. */
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

export interface WardenPost {
  roomId: string;
  label: string;
  /** The door most of the room's occupants leave through; null when the way out has no door. */
  doorId: string | null;
  /** Where the warden stands: the room's side of that way out. */
  nodeId: string;
  occupants: number;
}

export interface Bottleneck {
  nodeId: string;
  /** The room the node is in. */
  label: string;
  /** Occupant-seconds spent queued to enter it. */
  waitS: number;
  /** The most people queued for it at once. */
  peakQueue: number;
  /** People who passed through it. */
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
  /** The node with the most queued occupant-seconds; null when nobody queued. */
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
 * people this tick waits at its threshold.
 */
function walk(g: Graph, walkers: Walker[]): { waits: Map<string, number>; peaks: Map<string, number>; through: Map<string, number> } {
  const waits = new Map<string, number>();
  const peaks = new Map<string, number>();
  const through = new Map<string, number>();
  for (const w of walkers) {
    w.track.push(positionOf(g, w));
    if (w.legs.length === 0) w.clearedAt = 0;
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
          w.along = w.legs[w.leg];
          w.waited += TICK_S;
          waits.set(next, (waits.get(next) ?? 0) + TICK_S);
          queued.set(next, (queued.get(next) ?? 0) + 1);
          budget = 0;
          break;
        }
        entered.set(next, used + 1);
        through.set(next, (through.get(next) ?? 0) + 1);
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
    for (const [id, n] of queued) peaks.set(id, Math.max(peaks.get(id) ?? 0, n));
  }
  return { waits, peaks, through };
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
      rule = `${label(blockedStair)} is the stair most occupants would use (${of}), so the scenario blocks it`;
    } else {
      // A tie: block the stair whose loss strands the most people, then costs the most time, then the lower id.
      const cost = new Map(leaders.map((s) => [s, lossOf(g, open(new Set([s])))]));
      blockedStair = [...leaders].sort(
        (a, b) =>
          cost.get(b)!.stranded - cost.get(a)!.stranded || cost.get(b)!.timeS - cost.get(a)!.timeS || a.localeCompare(b),
      )[0];
      const chosen = blockedStair;
      const said = (s: string) => {
        const c = cost.get(s)!;
        return c.stranded === 0 ? `${c.timeS} s` : `${c.timeS} s, with ${c.stranded} unable to reach a stair`;
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
          `${each}, a tie. ${tieRule}, but losing any of them ` +
          `clears the floor in ${said(chosen)}, so the scenario blocks ${label(chosen)}, the first by node id`;
      } else {
        const against = listOf(others.map((s) => `${said(s)} without ${label(s)}`));
        rule =
          `${each}, a tie. ${tieRule}: without ${label(chosen)} ` +
          `the floor clears in ${said(chosen)}, against ${against}, so the scenario blocks ${label(chosen)}`;
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
  const { waits, peaks, through } = walk(g, walkers);
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
      waitedS: w ? w.waited : 0,
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
    const best = [...exits.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))[0];
    if (!best) return [];
    return [{ roomId: z.roomId, label: z.label, doorId: best[1].doorId, nodeId: best[1].nodeId, occupants: z.occupants }];
  });

  // Only a node someone queued for is a bottleneck; with no queue there is none.
  let bottleneck: Bottleneck | null = null;
  for (const [nodeId, n] of [...through.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if ((waits.get(nodeId) ?? 0) === 0) continue;
    const candidate = { nodeId, label: label(nodeId), waitS: waits.get(nodeId) ?? 0, peakQueue: peaks.get(nodeId) ?? 0, throughput: n };
    if (
      !bottleneck ||
      candidate.waitS > bottleneck.waitS ||
      (candidate.waitS === bottleneck.waitS && candidate.throughput > bottleneck.throughput)
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
): { stranded: number; timeS: number } {
  const walkers = routes.flatMap(({ o, route }) => (route ? [walkerOf(g, o.id, route.path)] : []));
  walk(g, walkers);
  return { stranded: routes.length - walkers.length, timeS: walkers.reduce((m, w) => Math.max(m, w.clearedAt!), 0) };
}
