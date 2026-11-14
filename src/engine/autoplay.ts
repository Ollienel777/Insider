// Autoplay (#126): the crew plays a strategy itself, on the real engine. No
// model call per move: a planner picks each turn's action and `act` plays
// it, so every attempt follows the engine's own rules.
//
// Each turn the planner routes to its next goal (the strategy's via zones in
// order, then the objective, then the strategy's exit) by Dijkstra, weighting
// moves by the strategy's route preference. Before it moves it peeks: it
// plays the next few actions of the route forward on a copy of the run (the
// engine is pure, so a copy is free) and, if anything would notice the
// player, it waits for the cone or the camera to pass, or steps aside, as
// long as its patience lasts. Risk tolerance sets how far it peeks, how long
// it waits and whether it sprints. A batch plays strategies × seeds.
//
// Pure: the seed is the only source of variation (it places the level, via
// `levelFor`, and sets a strategy's opening pause), so the same strategies,
// seeds and levels always give the same batch.
import type { BatchResult, BatchRun, Detector, DetectorTally, DroppedStrategy, Strategy, StrategyTally } from "@/domain";
import { act, type Action } from "./actions";
import { neighbours } from "./path";
import { createRun, type Board, type Level, type RunState } from "./state";

/** A run still inside after this many turns ends as a timeout. */
export const AUTOPLAY_MAX_TURNS = 120;

/** The batch's default seeds: ten, so five strategies make 50 attempts. */
export const BATCH_SEEDS: readonly number[] = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

/** How the planner plays at each risk tolerance. */
const POLICY = {
  /** Actions played forward before a move is taken as clear. */
  low: { peek: 3, patience: 6, sprint: false },
  medium: { peek: 2, patience: 3, sprint: false },
  high: { peek: 1, patience: 1, sprint: true },
} as const;

/** What `wait-for-round` adds before the first move: a deeper peek, more patience, and a seeded pause. */
const ROUND = { peek: 1, patience: 4, pause: 3 } as const;

/** The extra cost of a move by route preference. */
const OFF_QUIET = 1;
const ON_CAMERA = 4;

/** A strategy resolved onto one board: its nodes. */
export interface ResolvedStrategy {
  strategy: Strategy;
  start: string;
  exit: string;
  /** Each via zone's nodes, in order. */
  via: readonly (readonly string[])[];
}

export type Resolution = { ok: true; plan: ResolvedStrategy } | { ok: false; reason: string };

/** Maps a strategy's entry, exit and via zones onto the level's nodes, or says why it cannot be played here. */
export function resolveStrategy(level: Level, strategy: Strategy): Resolution {
  const zones = level.zones ?? {};
  const entryNode = (id: string): string | null => {
    if (!Object.hasOwn(zones, id)) return null;
    const nodes = zones[id];
    return nodes.length === 1 && level.exits.includes(nodes[0]) ? nodes[0] : null;
  };
  const start = entryNode(strategy.entryId);
  if (!start) return { ok: false, reason: `entry "${strategy.entryId}" is not on this floor` };
  const exit = entryNode(strategy.exitId);
  if (!exit) return { ok: false, reason: `exit "${strategy.exitId}" is not on this floor` };
  const via: string[][] = [];
  for (const zoneId of strategy.via) {
    if (!Object.hasOwn(zones, zoneId)) return { ok: false, reason: `zone "${zoneId}" is not on this floor` };
    via.push([...zones[zoneId]]);
  }
  return { ok: true, plan: { strategy, start, exit, via } };
}

/** One attempt, played out. */
export interface Attempt {
  run: RunState;
  result: BatchRun;
}

