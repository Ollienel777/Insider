// The crew (SPEC §4.4): one structured call per order. Live, the fast model
// answers within LLM_TIMEOUT_MS; in fake mode, on a timeout or on a failure,
// the keyword-routed recorded reply answers, and the answer says so. The
// browser checks the plan on the board (src/level/validate-plan.ts); the
// server never sees the floor.
import { readCachedLevel } from "@/agents/builder/cache";
import { defaultMissionId } from "@/agents/builder/missions";
import { structuredCall, type StructuredCallOptions } from "@/adapters/llm";
import { CrewPlan } from "@/domain";
import { crewContext, crewMessages, ORDER_MAX } from "./prompt";
import { loadCrewRecording, NoRecordingError, routeOrder } from "./recorded";

export interface CrewAnswer {
  plan: CrewPlan;
  /** True when a recorded reply answered, not a live model. */
  recorded: boolean;
  reason?: "fake mode" | "timeout" | "error";
  /** The recorded reply's id, when one answered. */
  recording?: string;
}

/** An order the crew will not read. */
export class CrewRequestError extends Error {
  override name = "CrewRequestError";
}

export interface BriefOptions {
  /** Test seams for structuredCall. */
  selection?: StructuredCallOptions<CrewPlan>["selection"];
  timeoutMs?: number;
  fixturesDir?: string;
  levelsDir?: string;
  /** The mission whose level to read (#119); the building's own mission by default. */
  missionId?: string;
}

/** Briefs the crew on one building's cached level for a mission. Null when there is no cached level. */
export async function briefCrew(buildingId: string, order: string, options: BriefOptions = {}): Promise<CrewAnswer | null> {
  const text = order.trim();
  if (text.length === 0) throw new CrewRequestError("the order is empty");
  if (text.length > ORDER_MAX) throw new CrewRequestError(`the order is longer than ${ORDER_MAX} characters`);
  const missionId = options.missionId ?? defaultMissionId(buildingId);
  const cached = missionId ? await readCachedLevel(buildingId, missionId, options.levelsDir) : null;
  if (!cached) return null;

  let recording: string | undefined;
  const fake = async () => {
    const file = await loadCrewRecording(buildingId, options.fixturesDir);
    if (!file) throw new NoRecordingError(`no recorded crew replies for "${buildingId}"`);
    const reply = routeOrder(file, text);
    recording = reply.id;
    return reply.plan;
  };
  const answer = await structuredCall(CrewPlan, crewMessages(crewContext(cached.manifest), text), {
    fake,
    name: "crew_plan",
    role: "fast",
    selection: options.selection,
    timeoutMs: options.timeoutMs,
  });
  return {
    plan: answer.value,
    recorded: answer.recorded,
    ...(answer.reason && { reason: answer.reason }),
    ...(recording && { recording }),
  };
}
