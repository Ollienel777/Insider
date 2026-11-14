// POST /api/warm: one tiny request to the live model, so the crew's first
// call and the Chief's first re-plan do not pay its cold start (#90). Sends
// nothing in fake mode, live without a key, or with the model forced to
// fixtures. Always answers 200 `{warmed}` and never a `fallback`: a failed
// warm-up is silent.
import { warmLiveModel } from "@/adapters/llm";
import { forcedFromRequest } from "@/lib/mode";

export async function POST(request: Request): Promise<Response> {
  const warmed = forcedFromRequest(request).has("llm") ? false : await warmLiveModel();
  return Response.json({ warmed });
}
