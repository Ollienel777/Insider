// The crew's strategies for Owner Mode (#126): one structured call that
// proposes about five ways in, which the engine then plays across seeds in
// the browser. Like the crew's order call it sees zone ids, fiction names,
// the guard roster and the security profile, never the floor (SPEC §4.5).
// Live, the fast model answers within LLM_TIMEOUT_MS; in fake mode, on a
// timeout or on a failure, the recorded strategies answer, and the answer
// says so. A building with no recording (a showcase kit building, whose level
// lives in memory and may not enter the repo, issue 205) gets strategies worked
// out from its manifest's entries instead (`derivedStrategies`), never written
// down. Every strategy is checked against the manifest: one naming an entry or
// zone the level does not have is dropped with a reason.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { readLevel } from "@/agents/builder/live-levels";
import { isFixtureBuilding } from "@/agents/builder/cache";
import { defaultMissionId } from "@/agents/builder/missions";
import { structuredCall, type StructuredAnswer, type StructuredCallOptions } from "@/adapters/llm";
import { Strategy, StrategySet, type DroppedStrategy, type LevelManifest } from "@/domain";
import { crewContext, type CrewContext } from "./prompt";
import { CREW_FIXTURES, NoRecordingError } from "./recorded";

/** The crew's view for strategies: its order context, and which of its zones are entries. */
export interface StrategyContext extends CrewContext {
  entries: string[];
}

export const STRATEGIES_PROMPT_HEAD = "You are the crew for a Hobbs job, planning attempts on the building.";

/** How many strategies the crew is asked for. */
export const STRATEGY_COUNT = 5;

export const StrategyRecording = z.object({
  buildingId: z.string().min(1),
  note: z.string().optional(),
  strategies: z.array(Strategy).min(1),
});
export type StrategyRecording = z.infer<typeof StrategyRecording>;

export interface StrategiesAnswer {
  /** The strategies that name only the manifest's entries and zones. */
  strategies: Strategy[];
  /** The ones left out, and why. */
  dropped: DroppedStrategy[];
  /** True when the recorded strategies answered, not a live model. */
  recorded: boolean;
  /** Why the recording answered: structuredCall's reason, or "error" when no live strategy survived the clamp. */
  reason?: StructuredAnswer<StrategySet>["reason"];
  /** True when the stand-in was `derivedStrategies` (no recording for the building), not a recording. */
  derived?: boolean;
}

export interface StrategiesOptions {
  /** Test seams for structuredCall. */
  selection?: StructuredCallOptions<StrategySet>["selection"];
  timeoutMs?: number;
  fixturesDir?: string;
  levelsDir?: string;
  /** The mission whose level to read (#119); the building's own mission by default. */
  missionId?: string;
}

