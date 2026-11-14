// POST /api/crew: brief the crew (SPEC §2 beat 4, §4.4). The body is
// `{buildingId, order}` and nothing else: the server reads the zones and the
// guard roster from its own cached manifest, so no floor data can arrive
// here or travel on to a model (SPEC §4.5). Answers `CrewAnswer`.
import { briefCrew, CrewRequestError, NoRecordingError } from "@/agents/crew";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "the body must be JSON: {buildingId, order}" }, { status: 400 });
  }
  const { buildingId, order } = (body ?? {}) as { buildingId?: unknown; order?: unknown };
  if (typeof buildingId !== "string" || typeof order !== "string") {
    return Response.json({ error: "buildingId and order must be strings" }, { status: 400 });
  }
  try {
    const answer = await briefCrew(buildingId, order);
    if (!answer) return Response.json({ error: `no cached level for building "${buildingId}"` }, { status: 404 });
    return Response.json(answer);
  } catch (error) {
    if (error instanceof CrewRequestError) return Response.json({ error: error.message }, { status: 400 });
    if (error instanceof NoRecordingError) return Response.json({ error: error.message }, { status: 503 });
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: `the crew could not answer: ${message}` }, { status: 500 });
  }
}
