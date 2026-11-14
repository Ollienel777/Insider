// POST /api/levels/[id]/generate?m=<missionId>: runs the Level Builder for a
// CoStar kit building and keeps the level in server memory (#93). It answers
// when the build ends: 200 `{ built: true }`, or 502 with a fixed line saying
// what kind of failure it was (the raw error goes to the server log only). A
// fixture building is refused: its level is built ahead of the demo and
// committed. Nothing is written to disk.
//
// A build is a live model run. It is refused (409) while the model is on
// fixtures, configured or forced in the demo settings, and refused (429, with
// Retry-After) when too many are running or this level failed moments ago.
import { BuildRefused, buildKitLevel, publicBuildError } from "@/agents/builder/build-on-demand";
import { buildsOnDemand, canBuildFor } from "@/agents/builder/live-levels";
import { getCoStar } from "@/adapters/costar";
import { configuredModes, forcedFromRequest } from "@/lib/mode";

export const dynamic = "force-dynamic";
// A live build is about 2.5 minutes of model calls; the build stops itself at 4.
export const maxDuration = 300;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const missionId = new URL(request.url).searchParams.get("m");
  if (!missionId) return Response.json({ error: "no mission given; add ?m=<missionId>" }, { status: 400 });
  const forced = forcedFromRequest(request);
  const building = await getCoStar({ forced: forced.has("costar") }).adapter.getBuilding(id);
  if (!building) return Response.json({ error: `no building "${id}"` }, { status: 404 });
  if (!buildsOnDemand(building)) {
    return Response.json({ error: `"${id}" is a prepared building; its level is already built` }, { status: 400 });
  }
  if (!canBuildFor(building, missionId)) {
    return Response.json({ error: `mission "${missionId}" is not staged in this building's city` }, { status: 400 });
  }
  if (forced.has("llm")) {
    return Response.json({ error: "the model is forced to fixtures in the demo settings, so the Level Builder can't run" }, { status: 409 });
  }
  if (configuredModes(process.env).llm !== "live") {
    return Response.json({ error: "the model is on fixtures on this server, so the Level Builder can't run" }, { status: 409 });
  }
  try {
    await buildKitLevel(building, missionId);
    return Response.json({ built: true });
  } catch (error) {
    if (error instanceof BuildRefused) {
      return Response.json({ error: error.message }, { status: 429, headers: { "Retry-After": String(error.retryAfterS) } });
    }
    // buildKitLevel has logged the raw error.
    return Response.json({ error: publicBuildError(error) }, { status: 502 });
  }
}
