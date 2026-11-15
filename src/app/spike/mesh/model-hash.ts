// The sandbox reads the scan's model id from the part of the address after
// `#` (`/spike/mesh#m=MODEL_ID`). The browser never sends that part to the
// server, so the id stays out of the server's request log (issue 118).
import { MODEL_ID } from "@/lib/scan-mesh/manifest";

export interface ModelChoice {
  /** Null when the address has no usable id. */
  modelId: string | null;
  /** Whether the address named an id at all. */
  given: boolean;
}

/** The model id in a location hash such as `#m=ABC123`. */
export function modelFromHash(hash: string): ModelChoice {
  const m = new URLSearchParams(hash.replace(/^#/, "")).get("m");
  if (m === null) return { modelId: null, given: false };
  return { modelId: MODEL_ID.test(m) ? m : null, given: true };
}

/**
 * For an old-style address with `?m=` in the query: the same address with the
 * id moved after `#`, or null when the query has no id. The first request has
 * already reached the server by then; this keeps reloads and shared links out
 * of the log.
 */
export function movedToHash(search: string, hash: string): string | null {
  const query = new URLSearchParams(search.replace(/^\?/, ""));
  const m = query.get("m");
  if (m === null) return null;
  query.delete("m");
  const fragment = new URLSearchParams(hash.replace(/^#/, ""));
  if (!fragment.has("m")) fragment.set("m", m);
  const rest = query.toString();
  return `${rest ? `?${rest}` : ""}#${fragment.toString()}`;
}
