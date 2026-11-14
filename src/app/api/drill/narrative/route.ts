// POST /api/drill/narrative: the drill narrator (SPEC §4.4). The body is
// `{facts}`, the drill's numbers and room names (src/drill/facts.ts), checked
// against a strict schema, so no node, coordinate or edge can arrive here.
// Answers `NarrativeAnswer`.
import { narrateDrill, NarratorUnavailableError, NoNarrativeError } from "@/agents/drill";
import { forcedChatModelSelection } from "@/adapters/llm";
import { DrillFacts } from "@/drill";
import { withLlmFallback } from "@/lib/fallback";
import { forcedFromRequest } from "@/lib/mode";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "the body must be JSON: {facts}" }, { status: 400 });
  }
  const parsed = DrillFacts.safeParse((body as { facts?: unknown } | null)?.facts);
  if (!parsed.success) {
    return Response.json({ error: `the facts do not fit the schema: ${parsed.error.issues[0]?.message ?? "invalid"}` }, { status: 400 });
  }
  try {
    const forced = forcedFromRequest(request).has("llm");
    const answer = await narrateDrill(parsed.data, forced ? { selection: forcedChatModelSelection() } : {});
    return Response.json(withLlmFallback(answer));
  } catch (error) {
    if (error instanceof NoNarrativeError) return Response.json({ error: error.message }, { status: 404 });
    // A failed live call is worth a retry (503); anything else is a bug, logged here and not echoed to the browser.
    if (error instanceof NarratorUnavailableError) return Response.json({ error: error.message }, { status: 503 });
    console.error("POST /api/drill/narrative:", error);
    return Response.json({ error: "the narrator could not answer" }, { status: 500 });
  }
}
