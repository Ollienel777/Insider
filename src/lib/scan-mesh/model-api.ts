// The one call to the Matterport Model API (issue 118), server side only: it
// holds the secret key. It asks for metadata and signed links, never for an
// asset, caches nothing and writes nothing. Errors carry a status and a fixed
// line; the key, the token and the links never reach a log or a message.
import { serviceModes } from "@/lib/mode";
import { faceResolutions, MANIFEST_QUERY, type PanoResolution } from "./manifest";

export const MODEL_API_URL = "https://api.matterport.com/api/models/graph";

type Env = Record<string, string | undefined>;

export type ModelApiRefusal = "fake-mode" | "no-key";

/** Why the Model API can't be asked from this environment, or null when it can. */
export function modelApiRefusal(env: Env): ModelApiRefusal | null {
  if (serviceModes(env).matterport !== "live") return "fake-mode";
  if (!env.MATTERPORT_API_KEY || !env.MATTERPORT_API_TOKEN) return "no-key";
  return null;
}

export class ModelApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "ModelApiError";
  }
}

/**
 * The length of the archive at `url` (a link the API just gave out), from a
 * one-byte range request whose body is the archive's first byte, read and
 * dropped: the page can't read the length itself. Null on any failure.
 */
export async function archiveLength(url: string, fetchImpl: typeof fetch = fetch, timeoutMs = 8000): Promise<number | null> {
  try {
    const response = await fetchImpl(url, {
      headers: { Range: "bytes=0-0" },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    // A server that ignores the range answers 200 with the whole archive: drop the body unread.
    if (response.status !== 206) {
      await response.body?.cancel();
      return null;
    }
    await response.arrayBuffer();
    const total = Number(response.headers.get("content-range")?.split("/")[1]);
    return Number.isSafeInteger(total) && total > 0 ? total : null;
  } catch {
    return null;
  }
}

/**
 * The API's `data.model` for one scan (null when it has no such model).
 * Throws `ModelApiError` on any failure.
 */
export async function fetchScanModel(
  modelId: string,
  faces: PanoResolution,
  env: Env,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 20_000,
): Promise<unknown> {
  const basic = Buffer.from(`${env.MATTERPORT_API_KEY}:${env.MATTERPORT_API_TOKEN}`).toString("base64");
  let response: Response;
  try {
    response = await fetchImpl(MODEL_API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Basic ${basic}` },
      body: JSON.stringify({ query: MANIFEST_QUERY, variables: { id: modelId, faces: faceResolutions(faces) } }),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    throw new ModelApiError(`the Model API did not answer (${name})`, null);
  }
  if (!response.ok) throw new ModelApiError(`the Model API answered ${response.status}`, response.status);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ModelApiError("the Model API's answer was not JSON", response.status);
  }
  const data = (body as { data?: { model?: unknown } } | null)?.data;
  if (data === undefined || data === null) {
    // GraphQL errors can quote the query's arguments; keep only how many there were.
    const errors = (body as { errors?: unknown[] } | null)?.errors;
    throw new ModelApiError(
      `the Model API returned no data (${Array.isArray(errors) ? errors.length : 0} errors)`,
      response.status,
    );
  }
  return data.model ?? null;
}
