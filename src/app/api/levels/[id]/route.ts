// GET /api/levels/[id]: the cached level for the Dossier (SPEC §4): the
// manifest and the trace the Level Builder recorded. It never runs the
// builder, so beat 3 never waits on a model.
import { readCachedLevel } from "@/agents/builder/cache";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  try {
    const level = await readCachedLevel(id);
    if (!level) {
      return Response.json({ error: `no cached level for building "${id}"; run npm run build:levels` }, { status: 404 });
    }
    return Response.json(level);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: `the cached level for "${id}" is invalid: ${message}` }, { status: 500 });
  }
}
