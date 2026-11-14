// The batch debrief's engine half (issue 127): a batch summed for the debrief,
// the Chief's one change applied to a placed level, and the same strategies
// and seeds played again on it, so the debrief (and issue 128's compare) can
// show the count before and after. Pure, like the rest of the engine: the
// same batch, change and seeds always give the same answer.
import {
  FIX_RETIME_MAX,
  type BatchResult,
  type BatchSummary,
  type ChiefFix,
  type DetectorFinding,
  type FixChange,
} from "@/domain";
import { BATCH_SEEDS, roundOf, runBatch, type BatchInput } from "./autoplay";
import { compileBoard, zoneTarget, type Level } from "./state";

/** Sums a batch: the count, each strategy's, the escapes' commonest route, what noticed the player first, and the strip. */
export function summariseBatch(result: BatchResult): BatchSummary {
  const { runs } = result;
  const escapes = runs.filter((r) => r.escaped);
  const byStrategy = result.summary.byStrategy.map((s) => ({ strategyId: s.strategyId, runs: s.runs, escaped: s.escaped }));

  // The commonest route among the escapes; a tie goes to the shorter, then the first played.
  const routes = new Map<string, { nodes: string[]; count: number; first: number }>();
  escapes.forEach((run, i) => {
    const key = run.route.join(">");
    const known = routes.get(key);
    if (known) known.count++;
    else routes.set(key, { nodes: [...run.route], count: 1, first: i });
  });
  const top = [...routes.values()].sort(
    (a, b) => b.count - a.count || a.nodes.length - b.nodes.length || a.first - b.first,
  )[0];

  const found = new Map<string, DetectorFinding>();
  for (const run of runs) {
    if (!run.detectedBy || run.firstDetectionTurn === null) continue;
    const key = `${run.detectedBy.kind}:${run.detectedBy.id ?? ""}`;
    const known = found.get(key) ?? { ...run.detectedBy, count: 0, turns: [] };
    known.count++;
    if (!known.turns.includes(run.firstDetectionTurn)) known.turns.push(run.firstDetectionTurn);
    found.set(key, known);
  }
  const detectors = [...found.values()]
    .map((d) => ({ ...d, turns: [...d.turns].sort((a, b) => a - b) }))
    .sort((a, b) => b.count - a.count || `${a.kind}:${a.id ?? ""}`.localeCompare(`${b.kind}:${b.id ?? ""}`));

  return {
    buildingId: result.buildingId,
    total: runs.length,
    escaped: escapes.length,
    byStrategy,
    topRoute: top ? { nodes: top.nodes, count: top.count } : null,
    detectors,
    strip: runs.map((r) => ({ strategyId: r.strategyId, seed: r.seed, outcome: r.outcome })),
  };
}

export type AppliedFix = { ok: true; level: Level } | { ok: false; level: Level; reason: string };

/**
 * The level with the Chief's change made, in the engine's zone ids. A change
 * this level cannot take (an element or zone it does not have, a field the
 * kind needs left out) leaves the level as it is, with the reason.
 */
export function applyFix(level: Level, change: FixChange): AppliedFix {
  const refuse = (reason: string): AppliedFix => ({ ok: false, level, reason });
  const board = compileBoard(level);
  const zone = (id: string | undefined) => (id === undefined ? null : zoneTarget(board, id));
  switch (change.kind) {
    case "move-camera": {
      const cameras = level.cameras ?? [];
      if (!cameras.some((c) => c.id === change.elementId)) return refuse(`no camera "${change.elementId}"`);
      const to = zone(change.to);
      if (!to) return refuse(change.to === undefined ? "move-camera needs a zone to cover" : `no zone "${change.to}"`);
      return {
        ok: true,
        level: { ...level, cameras: cameras.map((c) => (c.id === change.elementId ? { ...c, cover: [...to.nodes] } : c)) },
      };
    }
    case "retime-guard": {
      const guard = level.guards.find((g) => g.id === change.elementId);
      if (!guard) return refuse(`no guard "${change.elementId}"`);
      const by = change.byTurns;
      if (by === undefined || !Number.isInteger(by) || by === 0) return refuse("retime-guard needs a whole, non-zero byTurns");
      if (Math.abs(by) > FIX_RETIME_MAX) return refuse(`a round moves at most ${FIX_RETIME_MAX} turns either way`);
      const round = roundOf(board, guard.patrol);
      if (round.length < 2) return refuse(`guard "${guard.id}" holds a post and walks no round`);
      // Later by `by` turns: it starts `by` nodes back along its round.
      const at = (((-by % round.length) + round.length) % round.length);
      const patrol = [...round.slice(at), ...round.slice(0, at)];
      return { ok: true, level: { ...level, guards: level.guards.map((g) => (g.id === guard.id ? { ...g, patrol } : g)) } };
    }
    case "lock-door": {
      const into = zone(change.elementId);
      if (!into) return refuse(`no zone "${change.elementId}"`);
      const inside = new Set(into.nodes);
      const doors = level.floor.edges
        .filter((e) => e.door?.lockable && inside.has(e.a) !== inside.has(e.b))
        .map((e) => e.door!.id)
        .filter((id) => !level.lockedDoors.includes(id));
      if (doors.length === 0) return refuse(`zone "${change.elementId}" has no unlocked door that locks`);
      return { ok: true, level: { ...level, lockedDoors: [...level.lockedDoors, ...new Set(doors)] } };
    }
    case "add-guard": {
      const taken = [...level.guards, ...(level.cleaners ?? [])].some((g) => g.id === change.elementId);
      if (taken) return refuse(`"${change.elementId}" is already on the floor`);
      const to = zone(change.to);
      if (!to) return refuse(change.to === undefined ? "add-guard needs a zone to walk" : `no zone "${change.to}"`);
      // Clear of the ways in where it can be, so the new guard is not standing on an entry.
      const away = to.nodes.filter((id) => !level.exits.includes(id));
      const patrol = away.length > 0 ? away : [...to.nodes];
      return { ok: true, level: { ...level, guards: [...level.guards, { id: change.elementId, patrol }] } };
    }
  }
}

export interface Rerun {
  fix: ChiefFix;
  /** Null when the change applied; else why it could not, and `after` replays the setup unchanged. */
  dropped: string | null;
  before: BatchSummary;
  after: BatchSummary;
  beforeResult: BatchResult;
  afterResult: BatchResult;
}

/**
 * Plays the same strategies on the same seeds with the change made to every
 * seed's level, and sums both batches. Pass `before` to reuse a batch already
 * played on `input`.
 */
export function rerunWithFix(input: BatchInput, fix: ChiefFix, before: BatchResult = runBatch(input)): Rerun {
  const seeds = input.seeds ?? BATCH_SEEDS;
  const first = seeds.length > 0 ? applyFix(input.levelFor(seeds[0]), fix.change) : null;
  let dropped: string | null = first && !first.ok ? first.reason : null;
  const afterResult =
    dropped !== null
      ? before
      : runBatch({
          ...input,
          levelFor: (seed) => {
            const applied = applyFix(input.levelFor(seed), fix.change);
            // A seed whose level cannot take the change plays it unchanged; the first reason is kept.
            if (!applied.ok) dropped ??= applied.reason;
            return applied.level;
          },
        });
  return { fix, dropped, before: summariseBatch(before), after: summariseBatch(afterResult), beforeResult: before, afterResult };
}
