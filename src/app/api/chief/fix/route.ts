// POST /api/chief/fix: the Security Chief suggests one change after an Owner
// Mode batch (issue 127). The body is `{buildingId, summary}` and nothing else:
// the summary is a strict `FixSummary` of counts, zone ids and element ids,
// so no node, coordinate or route of the floor can arrive here or travel on
// to a model (SPEC §4.5). The server reads the security profile from its own
// cached manifest. Answers `FixAnswer`; the browser applies the change and
// plays the batch again.
import { forcedChatModelSelection, safeErrorMessage } from "@/adapters/llm";
import { suggestFix } from "@/agents/chief";
import { FixRequest } from "@/domain";
import { withLlmFallback } from "@/lib/fallback";
import { forcedFromRequest } from "@/lib/mode";

const KEYS = new Set(["buildingId", "summary"]);

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "the body must be JSON: {buildingId, summary}" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json({ error: "the body must be an object: {buildingId, summary}" }, { status: 400 });
  }
  const extra = Object.keys(body).filter((key) => !KEYS.has(key));
  if (extra.length > 0) {
    return Response.json({ error: `the body takes only buildingId and summary, not ${extra.join(", ")}` }, { status: 400 });
  }
  const parsed = FixRequest.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return Response.json({ error: `bad request at ${issue.path.join(".") || "body"}: ${issue.message}` }, { status: 400 });
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(parsed.data.buildingId)) {
    return Response.json({ error: "buildingId must be an id" }, { status: 400 });
  }
  try {
    const forced = forcedFromRequest(request).has("llm");
    const answer = await suggestFix(parsed.data, forced ? { selection: forcedChatModelSelection() } : {});
    if (!answer) return Response.json({ error: `no cached level for building "${parsed.data.buildingId}"` }, { status: 404 });
    return Response.json(withLlmFallback(answer));
  } catch (error) {
    return Response.json({ error: `the Chief could not suggest a fix: ${safeErrorMessage(error)}` }, { status: 500 });
  }
}
