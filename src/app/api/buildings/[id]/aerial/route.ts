// GET /api/buildings/[id]/aerial: the building's aerial for the Scout screen
// (SPEC §4). The response says which adapter answered (`mode`), so the UI can
// show whether this is a fixture massing or live imagery, and carries
// `fallback` once a live failure has put Vexcel on fixtures.
import { getVexcel } from "@/adapters/vexcel";
import { forcedFromRequest } from "@/lib/mode";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const forced = forcedFromRequest(request).has("vexcel");
  const { adapter } = getVexcel({ forced });
  try {
    const aerial = await adapter.getAerial(id);
    // Read after the call: a live failure during it has switched Vexcel to fixtures.
    const { mode, fallback } = getVexcel({ forced });
    if (!aerial) {
      return Response.json({ mode, error: `no aerial for building "${id}"` }, { status: 404 });
    }
    return Response.json({ mode, aerial, ...(fallback && { fallback }) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ mode: getVexcel({ forced }).mode, error: message }, { status: 502 });
  }
}
