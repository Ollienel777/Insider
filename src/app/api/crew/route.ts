// POST /api/crew: brief the crew (SPEC §2 beat 4, §4.4). The body is
// `{buildingId, order}`, plus the `missionId` whose level to read (issue 119), and nothing else: the server reads the zones and the
// guard roster from its own cached manifest, so no floor data can arrive
// here or travel on to a model (SPEC §4.5). Answers `CrewAnswer`.
import { FIXTURE_BUILDINGS } from "@/adapters/costar/fake";
import { forcedChatModelSelection, safeErrorMessage } from "@/adapters/llm";
import { briefCrew, CrewRequestError, NoRecordingError } from "@/agents/crew";
import { boardStandsIn, newFallback, withLlmFallback } from "@/lib/fallback";
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
    // `code`: the server holds no level for this kit building. A kit level lives in one server's memory, so a
    // restart or another instance loses it while the browser still holds the board (issue 142). A fixture
    // building's level is on disk, so its 404 (a mission it doesn't stage, say) stays an error.
    if (!answer) {
      const kit = !FIXTURE_BUILDINGS.some((b) => b.id === buildingId);
      return Response.json({ error: `no cached level for building "${buildingId}"`, ...(kit && { code: "no-level" }) }, { status: 404 });
    }
    return Response.json(withLlmFallback(answer));
  } catch (error) {
    if (error instanceof CrewRequestError) return Response.json({ error: error.message }, { status: 400 });
    // `code` tells the Plan screen this 503 means "no reply and no recording", so it may work a plan
    // out from the board (issue 140); a 503 from anywhere else stays an error.
    // A live call that timed out or failed carries the model's fallback, so the demo status toasts it as on
    // a fixture building; its line says the board stands in, since no recording did.
    if (error instanceof NoRecordingError) {
      const { reason } = error;
      const cause = reason === "timeout" ? "timeout" : reason === "error" ? "failed" : null;
      const fallback = cause && newFallback("llm", cause, boardStandsIn(cause));
      return Response.json({ error: error.message, code: "no-recording", ...(reason && { reason }), ...(fallback && { fallback }) }, { status: 503 });
    }
    return Response.json({ error: `the crew could not answer: ${safeErrorMessage(error)}` }, { status: 500 });
  }
}
