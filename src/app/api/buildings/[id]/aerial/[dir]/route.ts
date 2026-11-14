// GET /api/buildings/[id]/aerial/[dir]: one view's live image, proxied from
// Vexcel through the server, which holds the key (SPEC §4, §10). The bytes
// come from the adapter's memory; nothing here or downstream may keep them:
// `no-store` keeps the browser and any proxy from caching the image, and the
// Scout draws it with a plain <img>, not next/image, whose optimiser would
// write a copy under .next/cache. A massing has no image, so in fake mode,
// or once a live failure has put Vexcel on fixtures, every view is a 404.
import { getVexcel } from "@/adapters/vexcel";
import { ViewDir } from "@/domain";
import { forcedFromRequest } from "@/lib/mode";

export async function GET(request: Request, context: { params: Promise<{ id: string; dir: string }> }): Promise<Response> {
  const { id, dir: rawDir } = await context.params;
  const dir = ViewDir.safeParse(rawDir);
  if (!dir.success) return Response.json({ error: `no view "${rawDir}"` }, { status: 404 });

  const forced = forcedFromRequest(request).has("vexcel");
  try {
    const image = await getVexcel({ forced }).adapter.getImage(id, dir.data);
    if (!image) return Response.json({ error: `no ${dir.data} image for building "${id}"` }, { status: 404 });
    return new Response(image.bytes, {
      headers: {
        "Content-Type": image.contentType,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error(`GET /api/buildings/${id}/aerial/${dir.data} failed:`, error);
    return Response.json({ error: "The aerial image failed to load." }, { status: 502 });
  }
}
