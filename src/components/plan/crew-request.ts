// The browser's side of POST /api/crew (SPEC §4.5): the body is the building
// id and the order, nothing else. The board stays in the browser; the server
// reads the zones and the guard roster from its own cached manifest.
import type { CrewAnswer } from "@/agents/crew/crew";
import { CrewPlan } from "@/domain";

export interface CrewRequest {
  buildingId: string;
  order: string;
}

export type { CrewAnswer };

/** The request body: exactly `{buildingId, order}`. */
export function crewRequest(buildingId: string, order: string): CrewRequest {
  return { buildingId, order: order.trim() };
}

/** The demo's order (SPEC §2 beat 4), offered as an example under the order box. */
export const EXAMPLE_ORDER = "Go in through the dock, wait for the 2 am round to pass, take the records room.";

/** Asks the crew; throws with the server's message on a failure. */
export async function askCrew(
  request: CrewRequest,
  options: { signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<CrewAnswer> {
  const doFetch = options.fetch ?? fetch;
  const response = await doFetch("/api/crew", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal: options.signal,
  });
  const body = (await response.json().catch(() => null)) as (Partial<CrewAnswer> & { error?: string }) | null;
  if (!response.ok || !body) throw new Error(body?.error ?? `the crew didn't answer (HTTP ${response.status})`);
  return {
    plan: CrewPlan.parse(body.plan),
    recorded: body.recorded === true,
    ...(body.reason && { reason: body.reason }),
    ...(body.recording && { recording: body.recording }),
  };
}
