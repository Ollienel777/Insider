// GET /api/cast/[missionId]: the mission's cached shortlist for the Cast
// screen (SPEC §4, beat 2): a CastingResult (funnel, three finalists, source)
// with the trace the Casting Director recorded. It never runs the agent, so
// beat 2 never waits on a model.
//
// With CoStar live (and not forced to fixtures), a shortlist cast live
// (`<HEIST_STATE_DIR>/casting/`) wins over the committed fake one
// (data/casting/); a state dir that cannot be read falls through to it.
// Errors carry fixed messages, never a stack or a schema dump.
//
// With CoStar live and the mission on the showcase list (`SHOWCASE_LEVELS`,
// issue 103), the body also carries `showcase`: the kit building the mission is
// cast onto, with its reasons. Otherwise the body is the shortlist alone.
import { z } from "zod";
import { getCoStar } from "@/adapters/costar";
import { findMission } from "@/agents/builder/missions";
import { CASTING_DIR, CastingReadError, liveCastingDir, readCachedCasting } from "@/agents/casting/cache";
import type { CastingResult } from "@/domain";
import { forcedFromRequest } from "@/lib/mode";
import { showcaseCast } from "@/lib/showcase-cast";

const MissionId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/**
 * The live shortlist, or `null` when there is none or the state dir cannot
 * be read (logged): either way data/casting/ answers next. A file that is
 * there but fails its schema still throws.
 */
async function readLive(missionId: string): Promise<CastingResult | null> {
  try {
    return await readCachedCasting(missionId, [liveCastingDir()]);
  } catch (error) {
    if (!(error instanceof CastingReadError)) throw error;
    console.error(`GET /api/cast/${missionId}: the live shortlist cannot be read (${error.code}); serving data/casting/`);
    return null;
  }
}

export async function GET(request: Request, context: { params: Promise<{ missionId: string }> }): Promise<Response> {
  const parsed = MissionId.safeParse((await context.params).missionId);
  if (!parsed.success) return Response.json({ error: "invalid mission id" }, { status: 400 });
  const missionId = parsed.data;

  const forced = forcedFromRequest(request).has("costar");
  try {
    const result =
      (getCoStar({ forced }).mode === "live" ? await readLive(missionId) : null) ??
      (await readCachedCasting(missionId, [CASTING_DIR]));
    if (!result) {
      return Response.json({ error: "no cached shortlist for this mission; run npm run cast" }, { status: 404 });
    }
    const mission = findMission(missionId);
    const showcase = mission ? await showcaseCast(mission, { forced }) : null;
    return Response.json(showcase ? { ...result, showcase } : result);
  } catch (error) {
    console.error(`GET /api/cast/${missionId}: ${error instanceof Error ? error.message : String(error)}`);
    return Response.json({ error: "the cached shortlist for this mission is invalid" }, { status: 500 });
  }
}
