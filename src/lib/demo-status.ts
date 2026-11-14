// The browser's record of what each service is serving (SPEC §7; DESIGN.md,
// States): the modes the server rendered with, the services forced to
// fixtures in the demo settings, the fallbacks seen since, and their toasts.
// The mode chip, the toasts and the demo settings all read it.
//
// Browser only in practice: the server never calls `report…` or `setForced`,
// so its copy of this module stays empty, and components render from their
// props until `initStatus` has run in the browser.
import { fallbackOf, type Fallback } from "./fallback";
import { FORCE_COOKIE, forcedCookieValue, forcedFromCookieHeader, modeChip, SERVICE_IDS, type ModeChip, type Service, type ServiceModes } from "./mode";

/** What the server rendered the page with (AppShell), handed to the browser. */
export interface ServerStatus {
  configured: ServiceModes;
  forced: Service[];
  fallbacks: Fallback[];
  /** The server's `HEIST_MODE`, which the browser's Matterport adapter cannot read itself. */
  heistMode?: string;
}

export interface DemoStatus {
  /** False until the browser has run `initStatus`. */
  ready: boolean;
  /** What each service serves by configuration (and server-side failures), as the page was rendered. */
  configured: ServiceModes;
  /** Forced to fixtures in the demo settings, for this session. */
  forced: ReadonlySet<Service>;
  /** Fell back to fixtures in this browser since the page loaded. */
  fellBack: ReadonlySet<Service>;
  /** The toasts on screen, oldest first. */
  toasts: readonly Fallback[];
}

const ALL_FAKE: ServiceModes = { llm: "fake", costar: "fake", vexcel: "fake", matterport: "fake" };
const SEEN_KEY = "heist:seen-fallbacks";
/** At most this many toasts at once; the oldest goes first. */
export const MAX_TOASTS = 3;

const EMPTY: DemoStatus = { ready: false, configured: ALL_FAKE, forced: new Set(), fellBack: new Set(), toasts: [] };

let state: DemoStatus = EMPTY;
const listeners = new Set<() => void>();
/** Fallback ids already toasted, so a repeated `fallback` is one toast. */
const seen = new Set<string>();

function set(next: Partial<DemoStatus>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export function subscribeStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getStatus = (): DemoStatus => state;
export const getServerStatus = (): DemoStatus => EMPTY;

/** What each service serves now: forced or fallen back means fixtures, whatever the configuration. */
export function servedModes(status: Pick<DemoStatus, "configured" | "forced" | "fellBack">): ServiceModes {
  const modes = { ...status.configured };
  for (const service of SERVICE_IDS) {
    if (status.forced.has(service) || status.fellBack.has(service)) modes[service] = "fake";
  }
  return modes;
}

export function statusChip(status: Pick<DemoStatus, "configured" | "forced" | "fellBack">): ModeChip {
  return modeChip(servedModes(status));
}

function readSeen(): void {
  try {
    const raw = sessionStorage.getItem(SEEN_KEY);
    for (const id of raw ? (JSON.parse(raw) as string[]) : []) seen.add(id);
  } catch {
    // No storage (private mode, tests): toasts dedupe for this page only.
  }
}

function writeSeen(): void {
  try {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-50)));
  } catch {
    // As above.
  }
}

/**
 * The services forced to fixtures as this browser's cookie says now, or null
 * where there is no `document` (the server, unit tests).
 */
function cookieForced(): Set<Service> | null {
  if (typeof document === "undefined") return null;
  return forcedFromCookieHeader(document.cookie);
}

/**
 * Takes the server's view of the page: the configured modes (with any
 * server-side failure applied), and the fallbacks the server has hit. The
 * forced services come from this browser's own cookie, not the server's
 * copy: the server rendered with the cookie as it was sent, and the epoch
 * script of `demo:reset` may have expired it since. Fallbacks already seen
 * on this page stand: the server may have rendered the shell before a later
 * part of the same page failed over.
 */
export function initStatus(server: { configured: ServiceModes; forced: Iterable<Service>; fallbacks?: readonly Fallback[] }): void {
  if (!state.ready) readSeen();
  set({ ready: true, configured: server.configured, forced: cookieForced() ?? new Set(server.forced) });
  for (const fallback of server.fallbacks ?? []) reportFallback(fallback);
}

/** A service fell back to fixtures: the chip switches it, and the fallback is toasted once. */
export function reportFallback(fallback: Fallback): void {
  const fellBack = new Set(state.fellBack).add(fallback.service);
  if (seen.has(fallback.id)) {
    if (!state.fellBack.has(fallback.service)) set({ fellBack });
    return;
  }
  seen.add(fallback.id);
  writeSeen();
  set({ fellBack, toasts: [...state.toasts, fallback].slice(-MAX_TOASTS) });
}

/** A service answered live again (the model, per call): the chip follows. */
export function reportLive(service: Service): void {
  if (!state.fellBack.has(service)) return;
  const fellBack = new Set(state.fellBack);
  fellBack.delete(service);
  set({ fellBack });
}

/**
 * Reads a response body from one of the app's routes: a `fallback` is
 * reported; a model answer that was not recorded means the model is live.
 */
export function noteResponse(body: unknown): void {
  const fallback = fallbackOf(body);
  if (fallback) return reportFallback(fallback);
  if ((body as { recorded?: unknown } | null)?.recorded === false) reportLive("llm");
}

export function dismissToast(id: string): void {
  set({ toasts: state.toasts.filter((t) => t.id !== id) });
}

function writeForceCookie(value: string): void {
  // A session cookie: it lasts until the browser closes, or `demo:reset`.
  document.cookie = value
    ? `${FORCE_COOKIE}=${value}; path=/; SameSite=Lax`
    : `${FORCE_COOKIE}=; path=/; Max-Age=0; SameSite=Lax`;
}

/**
 * Forces a service to fixtures, or lets it go back to its configuration, for
 * this session. The chip switches now; the cookie makes the server's next
 * answer for it come from the fake.
 */
export function setForced(service: Service, on: boolean, writeCookie: (value: string) => void = writeForceCookie): void {
  const forced = new Set(state.forced);
  if (on) forced.add(service);
  else forced.delete(service);
  writeCookie(forcedCookieValue(forced));
  set({ forced });
}

/**
 * Forced to fixtures? Before `initStatus` has run (on a full page load a
 * screen's effect can run before `DemoSafety`'s), the cookie answers.
 */
export function isForced(service: Service): boolean {
  if (state.ready) return state.forced.has(service);
  return cookieForced()?.has(service) ?? false;
}

/** Back to the empty state. Tests only. */
export function resetStatus(): void {
  seen.clear();
  state = EMPTY;
}
