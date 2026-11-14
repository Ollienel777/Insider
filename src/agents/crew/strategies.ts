// The crew's strategies for Owner Mode (#126): one structured call that
// proposes about five ways in, which the engine then plays across seeds in
// the browser. Like the crew's order call it sees zone ids, fiction names,
// the guard roster and the security profile, never the floor (SPEC §4.5).
// Live, the fast model answers within LLM_TIMEOUT_MS; in fake mode, on a
// timeout or on a failure, the recorded strategies answer, and the answer
// says so. Every strategy is checked against the manifest: one naming an
// entry or zone the level does not have is dropped with a reason.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { readCachedLevel } from "@/agents/builder/cache";
import { defaultMissionId } from "@/agents/builder/missions";
import { structuredCall, type StructuredCallOptions } from "@/adapters/llm";
import { Strategy, StrategySet, type DroppedStrategy, type LevelManifest } from "@/domain";
import { crewContext, type CrewContext } from "./prompt";

/** The crew's view for strategies: its order context, and which of its zones are entries. */
export interface StrategyContext extends CrewContext {
  entries: string[];
}
import { CREW_FIXTURES, NoRecordingError } from "./recorded";

export const STRATEGIES_PROMPT_HEAD = "You are the crew for a Heist Anywhere job, planning attempts on the building.";

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
  reason?: "fake mode" | "timeout" | "error";
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
- timing: "immediate", or "wait-for-round" to hold at the entry until a
  round has passed.
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
  const cached = missionId ? await readCachedLevel(buildingId, missionId, options.levelsDir) : null;
  if (!cached) return null;
  const { manifest } = cached;
  const fake = async (): Promise<StrategySet> => {
    const file = await loadStrategyRecording(buildingId, options.fixturesDir);
    if (!file) throw new NoRecordingError(`no recorded crew strategies for "${buildingId}"`);
    return { strategies: file.strategies };
  };
  const context: StrategyContext = { ...crewContext(manifest), entries: manifest.entries.map((e) => e.id) };
  const answer = await structuredCall(StrategySet, strategiesMessages(context), {
    fake,
    name: "crew_strategies",
    role: "fast",
    selection: options.selection,
    timeoutMs: options.timeoutMs,
  });
  return {
    ...clampStrategies(manifest, answer.value.strategies),
    recorded: answer.recorded,
    ...(answer.reason && { reason: answer.reason }),
  };
}
