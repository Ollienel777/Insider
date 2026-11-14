// GET /api/cast/[missionId]: the mission's cached shortlist for the Cast
// screen (SPEC §4, beat 2): a CastingResult (funnel, three finalists, source)
// with the trace the Casting Director recorded. It never runs the agent, so
// beat 2 never waits on a model.
//
// With CoStar live (and not forced to fixtures), a shortlist cast live
// (`<HEIST_STATE_DIR>/casting/`) wins over the committed fake one
// (data/casting/). Errors carry fixed messages, never a stack or a schema dump.
import { z } from "zod";
import { getCoStar } from "@/adapters/costar";
import { CASTING_DIR, liveCastingDir, readCachedCasting } from "@/agents/casting/cache";
import { forcedFromRequest } from "@/lib/mode";

const MissionId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export async function GET(request: Request, context: { params: Promise<{ missionId: string }> }): Promise<Response> {
  const parsed = MissionId.safeParse((await context.params).missionId);
  if (!parsed.success) return Response.json({ error: "invalid mission id" }, { status: 400 });
  const missionId = parsed.data;

  const forced = forcedFromRequest(request).has("costar");
  const dirs = getCoStar({ forced }).mode === "live" ? [liveCastingDir(), CASTING_DIR] : [CASTING_DIR];
  try {
    const result = await readCachedCasting(missionId, dirs);
    if (!result) {
      return Response.json({ error: "no cached shortlist for this mission; run npm run cast" }, { status: 404 });
    }
    return Response.json(result);
  } catch (error) {
    console.error(`GET /api/cast/${missionId}: ${error instanceof Error ? error.message : String(error)}`);
    return Response.json({ error: "the cached shortlist for this mission is invalid" }, { status: 500 });
  }
}