/** Plays one resolved strategy on `level` from its entry until it is won, caught or out of turns. */
export function autoplay(level: Level, plan: ResolvedStrategy, maxTurns: number = AUTOPLAY_MAX_TURNS): Attempt {
  let run = createRun({ ...level, start: plan.start });
  const { board } = run;
  const { strategy } = plan;
  const policy = POLICY[strategy.risk];
  const covered = new Set(board.cameras.flatMap((c) => c.parts.flat()));
  const cost = (to: string): number =>
    1 +
    (strategy.route === "quiet-zones" && !board.quiet.has(to) ? OFF_QUIET : 0) +
    (strategy.route === "avoid-cameras" && covered.has(to) ? ON_CAMERA : 0);

  let viaIndex = 0;
  /** Turns since the last move toward the goal: waits and side steps. */
  let stalled = 0;
  let progressed = false;
  let moved = false;
  let reached = false;
  const rounding = strategy.timing === "wait-for-round";
  let pause = rounding ? hash(level.seed, strategy.id) % ROUND.pause : 0;

  while (run.status === "playing" && run.turn < maxTurns) {
    while (viaIndex < plan.via.length && plan.via[viaIndex].includes(run.playerNode)) viaIndex++;
    const action = choose();
    const next = act(run, action);
    // Every action chosen is legal; a refusal would be a planner bug, so wait instead of stalling.
    run = next.ok ? next.run : (act(run, { kind: "wait" }) as { ok: true; run: RunState }).run;
    if (run.carrying) reached = true;
    stalled = progressed ? 0 : stalled + 1;
    if (progressed && action.kind !== "take") moved = true;
  }

  const outcome = run.status === "won" ? "escaped" : run.status === "caught" ? "caught" : "timeout";
  const first = run.alarmEvents.find((e) => e.cause.kind !== "decay" && e.cause.kind !== "set");
  const detectedBy: Detector | null = first
    ? { kind: first.cause.kind as Detector["kind"], ...(first.cause.id !== undefined && { id: first.cause.id }) }
    : null;
  const route = [plan.start, ...run.turns.map((t) => t.player.nodeId)].filter((id, i, all) => i === 0 || id !== all[i - 1]);
  return {
    run,
    result: {
      strategyId: strategy.id,
      seed: level.seed,
      outcome,
      reachedObjective: reached,
      escaped: outcome === "escaped",
      turns: run.turn,
      route,
      firstDetectionTurn: first ? first.turn : null,
      detectedBy,
    },
  };

  /** This turn's action. */
  function choose(): Action {
    progressed = false;
    const here = run.playerNode;
    const viaDone = viaIndex >= plan.via.length;
    if (!run.carrying && viaDone && here === board.level.objective) return go({ kind: "take" });
    const goals = run.carrying ? [plan.exit] : viaDone ? [board.level.objective] : plan.via[viaIndex];
    const dist = distances(board, goals, run.locked, cost);
    const path = follow(board, here, dist, run.locked, cost);
    if (path.length < 2) return { kind: "wait" };

    const opening = rounding && !moved;
    const peek = policy.peek + (opening ? ROUND.peek : 0);
    const patience = policy.patience + (opening ? ROUND.patience : 0);
    const route = actionsAlong(board, run, path);
    const primary = route[0];
    const wait: Action = { kind: "wait" };

    if (opening && pause > 0 && clear(run, [wait])) {
      pause--;
      return wait;
    }
    if (clear(run, route.slice(0, peek))) return go(primary);
    const holding = stalled < patience;
    if (holding && clear(run, [wait])) return wait;

    // Step aside: a neighbour no farther from the goal that nothing watches.
    const best = dist.get(here) ?? Infinity;
    const aside = !holding ? undefined : neighbours(board, here)
      .filter((e) => e.to !== path[1] && (e.doorId === undefined || !run.locked.includes(e.doorId)))
      .filter((e) => (dist.get(e.to) ?? Infinity) <= best)
      .map((e) => e.to)
      .sort((a, b) => (dist.get(a) ?? Infinity) - (dist.get(b) ?? Infinity) || a.localeCompare(b))
      .find((to) => clear(run, [{ kind: "move", to }]));
    if (aside) return { kind: "move", to: aside };

    if (policy.sprint && primary.kind === "move" && path.length > 2 && route[1]?.kind === "move") {
      const sprint: Action = { kind: "sprint", to: path[2], via: path[1] };
      if (act(run, sprint).ok && clear(run, [sprint])) return go(sprint);
    }
    if (clear(run, [primary])) return go(primary);
    // Seen either way: keep moving, unless moving is what ends the run.
    const after = act(run, primary);
    if (after.ok && after.run.status === "caught" && clear(run, [wait])) return wait;
    return go(primary);
  }

  function go(action: Action): Action {
    progressed = true;
    return action;
  }
}

/** Whether playing `actions` in turn leaves the player unnoticed (an illegal one ends the check, clear so far). */
function clear(run: RunState, actions: readonly Action[]): boolean {
  let at = run;
  for (const action of actions) {
    const next = act(at, action);
    if (!next.ok) return true;
    if (next.run.status === "caught" || next.run.lastSeen !== at.lastSeen) return false;
    if (next.run.status !== "playing") return true;
    at = next.run;
  }
  return true;
}

/** The actions that walk `path` from the player's node: a locked door is picked, then crossed. */
function actionsAlong(board: Board, run: RunState, path: readonly string[]): Action[] {
  const out: Action[] = [];
  let picking = run.picking;
  for (let i = 1; i < path.length && out.length < 8; i++) {
    const exit = neighbours(board, path[i - 1]).find((e) => e.to === path[i])!;
    if (exit.doorId !== undefined && run.locked.includes(exit.doorId)) {
      const done = picking?.doorId === exit.doorId ? picking.progress : 0;
      for (let p = done; p < board.level.pickTurns; p++) out.push({ kind: "pick", doorId: exit.doorId });
      picking = null;
    }
    out.push({ kind: "move", to: path[i] });
  }
  return out;
}

