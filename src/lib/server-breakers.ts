// The server's record of its live data services (CoStar, Vexcel): each one's
// breaker and selected adapter, and the last demo epoch seen. It lives on
// `globalThis`, not in module scope, because a production build loads the
// adapters once per bundle (each route handler, the pages): a module-level
// breaker would trip in `/aerial` and stay closed in the page that renders
// the mode chip, and `demo:reset` would reach only one of them. One record
// per process keeps the chip, every route and the reset in step.
import { Breaker } from "./fallback";

export type ServerService = "costar" | "vexcel";

export interface ServerSlot<S> {
  breaker: Breaker;
  /** The adapter chosen from the environment, once read. */
  selected?: S;
}

interface ServerState {
  slots: Partial<Record<ServerService, ServerSlot<unknown>>>;
  /** The last epoch read from each state directory. */
  epochs: Map<string, string | null>;
}

const KEY = Symbol.for("heist.server-state");

function state(): ServerState {
  const store = globalThis as typeof globalThis & { [KEY]?: ServerState };
  return (store[KEY] ??= { slots: {}, epochs: new Map() });
}

/** The process-wide slot for one service, shared by every bundle. */
export function serverSlot<S>(service: ServerService): ServerSlot<S> {
  const slots = state().slots;
  return (slots[service] ??= { breaker: new Breaker(service) }) as ServerSlot<S>;
}

/** Forgets one service's selection and any failure. */
export function resetServerSlot(service: ServerService): void {
  const slot = serverSlot(service);
  slot.selected = undefined;
  slot.breaker.reset();
}

/** Forgets every service's selection and failure: what a new demo epoch does. */
export function resetServerSlots(): void {
  resetServerSlot("costar");
  resetServerSlot("vexcel");
}

/** The last epoch seen for a state directory (`undefined` before the first read). */
export function lastEpoch(dir: string): string | null | undefined {
  return state().epochs.get(dir);
}

export function rememberEpoch(dir: string, epoch: string | null): void {
  state().epochs.set(dir, epoch);
}
