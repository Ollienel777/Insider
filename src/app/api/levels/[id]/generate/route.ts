// POST /api/levels/[id]/generate?m=<missionId>: runs the Level Builder for a
// CoStar kit building and keeps the level in server memory (#93). It answers
// when the build ends: 200 `{ built: true }`, or 502 with what failed. A
// fixture building is refused: its level is built ahead of the demo and
// committed. Nothing is written to disk.
import { buildKitLevel } from "@/agents/builder/build-on-demand";
import { buildsOnDemand, canBuildFor } from "@/agents/builder/live-levels";
import { findBuilding } from "@/lib/building";

export const dynamic = "force-dynamic";
// A live build is a few minutes of model calls at most.
export const maxDuration = 300;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const missionId = new URL(request.url).searchParams.get("m");
  if (!missionId) return Response.json({ error: "no mission given; add ?m=<missionId>" }, { status: 400 });
  const building = await findBuilding(id);
  if (!building) return Response.json({ error: `no building "${id}"` }, { status: 404 });
  if (!buildsOnDemand(building)) {
    return Response.json({ error: `"${id}" is a prepared building; its level is already built` }, { status: 400 });
  }
  if (!canBuildFor(building, missionId)) {
    return Response.json({ error: `mission "${missionId}" is not staged in this building's city` }, { status: 400 });
  }
  try {
    await buildKitLevel(building, missionId);
    return Response.json({ built: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[level] on-demand build of ${id}:${missionId} failed`, error);
    return Response.json({ error: `the Level Builder could not build this level: ${message}` }, { status: 502 });
  }
}
