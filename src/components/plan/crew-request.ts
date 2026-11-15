// The browser's side of POST /api/crew (SPEC §4.5): the body is the building
// id, the order and the mission whose level it is (issue 119), nothing else. The board stays in the browser; the server
// reads the zones and the guard roster from its own cached manifest.
import type { CrewAnswer } from "@/agents/crew/crew";
import { CrewPlan } from "@/domain";
import { noteResponse } from "@/lib/demo-status";
import { fallbackPlan } from "@/level/fallback-plan";
import type { PlacedLevel } from "@/level/placer";

export interface CrewRequest {
  buildingId: string;
  order: string;
  missionId?: string;
}

export type { CrewAnswer };

/** The request body: exactly `{buildingId, order}`, and `missionId` when known. */
export function crewRequest(buildingId: string, order: string, missionId?: string | null): CrewRequest {
  return { buildingId, order: order.trim(), ...(missionId && { missionId }) };
}

/** The demo's order (SPEC §2 beat 4), offered as an example under the order box. */
export const EXAMPLE_ORDER = "Go in through the dock, wait for the 2 am round to pass, take the records room.";

/**
 * The crew had no reply to give: the model didn't answer and the building has no recorded replies
 * (a kit building, issue 140). The Plan screen then works the plan out from the board.
 */
export class NoCrewReplyError extends Error {
  override name = "NoCrewReplyError";
  /** Why the model gave no reply: off ("fake mode", "configuration"), "timeout" or "error". */
  readonly reason?: CrewAnswer["reason"];
  /** The server no longer held the level, so no model was called (issue 142). */
  readonly levelLost: boolean;
  constructor(message: string, reason?: CrewAnswer["reason"], levelLost = false) {
    super(message);
    if (reason) this.reason = reason;
    this.levelLost = levelLost;
  }
}

const REASONS = new Set<string>(["fake mode", "configuration", "timeout", "error"]);

/** Asks the crew; throws with the server's message on a failure (`NoCrewReplyError` when there is no reply to give). */
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
  const body = (await response.json().catch(() => null)) as (Partial<CrewAnswer> & { error?: string; code?: string }) | null;
  // Only the crew route's own "no recording" answer: a 503 from a proxy or the host is an outage, shown as one.
  if (response.status === 503 && body?.code === "no-recording") {
    // A live call that timed out or failed carries the model's fallback: the demo status toasts it, as on a fixture building.
    noteResponse(body);
    const reason = typeof body.reason === "string" && REASONS.has(body.reason) ? body.reason : undefined;
    throw new NoCrewReplyError(body.error ?? "the crew has no reply for this building", reason);
  }
  // The server no longer holds the level (a restart, or another instance: a kit level lives in one
  // server's memory) while this browser still holds the board (issue 142). Only the route's own marked 404.
  if (response.status === 404 && body?.code === "no-level") {
    throw new NoCrewReplyError(body.error ?? "the server has no level for this building", undefined, true);
  }
  if (!response.ok || !body) throw new Error(body?.error ?? `the crew didn't answer (HTTP ${response.status})`);
  noteResponse(body);
  return {
    plan: CrewPlan.parse(body.plan),
    recorded: body.recorded === true,
    ...(body.reason && { reason: body.reason }),
    ...(body.recording && { recording: body.recording }),
  };
}

/**
 * Asks the crew, and when it has no reply to give (no model answer and no recording: a kit
 * building, issue 140) works the plan out from the board instead, marked `source: "board"` with
 * the reason the model gave none. Without a placed board, or on any other failure, it throws.
 */
export async function askCrewOrBoard(
  request: CrewRequest,
  placed: PlacedLevel | null,
  options: { signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<CrewAnswer> {
  try {
    return await askCrew(request, options);
  } catch (error) {
    if (!(error instanceof NoCrewReplyError) || !placed) throw error;
    return {
      plan: fallbackPlan(placed),
      recorded: false,
      source: "board",
      ...(error.reason && { reason: error.reason }),
      ...(error.levelLost && { levelLost: true as const }),
    };
  }
}
