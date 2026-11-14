// GET /api/scan-mesh?m=MODEL_ID[&mesh=50k|500k][&faces=low|high|2k|4k]: what
// the free-walk sandbox needs to draw one scan (issue 118). It asks the
// Matterport Model API with the secret key and relays a manifest: a
// short-lived signed link to the mesh, and each panorama's position, rotation
// and six face links; and, where the scan's Matterpak is unlocked, its link
// and length (one byte of it is read here for that, and dropped). The browser fetches the assets itself, straight from the
// scan CDN, so no scan byte passes through this server and nothing is cached
// or written. Links are checked against an allow-list before they are relayed
// (src/lib/scan-mesh/manifest.ts).
//
// Without the key, or in fake mode (the gate and CI), it answers 503 with a
// line the page shows, and calls nothing.
import {
  buildManifest,
  MESH_RESOLUTIONS,
  MODEL_ID,
  PANO_RESOLUTIONS,
  type MeshResolution,
  type PanoResolution,
} from "@/lib/scan-mesh/manifest";
import { archiveLength, fetchScanModel, ModelApiError, modelApiRefusal } from "@/lib/scan-mesh/model-api";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

const MESSAGES = {
  "bad-model-id": "That isn't a model id: 6 to 20 letters and digits.",
  "bad-option": "Unknown mesh or faces option.",
  "fake-mode": "Scans are on fixtures here (fake mode), so there is no mesh to load.",
  "no-key": "The Matterport Model API key isn't set, so there is no scan to load.",
  "no-model": "The Model API has no scan with that id.",
  "api-failed": "The Model API didn't answer. Try again.",
} as const;

function refuse(error: keyof typeof MESSAGES, status: number): Response {
  return Response.json({ error, message: MESSAGES[error] }, { status, headers: NO_STORE });
}

function option<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T | null {
  if (value === null) return fallback;
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const modelId = params.get("m") ?? "";
  if (!MODEL_ID.test(modelId)) return refuse("bad-model-id", 400);
  const mesh = option<MeshResolution>(params.get("mesh"), MESH_RESOLUTIONS, "50k");
  const faces = option<PanoResolution>(params.get("faces"), PANO_RESOLUTIONS, "2k");
  if (!mesh || !faces) return refuse("bad-option", 400);

  const refusal = modelApiRefusal(process.env);
  if (refusal) return refuse(refusal, 503);

  let model: unknown;
  try {
    model = await fetchScanModel(modelId, faces, process.env);
  } catch (error) {
    // The status only: an API error can quote a link or the query.
    console.error("GET /api/scan-mesh:", error instanceof ModelApiError ? error.message : "the Model API failed");
    return refuse("api-failed", 502);
  }
  const manifest = buildManifest(model, { mesh, faces });
  if (!manifest) return refuse("no-model", 404);
  if (manifest.detail) {
    // The page finds the detailed mesh by the archive's length, which only the server can read.
    const bytes = await archiveLength(manifest.detail.url);
    manifest.detail = bytes === null ? null : { ...manifest.detail, bytes };
  }
  return Response.json(manifest, { headers: NO_STORE });
}
