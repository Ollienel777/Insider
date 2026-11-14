// GET /api/buildings/[id]/aerial: the building's aerial for the Scout screen
// (SPEC §4). The response says which adapter answered (`mode`), so the UI can
// show whether this is a fixture massing or live imagery, and carries
// `fallback` once a live failure has put Vexcel on fixtures.
import { getVexcel } from "@/adapters/vexcel";
import { forcedFromRequest } from "@/lib/mode";

/** What the browser is told when the aerial fails; the cause stays in the server log. */
const AERIAL_FAILED = "The aerial service failed. Try again.";

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
    // A schema error would dump field paths and values; none of that is for the browser.
    console.error(`GET /api/buildings/${JSON.stringify(id)}/aerial failed:`, error);
    return Response.json({ mode: getVexcel({ forced }).mode, error: AERIAL_FAILED }, { status: 502 });
  }
}
