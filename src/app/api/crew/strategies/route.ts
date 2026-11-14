// POST /api/crew/strategies: the crew proposes Owner Mode's attempts (issue 126).
// The body is `{buildingId}`, with an optional `setupId` (an owner's setup,
// issue 125; echoed back, not yet read), and nothing else: the server reads the
// entries, zones and guard roster from its own cached manifest, so no floor
// data can arrive here or travel on to a model (SPEC §4.5). Answers
// `StrategiesAnswer`; the browser plays the strategies on the board.
import { forcedChatModelSelection, safeErrorMessage } from "@/adapters/llm";
import { NoRecordingError, proposeStrategies } from "@/agents/crew";
import { withLlmFallback } from "@/lib/fallback";
import { forcedFromRequest } from "@/lib/mode";

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const KEYS = new Set(["buildingId", "setupId"]);

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "the body must be JSON: {buildingId, setupId?}" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json({ error: "the body must be an object: {buildingId, setupId?}" }, { status: 400 });
  }
  const extra = Object.keys(body).filter((key) => !KEYS.has(key));
  if (extra.length > 0) {
    return Response.json({ error: `the body takes only buildingId and setupId, not ${extra.join(", ")}` }, { status: 400 });
  }
  const { buildingId, setupId } = body as { buildingId?: unknown; setupId?: unknown };
  if (typeof buildingId !== "string" || !ID.test(buildingId)) {
    return Response.json({ error: "buildingId must be an id" }, { status: 400 });
  }
  if (setupId !== undefined && (typeof setupId !== "string" || !ID.test(setupId))) {
    return Response.json({ error: "setupId, when given, must be an id" }, { status: 400 });
  }
  try {
    const forced = forcedFromRequest(request).has("llm");
    const answer = await proposeStrategies(buildingId, forced ? { selection: forcedChatModelSelection() } : {});
    if (!answer) return Response.json({ error: `no cached level for building "${buildingId}"` }, { status: 404 });
    return Response.json({ ...withLlmFallback(answer), ...(setupId !== undefined && { setupId }) });
  } catch (error) {
    if (error instanceof NoRecordingError) return Response.json({ error: error.message }, { status: 503 });
    return Response.json({ error: `the crew could not plan: ${safeErrorMessage(error)}` }, { status: 500 });
  }
}