/** Reads and checks a building's recorded strategies; null when there are none. */
export async function loadStrategyRecording(
  buildingId: string,
  dir: string = CREW_FIXTURES,
): Promise<StrategyRecording | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(buildingId)) return null;
  let raw: string;
  try {
    raw = await readFile(path.join(dir, `strategies-${buildingId}.json`), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return StrategyRecording.parse(JSON.parse(raw));
}

/**
 * Five strategies worked out from the manifest alone, for a building with no
 * recording (issue 205): its first two ways in, each way of choosing a route,
 * and the three tempers, so the batch still plays a spread of attempts when the
 * model doesn't answer. Deterministic, so the counts hold from run to run.
 */
export function derivedStrategies(manifest: LevelManifest): Strategy[] {
  const [first, second = first] = manifest.entries.map((e) => e.id);
  if (!first) return [];
  return [
    { id: "fast", name: "In and out fast", entryId: first, exitId: first, timing: "immediate", route: "shortest", via: [], risk: "high", rationale: "The shortest way there and back, before anyone looks." },
    { id: "patient", name: "Wait out the round", entryId: first, exitId: first, timing: "wait-for-round", route: "shortest", via: [], risk: "low", rationale: "Let the guards pass, then take the short way." },
    { id: "cameras", name: "Keep off the cameras", entryId: first, exitId: second, timing: "immediate", route: "avoid-cameras", via: [], risk: "medium", rationale: "A longer way round, out of the cameras' sight." },
    { id: "quiet", name: "Through the quiet suites", entryId: second, exitId: second, timing: "wait-for-round", route: "quiet-zones", via: [], risk: "low", rationale: "Through the vacant suites, where nobody walks at night." },
    { id: "bold", name: "Sprint past the cameras", entryId: second, exitId: first, timing: "immediate", route: "avoid-cameras", via: [], risk: "high", rationale: "Out of the cameras' sight, and fast where it can't be." },
  ];
}

/**
 * Keeps the strategies that name only the manifest's entries (for the way in
 * and out) and zones (for the via list), each id once; the rest are dropped
 * with the reason.
 */
export function clampStrategies(
  manifest: LevelManifest,
  strategies: readonly Strategy[],
): { strategies: Strategy[]; dropped: DroppedStrategy[] } {
  const entries = new Set(manifest.entries.map((e) => e.id));
  const zones = new Set(manifest.zones.map((z) => z.id));
  const kept: Strategy[] = [];
  const dropped: DroppedStrategy[] = [];
  const ids = new Set<string>();
  for (const strategy of strategies) {
    const reason = ids.has(strategy.id)
      ? `a strategy with id "${strategy.id}" came earlier`
      : !entries.has(strategy.entryId)
        ? `"${strategy.entryId}" is not an entry of this level`
        : !entries.has(strategy.exitId)
          ? `"${strategy.exitId}" is not an entry of this level, so it cannot be the way out`
          : strategy.via.filter((id) => !zones.has(id)).map((id) => `"${id}" is not a zone of this level`)[0];
    if (reason) dropped.push({ strategyId: strategy.id, reason });
    else {
      ids.add(strategy.id);
      kept.push(strategy);
    }
  }
  return { strategies: kept, dropped };
}

export function strategiesSystemPrompt(context: StrategyContext): string {
  const s = context.security;
  const entries = new Set(context.entries);
  return `${STRATEGIES_PROMPT_HEAD}

Propose ${STRATEGY_COUNT} distinct strategies for getting to the objective and
out again. The game plays each one itself, so make them differ: in the entry,
the timing, the route preference or the risk taken. Each has:

- id: a short lowercase slug, unique; name: under 40 characters.
- entryId: the entry to come in by; exitId: the entry to leave by. Both from
  the entries below.
- timing: "immediate", or "wait-for-round" to pause at the entry for up to
  two turns and look further ahead before moving.
- route: "shortest", "quiet-zones" (keep to the vacant suites) or
  "avoid-cameras".
- via: zero to two zone ids from the zones below, to pass through in order
  on the way to the objective. Usually empty.
- risk: "low" (patient, waits for clear moves), "medium" or "high"
  (moves fast and sprints).
- rationale: one short sentence, under 120 characters, on why it might work.

Use only the ids listed; never invent one. You know how many cameras and
guards there are, not where they are.

Mission: ${context.mission}. Objective: ${context.objective}.
Security: ${s.era} era, ${s.cameraCount} ${s.cameraKind} cameras, ${s.lockKind} locks.
Guards on the floor: ${context.guards.join(", ")}.
Entries (id: name):
${context.zones.filter((z) => entries.has(z.id)).map((z) => `- ${z.id}: ${z.name}`).join("\n")}
Zones (id: name):
${context.zones.filter((z) => !entries.has(z.id)).map((z) => `- ${z.id}: ${z.name}`).join("\n")}`;
}

export function strategiesMessages(context: StrategyContext) {
  return [
    { role: "system", content: strategiesSystemPrompt(context) },
    { role: "user", content: `Plan ${STRATEGY_COUNT} attempts on ${context.buildingId}.` },
  ];
}

/** The crew's strategies for one building's cached level for a mission. Null when there is no cached level. */
export async function proposeStrategies(
  buildingId: string,
  options: StrategiesOptions = {},
): Promise<StrategiesAnswer | null> {
  const missionId = options.missionId ?? defaultMissionId(buildingId);
  const cached = missionId ? await readLevel(buildingId, missionId, options.levelsDir) : null;
  if (!cached) return null;
  const { manifest } = cached;
  // Set by the stand-in, read after the call (an object, so the compiler sees it can change).
  const stand = { derived: false };
  const fake = async (): Promise<StrategySet> => {
    const file = await loadStrategyRecording(buildingId, options.fixturesDir);
    if (file) return { strategies: file.strategies };
    // No recording: a fixture building must have one; any other (a showcase kit building) gets the derived set.
    const strategies = isFixtureBuilding(buildingId) ? [] : derivedStrategies(manifest);
    if (strategies.length === 0) throw new NoRecordingError(`no recorded crew strategies for "${buildingId}"`);
    stand.derived = true;
    return { strategies };
  };
  const context: StrategyContext = { ...crewContext(manifest), entries: manifest.entries.map((e) => e.id) };
  const answer = await structuredCall(StrategySet, strategiesMessages(context), {
    fake,
    name: "crew_strategies",
    role: "fast",
    selection: options.selection,
    timeoutMs: options.timeoutMs,
  });
  const clamped = clampStrategies(manifest, answer.value.strategies);
  if (!answer.recorded && clamped.strategies.length === 0) {
    // Every live strategy named an id the level does not have: the recording
    // stands in, as for a failed call, and the live drops stay reported.
    const file = await loadStrategyRecording(buildingId, options.fixturesDir);
    const standIn = file?.strategies ?? (isFixtureBuilding(buildingId) ? null : derivedStrategies(manifest));
    if (standIn && standIn.length > 0) {
      const recorded = clampStrategies(manifest, standIn);
      return {
        strategies: recorded.strategies,
        dropped: [...clamped.dropped, ...recorded.dropped],
        recorded: true,
        reason: "error",
        ...(!file && { derived: true }),
      };
    }
  }
  return {
    ...clamped,
    recorded: answer.recorded,
    ...(answer.reason && { reason: answer.reason }),
    ...(answer.recorded && stand.derived && { derived: true }),
  };
}
