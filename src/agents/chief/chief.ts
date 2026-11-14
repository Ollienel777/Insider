// The Security Chief (SPEC §4.4): one structured call per alarm transition.
// Live, the fast model answers within LLM_TIMEOUT_MS; in fake mode, on a
// timeout or on a failure, the recorded turn for the transition answers, or
// the deterministic template when there is none, and the answer says which.
// The browser clamps the orders on the board (engine/orders.ts); the server
// never sees the floor. Guards never wait for this: the engine has already
// sent them converging when the call starts.
import { readLevel } from "@/agents/builder/live-levels";
import { defaultMissionId } from "@/agents/builder/missions";
import { structuredCall, type StructuredCallOptions } from "@/adapters/llm";
import { ChiefOrders } from "@/domain";
import { chiefMessages } from "./prompt";
import { loadChiefRecording, matchTurn } from "./recorded";
import type { ChiefAnswer, ChiefRequest, ChiefSource } from "./request";
import { chiefTemplate } from "./template";

export interface ReplanOptions {
  /** Test seams for structuredCall. */
  selection?: StructuredCallOptions<ChiefOrders>["selection"];
  timeoutMs?: number;
  fixturesDir?: string;
  levelsDir?: string;
}

/** Re-plans on one transition. Null when the building has no cached level for the mission. */
export async function replanChief(request: ChiefRequest, options: ReplanOptions = {}): Promise<ChiefAnswer | null> {
  const missionId = request.missionId ?? defaultMissionId(request.buildingId);
  const cached = missionId ? await readLevel(request.buildingId, missionId, options.levelsDir) : null;
  if (!cached) return null;
  const { manifest } = cached;

  let source: ChiefSource = "model";
  let recording: string | undefined;
  const fake = async (): Promise<ChiefOrders> => {
    const file = await loadChiefRecording(request.buildingId, options.fixturesDir);
    const turn = file ? matchTurn(file, request) : null;
    if (turn) {
      source = "recorded";
      recording = turn.id;
      return turn.orders;
    }
    source = "template";
    return chiefTemplate(manifest, request);
  };
  const answer = await structuredCall(ChiefOrders, chiefMessages(manifest, request), {
    fake,
    name: "chief_orders",
    role: "fast",
    selection: options.selection,
    timeoutMs: options.timeoutMs,
  });
  return {
    orders: answer.value,
    recorded: answer.recorded,
    ...(answer.reason && { reason: answer.reason }),
    source: answer.recorded ? source : "model",
    ...(answer.recorded && recording && { recording }),
  };
}
