// GET /api/buildings/[id]/aerial: the building's aerial for the Scout screen
// (SPEC §4). The response says which adapter answered (`mode`), so the UI can
// show whether this is a fixture massing or live imagery, and carries
// `fallback` once a live failure has put Vexcel on fixtures, or when Vexcel is
// live but this building is served as its massing (no coverage).
import { getVexcel, hasFixtureMassing, noCoverageFallback } from "@/adapters/vexcel";
import { forcedFromRequest } from "@/lib/mode";

/** What the browser is told when the aerial fails; the cause stays in the server log. */
const AERIAL_FAILED = "The aerial service failed. Try again.";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const forcedServices = forcedFromRequest(request);
  const forced = forcedServices.has("vexcel");
  const { adapter } = getVexcel({ forced });
  try {
    // CoStar forced to fixtures: no kit record to aim from, so a kit building has no aerial.
    if (forcedServices.has("costar") && !(await hasFixtureMassing(id))) {
      return Response.json({ mode: getVexcel({ forced }).mode, error: `no aerial for building "${id}"` }, { status: 404 });
    }
    const aerial = await adapter.getAerial(id);
    // Read after the call: a live failure during it has switched Vexcel to fixtures.
    const { mode, fallback } = getVexcel({ forced });
    if (!aerial) {
      return Response.json({ mode, error: `no aerial for building "${id}"` }, { status: 404 });
    }
    // Live, but this building came back as its massing: the chip must not say live over it.
    const served = fallback ?? (mode === "live" && aerial.source !== "vexcel" ? noCoverageFallback(id) : undefined);
    return Response.json({ mode, aerial, ...(served && { fallback: served }) });
  } catch (error) {
    // A schema error would dump field paths and values; none of that is for the browser.
    console.error(`GET /api/buildings/${JSON.stringify(id)}/aerial failed:`, error);
    return Response.json({ mode: getVexcel({ forced }).mode, error: AERIAL_FAILED }, { status: 502 });
  }
}
