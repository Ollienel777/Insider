// GET /api/levels/[id]?m=<missionId>: the cached level for the Dossier
// (SPEC §4): the manifest and the trace the Level Builder recorded for this
// building and mission (issue 119). With no `m`, the building's own mission. It
// never runs the builder, so beat 4 never waits on a model.
import { isFixtureBuilding, readCachedLevel } from "@/agents/builder/cache";
import { defaultMissionId } from "@/agents/builder/missions";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const missionId = new URL(request.url).searchParams.get("m") || defaultMissionId(id);
  if (!missionId) {
    return Response.json({ error: `no mission given for building "${id}"; add ?m=<missionId>` }, { status: 404 });
  }
  try {
    const level = await readCachedLevel(id, missionId);
    if (!level) {
      return Response.json(
        {
          error: isFixtureBuilding(id)
            ? `no cached level for building "${id}" and mission "${missionId}"; run npm run build:levels`
            : `no level for building "${id}": only fixture buildings have levels`,
        },
        { status: 404 },
      );
    }
    return Response.json(level);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: `the cached level for "${id}" and "${missionId}" is invalid: ${message}` }, { status: 500 });
  }
}
