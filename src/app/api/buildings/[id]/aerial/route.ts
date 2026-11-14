// GET /api/buildings/[id]/aerial: the building's aerial for the Scout screen
// (SPEC §4). The response says which adapter answered (`mode`), so the UI can
// show whether this is a fixture massing or live imagery.
import { getVexcel } from "@/adapters/vexcel";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const { adapter, mode } = getVexcel();
  try {
    const aerial = await adapter.getAerial(id);
    if (!aerial) {
      return Response.json({ mode, error: `no aerial for building "${id}"` }, { status: 404 });
    }
    return Response.json({ mode, aerial });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ mode, error: message }, { status: 502 });
  }
}
