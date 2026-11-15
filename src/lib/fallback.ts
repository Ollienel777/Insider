// A fallback: a service asked to answer live that served fixtures instead
// (SPEC §2: fake mode is the fallback for every beat; DESIGN.md, States).
// Each one carries an id, so the browser shows exactly one toast for it
// however many responses repeat it, and the mode chip switches that service
// to fixtures. Isomorphic: the server and the browser both use it.
import { SERVICES, type Service } from "./mode";

export interface Fallback {
  service: Service;
  /** Unique per fallback event; the browser toasts each id once. */
  id: string;
  /** The toast's one line, naming the service (DESIGN.md, States). */
  message: string;
}

export type FallbackCause = "failed" | "timeout" | "no-scan" | "unknown" | "unplaceable" | "not-started" | "not-started-hidden";

/**
 * A live service answered "no such id" for an id the fixtures know (the demo
 * building, whose cached levels exist only under fixture ids). Thrown inside
 * `withFallback`, it trips the breaker like any failure, so the fixtures
 * answer and the mode chip says so.
 */
export class UnknownToLiveError extends Error {
  constructor(service: Service, id: string) {
    super(`${SERVICES[service].label} has no ${id}, the fixtures do`);
    this.name = "UnknownToLiveError";
  }
}

const WHAT: Record<Service, string> = {
  costar: "buildings use fixtures",
  vexcel: "the aerial is a fixture massing",
  matterport: "the board uses the fixture floor",
  llm: "a recorded reply stands in",
};

/** "CoStar didn't answer, so buildings use fixtures." */
export function fallbackMessage(service: Service, cause: FallbackCause = "failed"): string {
  const label = SERVICES[service].label;
  const name = service === "llm" ? "The model" : label;
  if (cause === "no-scan") return `This building has no ${label} scan, so ${WHAT[service]}.`;
  if (cause === "unplaceable") return `The ${label} scan can't hold this level, so ${WHAT[service]}.`;
  if (cause === "not-started-hidden") {
    return `The ${label} scan's viewer didn't start (the window was hidden), so ${WHAT[service]}. Open it again with the window in front to load the scan.`;
  }
  if (cause === "not-started") return `The ${label} scan's viewer didn't start, so ${WHAT[service]}.`;
  if (cause === "unknown") return `${name} doesn't know this building, so ${WHAT[service]}.`;
  if (cause === "timeout") return `${name} didn't answer in time, so ${WHAT[service]}.`;
  return `${name} didn't answer, so ${WHAT[service]}.`;
}

let sequence = 0;

export function newFallback(service: Service, cause: FallbackCause = "failed"): Fallback {
  sequence += 1;
  return { service, id: `${service}-${Date.now().toString(36)}-${sequence}`, message: fallbackMessage(service, cause) };
}

/** A response body's `fallback`, when it carries a well-formed one. */
export function fallbackOf(body: unknown): Fallback | null {
  const value = (body as { fallback?: Partial<Fallback> } | null)?.fallback;
  if (!value || typeof value.id !== "string" || typeof value.message !== "string") return null;
  if (!value.service || !Object.hasOwn(SERVICES, value.service)) return null;
  return { service: value.service, id: value.id, message: value.message };
}

/**
 * A circuit breaker for one data service. The first live failure trips it,
 * and from then on the service serves fixtures for the rest of the process
 * (or until `npm run demo:reset`), so a dead network costs the demo one
 * timeout, not one per screen.
 */
export class Breaker {
  tripped: Fallback | null = null;
  constructor(readonly service: Service) {}

  trip(error: unknown): Fallback {
    if (!this.tripped) {
      const name = (error as { name?: string } | null)?.name;
      const cause = name === "TimeoutError" ? "timeout" : name === "UnknownToLiveError" ? "unknown" : "failed";
      this.tripped = newFallback(this.service, cause);
      console.warn(`${SERVICES[this.service].label}: fixtures from now on (live call failed: ${(error as Error)?.message ?? String(error)})`);
    }
    return this.tripped;
  }

  reset(): void {
    this.tripped = null;
  }
}

type AsyncMethods<T> = { [K in keyof T]: T[K] extends (...args: infer A) => Promise<infer R> ? (...args: A) => Promise<R> : never };

/**
 * `live` with every method guarded: until the breaker trips each call goes
 * live, and a call that throws trips it and is answered by `fake` instead.
 * Once tripped, every call goes straight to `fake`.
 */
export function withFallback<T extends AsyncMethods<T>>(live: T, fake: T, breaker: Breaker): T {
  const guarded = {} as Record<string, unknown>;
  for (const name of Object.keys(fake) as (keyof T & string)[]) {
    guarded[name] = async (...args: unknown[]) => {
      const call = (impl: T) => (impl[name] as (...a: unknown[]) => Promise<unknown>)(...args);
      if (breaker.tripped) return call(fake);
      try {
        return await call(live);
      } catch (error) {
        breaker.trip(error);
        return call(fake);
      }
    };
  }
  return guarded as T;
}

/**
 * A model answer with its `fallback` added when the recorded reply stood in
 * for a live call that timed out or failed. Each such answer is its own
 * fallback: the model is tried live again on the next call.
 */
export function withLlmFallback<T extends { reason?: string }>(answer: T): T & { fallback?: Fallback } {
  if (answer.reason === "timeout") return { ...answer, fallback: newFallback("llm", "timeout") };
  if (answer.reason === "error") return { ...answer, fallback: newFallback("llm", "failed") };
  return answer;
}