/** The cost from every node to the nearest goal: Dijkstra backwards. A locked door costs its picks. */
function distances(
  board: Board,
  goals: readonly string[],
  locked: readonly string[],
  cost: (to: string) => number,
): Map<string, number> {
  const dist = new Map<string, number>(goals.map((g) => [g, 0]));
  const done = new Set<string>();
  for (;;) {
    let at: string | null = null;
    for (const [id, d] of dist) {
      if (done.has(id)) continue;
      if (at === null || d < dist.get(at)! || (d === dist.get(at)! && id < at)) at = id;
    }
    if (at === null) return dist;
    done.add(at);
    for (const exit of neighbours(board, at)) {
      // Moving exit.to → at costs entering `at`.
      const step = cost(at) + (exit.doorId !== undefined && locked.includes(exit.doorId) ? board.level.pickTurns : 0);
      const d = dist.get(at)! + step;
      if (d < (dist.get(exit.to) ?? Infinity)) dist.set(exit.to, d);
    }
  }
}

/** The cheapest path from `from` down the distance field, ties to the lower id. */
function follow(
  board: Board,
  from: string,
  dist: ReadonlyMap<string, number>,
  locked: readonly string[],
  cost: (to: string) => number,
): string[] {
  if (!dist.has(from)) return [from];
  const path = [from];
  let at = from;
  while (dist.get(at)! > 0 && path.length <= board.nodes.size) {
    const here = dist.get(at)!;
    const next = neighbours(board, at)
      .filter((e) => {
        const d = dist.get(e.to);
        if (d === undefined) return false;
        const step = cost(e.to) + (e.doorId !== undefined && locked.includes(e.doorId) ? board.level.pickTurns : 0);
        return Math.abs(d + step - here) < 1e-9;
      })
      .map((e) => e.to)
      .sort()[0];
    if (next === undefined) break;
    path.push(next);
    at = next;
  }
  return path;
}

export interface BatchInput {
  buildingId: string;
  strategies: readonly Strategy[];
  /** Defaults to `BATCH_SEEDS`. */
  seeds?: readonly number[];
  /** The level placed with a seed: the browser places the manifest on the floor for each one. */
  levelFor: (seed: number) => Level;
  maxTurns?: number;
}

/** Plays every playable strategy on every seed. Strategies the board cannot play are dropped with a reason. */
export function runBatch(input: BatchInput): BatchResult {
  const seeds = [...(input.seeds ?? BATCH_SEEDS)];
  const levels = seeds.map((seed) => input.levelFor(seed));
  const dropped: DroppedStrategy[] = [];
  const kept: { strategy: Strategy; plans: ResolvedStrategy[] }[] = [];
  const ids = new Set<string>();
  for (const strategy of input.strategies) {
    if (ids.has(strategy.id)) {
      dropped.push({ strategyId: strategy.id, reason: `a strategy with id "${strategy.id}" is already in the batch` });
      continue;
    }
    const plans: ResolvedStrategy[] = [];
    let reason: string | null = null;
    for (const level of levels) {
      const resolved = resolveStrategy(level, strategy);
      if (!resolved.ok) {
        reason = resolved.reason;
        break;
      }
      plans.push(resolved.plan);
    }
    if (reason) {
      dropped.push({ strategyId: strategy.id, reason });
      continue;
    }
    ids.add(strategy.id);
    kept.push({ strategy, plans });
  }

  const runs: BatchRun[] = kept.flatMap(({ plans }) =>
    plans.map((plan, i) => autoplay(levels[i], plan, input.maxTurns).result),
  );
  return {
    buildingId: input.buildingId,
    seeds,
    strategies: kept.map((k) => k.strategy),
    dropped,
    runs,
    summary: summarize(kept.map((k) => k.strategy.id), runs),
  };
}

function summarize(strategyIds: readonly string[], runs: readonly BatchRun[]): BatchResult["summary"] {
  const tally = (of: readonly BatchRun[]) => ({
    runs: of.length,
    escaped: of.filter((r) => r.outcome === "escaped").length,
    reachedObjective: of.filter((r) => r.reachedObjective).length,
    caught: of.filter((r) => r.outcome === "caught").length,
    timeout: of.filter((r) => r.outcome === "timeout").length,
  });
  const byStrategy: StrategyTally[] = strategyIds.map((strategyId) => ({
    strategyId,
    ...tally(runs.filter((r) => r.strategyId === strategyId)),
  }));
  const counts = new Map<string, DetectorTally>();
  for (const run of runs) {
    if (!run.detectedBy) continue;
    const key = `${run.detectedBy.kind}:${run.detectedBy.id ?? ""}`;
    const known = counts.get(key);
    counts.set(key, known ? { ...known, count: known.count + 1 } : { ...run.detectedBy, count: 1 });
  }
  const byDetector = [...counts.values()].sort(
    (a, b) => b.count - a.count || `${a.kind}:${a.id ?? ""}`.localeCompare(`${b.kind}:${b.id ?? ""}`),
  );
  return { ...tally(runs), byStrategy, byDetector };
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
