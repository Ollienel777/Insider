// POST /api/crew: brief the crew (SPEC §2 beat 4, §4.4). The body is
// `{buildingId, order}`, plus the `missionId` whose level to read (issue 119), and nothing else: the server reads the zones and the
// guard roster from its own cached manifest, so no floor data can arrive
// here or travel on to a model (SPEC §4.5). Answers `CrewAnswer`.
import { forcedChatModelSelection, safeErrorMessage } from "@/adapters/llm";
import { briefCrew, CrewRequestError, NoRecordingError } from "@/agents/crew";
import { withLlmFallback } from "@/lib/fallback";
import { forcedFromRequest } from "@/lib/mode";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "the body must be JSON: {buildingId, order}" }, { status: 400 });
  }
  const { buildingId, order, missionId } = (body ?? {}) as { buildingId?: unknown; order?: unknown; missionId?: unknown };
  if (typeof buildingId !== "string" || typeof order !== "string") {
    return Response.json({ error: "buildingId and order must be strings" }, { status: 400 });
  }
  // Bounded like the Chief's ids (ShortId): 1 to 64 characters.
  if (missionId !== undefined && (typeof missionId !== "string" || missionId.length < 1 || missionId.length > 64)) {
    return Response.json({ error: "missionId must be a string of 1 to 64 characters" }, { status: 400 });
  }
  try {
    const forced = forcedFromRequest(request).has("llm");
    const answer = await briefCrew(buildingId, order, {
      ...(missionId && { missionId }),
      ...(forced && { selection: forcedChatModelSelection() }),
    });
    if (!answer) return Response.json({ error: `no cached level for building "${buildingId}"` }, { status: 404 });
    return Response.json(withLlmFallback(answer));
  } catch (error) {
    if (error instanceof CrewRequestError) return Response.json({ error: error.message }, { status: 400 });
    if (error instanceof NoRecordingError) return Response.json({ error: error.message }, { status: 503 });
    return Response.json({ error: `the crew could not answer: ${safeErrorMessage(error)}` }, { status: 500 });
  }
}
