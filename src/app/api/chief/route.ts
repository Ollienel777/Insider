// POST /api/chief: the Security Chief re-plans on one alarm transition
// (SPEC §2 beat 5, §4.4). The body is a `ChiefRequest`: the transition, the
// last-known zone, the guard roster by zone, and the zone list, and nothing
// else (SPEC §4.5): a body with any other field, such as a node or a
// coordinate, is refused. The server reads the mission and the security
// profile from its own cached manifest. Answers `ChiefAnswer`.
import { ChiefRequest, replanChief } from "@/agents/chief";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "the body must be JSON: a ChiefRequest" }, { status: 400 });
  }
  const parsed = ChiefRequest.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return Response.json({ error: `bad request at ${issue.path.join(".") || "body"}: ${issue.message}` }, { status: 400 });
  }
  try {
    const answer = await replanChief(parsed.data);
    if (!answer) return Response.json({ error: `no cached level for building "${parsed.data.buildingId}"` }, { status: 404 });
    return Response.json(answer);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: `the Chief could not answer: ${message}` }, { status: 500 });
  }
}
