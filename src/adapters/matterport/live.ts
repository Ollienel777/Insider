// The live Matterport adapter: connects to a model through the Showcase SDK,
// reads `Sweep.data` and `Room.data` once, and hands them to mapping.ts. What
// it assumes about the SDK lives in mapping.ts.
//
// Checked against a real model on localhost (SDK 26.11): a Showcase player
// smaller than a few pixels never reaches its playing phase, so it never sends
// a sweep, and one placed off screen is throttled by the browser and often
// stalls the same way. The hidden player below is a full-size frame inside
// the viewport, transparent and behind the page. Its unit tests run it on a
// stubbed SDK connection.
//
// Terms (SPEC §4.5): every call connects afresh and builds the graph again;
// nothing is cached, stored or sent anywhere. The graph exists only in the
// caller's memory.
import { SHOWCASE, toFloorGraph, type ObservableCollection, type ShowcaseSdk } from "./mapping";
import type { MatterportAdapter } from "./types";

/** A connected SDK, and how to let it go. */
export interface ShowcaseSession {
  sdk: ShowcaseSdk;
  disconnect(): void;
}

/**
 * Opens a Showcase SDK session on one model. `signal` aborts when the caller
 * stops waiting: the connection then takes its player out of the page.
 */
export type ShowcaseConnect = (modelId: string, sdkKey: string, signal?: AbortSignal) => Promise<ShowcaseSession>;

export interface LiveMatterportConfig {
  sdkKey?: string;
  /** Injected in tests; defaults to a hidden Showcase iframe. */
  connect?: ShowcaseConnect;
  /** How long the sweeps may take to arrive once connected. */
  timeoutMs?: number;
  /**
   * How long the connection itself may take (the SDK script, the player and
   * the handshake). Without it a player that never loads holds the board on
   * its skeleton for good; with it the fixture floor takes over.
   */
  connectTimeoutMs?: number;
}

/** A Showcase step that took too long. Named `TimeoutError`, so the fallback says "didn't answer in time". */
export class MatterportTimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`Matterport: ${what} did not arrive within ${ms} ms`);
    this.name = "TimeoutError";
  }
}

/**
 * `start`, bounded by `ms`. At the deadline the signal aborts, so the starter
 * can tidy up after itself, and the promise rejects with a `TimeoutError`.
 * A result that arrives after the deadline is handed to `release`.
 */
export function within<T>(
  start: (signal: AbortSignal) => Promise<T>,
  what: string,
  ms: number,
  release: (late: T) => void,
  outer?: AbortSignal,
): Promise<T> {
  const abort = new AbortController();
  return new Promise((resolve, reject) => {
    let late = false;
    let settled = false;
    const onOuter = () => giveUp(new Error(`Matterport: ${what} was given up on`));
    const finish = () => {
      settled = true;
      clearTimeout(timer);
      outer?.removeEventListener("abort", onOuter);
    };
    const giveUp = (error: Error) => {
      if (late || settled) return;
      late = true;
      finish();
      abort.abort();
      reject(error);
    };
    const timer = setTimeout(() => giveUp(new MatterportTimeoutError(what, ms)), ms);
    // The caller stopped waiting (the panel closed): give up now, as at the deadline. Once the
    // start has settled, an abort no longer reaches it: what it opened is the caller's to close.
    if (outer?.aborted) onOuter();
    else outer?.addEventListener("abort", onOuter, { once: true });
    start(abort.signal).then(
      (value) => {
        if (late) return release(value);
        finish();
        resolve(value);
      },
      (error: unknown) => {
        if (late) return;
        finish();
        reject(error);
      },
    );
  });
}

/**
 * `connect`, bounded by `ms`. A session that opens after the deadline is
 * disconnected at once, so a late player does not linger in the page.
 */
export function connectWithin(connect: ShowcaseConnect, modelId: string, sdkKey: string, ms: number): Promise<ShowcaseSession> {
  return within((signal) => connect(modelId, sdkKey, signal), "the Showcase connection", ms, (session) => session.disconnect());
}

export class MatterportNotConfiguredError extends Error {
  constructor() {
    super("Matterport live adapter not configured: NEXT_PUBLIC_MATTERPORT_SDK_KEY missing");
    this.name = "MatterportNotConfiguredError";
  }
}

/** How long the rooms may trail the sweeps: a model with no rooms sends none. */
const ROOM_GRACE_MS = 2_000;

/**
 * The first non-empty snapshot of the sweeps, with the rooms as they stand
 * then (or up to `ROOM_GRACE_MS` later). The player can call back with an
 * empty collection before it is playing, so an empty sweep list is not an
 * answer; an empty room list can be.
 */
function snapshots(
  sweepData: ObservableCollection<unknown>,
  roomData: ObservableCollection<unknown>,
  timeoutMs: number,
): Promise<[Record<string, unknown>, Record<string, unknown>]> {
  return new Promise((resolve, reject) => {
    let sweeps: Record<string, unknown> | null = null;
    let rooms: Record<string, unknown> = {};
    let done = false;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const subscriptions: { cancel(): void }[] = [];
    const finish = () => {
      if (done || !sweeps) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(grace);
      // The SDK may call back before `subscribe` returns.
      queueMicrotask(() => subscriptions.forEach((s) => s.cancel()));
      resolve([sweeps, rooms]);
    };
    const timer = setTimeout(() => {
      done = true;
      clearTimeout(grace);
      subscriptions.forEach((s) => s.cancel());
      reject(new MatterportTimeoutError("Sweep.data", timeoutMs));
    }, timeoutMs);
    subscriptions.push(
      roomData.subscribe({
        onCollectionUpdated(items) {
          if (done) return;
          rooms = { ...items };
          if (sweeps && Object.keys(rooms).length > 0) finish();
        },
      }),
      sweepData.subscribe({
        onCollectionUpdated(items) {
          if (done || Object.keys(items).length === 0) return;
          sweeps = { ...items };
          if (Object.keys(rooms).length > 0) finish();
          else grace ??= setTimeout(finish, ROOM_GRACE_MS);
        },
      }),
    );
  });
}

export function createLiveMatterport(config: LiveMatterportConfig): MatterportAdapter {
  const { sdkKey } = config;
  if (!sdkKey) throw new MatterportNotConfiguredError();
  const connect = config.connect ?? connectShowcase;
  const timeoutMs = config.timeoutMs ?? 15_000;
  const connectTimeoutMs = config.connectTimeoutMs ?? 20_000;

  async function load(modelId: string) {
    const session = await connectWithin(connect, modelId, sdkKey!, connectTimeoutMs);
    try {
      const [sweeps, rooms] = await snapshots(session.sdk.Sweep.data, session.sdk.Room.data, timeoutMs);
      return toFloorGraph(sweeps, rooms);
    } finally {
      session.disconnect();
    }
  }

  // One hidden player at a time: two players of one model opened together
  // (a screen that mounts twice, a quick Retry) stalled each other on SDK
  // 26.11, so a load waits for the one before it to settle.
  let queue: Promise<unknown> = Promise.resolve();
  return {
    loadFloor(building) {
      const modelId = building.matterportModelId;
      if (!modelId) return Promise.resolve(null);
      const next = queue.then(() => load(modelId));
      queue = next.catch(() => {});
      return next;
    },
  };
}

// ---- the default connection: a hidden Showcase iframe (browser only) --------

interface MpSdkGlobal {
  connect(target: HTMLIFrameElement, sdkKey: string, version: string): Promise<ShowcaseSdk & InsideSdk>;
}

let sdkScript: Promise<void> | undefined;

function loadSdkScript(): Promise<void> {
  sdkScript ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SHOWCASE.sdkScript;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      sdkScript = undefined;
      reject(new Error("Matterport: the Showcase SDK script did not load"));
    };
    document.head.appendChild(script);
  });
  return sdkScript;
}

/**
 * Puts a Showcase player for `modelId` into `parent` and connects the SDK to
 * it once both the player and the SDK script have loaded. The listener is set
 * before the iframe joins the page, so a fast load is not missed. When
 * `signal` aborts, the player leaves the page and the call rejects.
 */
async function mountPlayer(
  parent: HTMLElement,
  iframe: HTMLIFrameElement,
  modelId: string,
  sdkKey: string,
  signal?: AbortSignal,
): Promise<ShowcaseSdk & InsideSdk> {
  const aborted = new Promise<never>((_, reject) => {
    signal?.addEventListener(
      "abort",
      () => {
        iframe.remove();
        reject(new Error("Matterport: the player was given up on"));
      },
      { once: true },
    );
  });
  aborted.catch(() => {});
  const loaded = new Promise<void>((resolve) => iframe.addEventListener("load", () => resolve(), { once: true }));
  iframe.src = SHOWCASE.embedUrl(modelId, sdkKey);
  iframe.allow = "xr-spatial-tracking";
  parent.appendChild(iframe);
  await Promise.race([Promise.all([loadSdkScript(), loaded]), aborted]);
  const mp = (window as unknown as { MP_SDK?: MpSdkGlobal }).MP_SDK;
  if (!mp) throw new Error("Matterport: MP_SDK missing after the SDK script loaded");
  return Promise.race([mp.connect(iframe, sdkKey, SHOWCASE.sdkVersion), aborted]);
}

/**
 * Loads the model in a hidden iframe and connects the SDK to it. The frame is
 * full size and in the viewport, but transparent, behind the page and
 * unclickable: a tiny or off-screen player stalls before it plays (see the
 * header), and only a playing player sends its sweeps.
 */
export const connectShowcase: ShowcaseConnect = async (modelId, sdkKey, signal) => {
  if (typeof document === "undefined") {
    throw new Error("Matterport: the Showcase SDK runs only in the browser");
  }
  const iframe = document.createElement("iframe");
  iframe.title = "Matterport model (hidden)";
  iframe.setAttribute("aria-hidden", "true");
  iframe.tabIndex = -1;
  Object.assign(iframe.style, {
    position: "fixed",
    width: "640px",
    height: "360px",
    left: "0",
    top: "0",
    border: "0",
    opacity: "0",
    zIndex: "-1",
    pointerEvents: "none",
  });
  try {
    const sdk = await mountPlayer(document.body, iframe, modelId, sdkKey, signal);
    return {
      sdk,
      disconnect() {
        sdk.disconnect?.();
        iframe.remove();
      },
    };
  } catch (error) {
    iframe.remove();
    throw error;
  }
};

// ---- the Inside view: a visible player that follows the player's sweep -------

/** The part of the SDK the Inside view drives. */
export interface InsideSdk {
  Sweep: { moveTo(sweepId: string, options?: { transition?: string; transitionTime?: number }): Promise<unknown> };
  disconnect?: () => void;
}

/** A connected Inside view: move it to a sweep, and let it go. */
export interface InsideView {
  /**
   * Sends the view to `sweepId`. Moves never overlap: one made while another
   * is in flight is held, and only the latest held target is flown to once
   * the flight settles. A move the player refuses is ignored: the board, not
   * the view, is the game.
   */
  moveTo(sweepId: string): Promise<void>;
  disconnect(): void;
}

/** Opens the Inside view's player in `parent`; injected in tests. */
export type InsideConnect = (parent: HTMLElement, modelId: string, sdkKey: string, signal?: AbortSignal) => Promise<InsideSdk>;

/** `Sweep.Transition.FLY` in the SDK (checked on SDK 26.11, where `Camera.TransitionType.FLY` has the same value). */
export const FLY = "transition.fly";

/** What the player says when a move is refused because another transition is still running (SDK 26.11). */
const TRANSITION_ACTIVE = /transition.*(active|in progress)/i;
const BUSY_RETRIES = 5;
const BUSY_WAIT_MS = 400;

const FLY_MS = 600;
/** A move that has not settled by now counts as refused, so a lost flight cannot freeze the view. */
const MOVE_MS = FLY_MS + 5_000;

/** `promise`, or a rejection once `ms` pass without it settling. */
function settleWithin<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`the move did not settle within ${ms} ms`)), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** How long the Inside view's player may take to connect before the panel says it failed. */
export const INSIDE_CONNECT_MS = 20_000;

const connectVisiblePlayer: InsideConnect = async (parent, modelId, sdkKey, signal) => {
  const iframe = document.createElement("iframe");
  iframe.title = "Inside view: the scan at the player's spot";
  // Out of the tab order, so the board keeps the number keys.
  iframe.tabIndex = -1;
  Object.assign(iframe.style, { width: "100%", height: "100%", border: "0", display: "block" });
  try {
    const sdk = await mountPlayer(parent, iframe, modelId, sdkKey, signal);
    return {
      Sweep: sdk.Sweep,
      disconnect() {
        sdk.disconnect?.();
        iframe.remove();
      },
    };
  } catch (error) {
    iframe.remove();
    throw error;
  }
};

/**
 * The Inside view: a visible Showcase player in `parent`, connected to the
 * SDK within `connectMs` (a player that connects later is let go). It only
 * moves the camera; it reads nothing, and nothing leaves the page (SPEC §4.5).
 * Sweep ids are the board's node ids: in the SDK a sweep's `id` and `sid` are
 * the same string.
 */
export async function connectInsideView(
  parent: HTMLElement,
  modelId: string,
  sdkKey: string,
  connect: InsideConnect = connectVisiblePlayer,
  connectMs: number = INSIDE_CONNECT_MS,
  signal?: AbortSignal,
): Promise<InsideView> {
  const sdk = await within(
    (inner) => connect(parent, modelId, sdkKey, inner),
    "the Inside view's player",
    connectMs,
    (late) => late.disconnect?.(),
    signal,
  );
  let flying: Promise<void> | null = null;
  let target: string | null = null;
  let at: string | null = null;
  let gone = false;
  let busy = 0;

  async function fly(): Promise<void> {
    // Yield first, so `flying` is set before this can finish and clear it.
    await Promise.resolve();
    try {
      while (!gone && target !== null && target !== at) {
        const sweepId = target;
        try {
          await settleWithin(sdk.Sweep.moveTo(sweepId, { transition: FLY, transitionTime: FLY_MS }), MOVE_MS);
          at = sweepId;
          busy = 0;
        } catch (error) {
          // The player refuses a move while it is still flying (its own opening
          // flight included): wait for that to end and try again, a few times.
          if (TRANSITION_ACTIVE.test(String((error as Error)?.message ?? error)) && busy < BUSY_RETRIES) {
            busy += 1;
            await new Promise((resolve) => setTimeout(resolve, BUSY_WAIT_MS));
            continue;
          }
          busy = 0;
          console.warn(`Matterport: the Inside view did not move (${(error as Error)?.message ?? String(error)})`);
          // Not there; a newer target is still tried, the refused one is not retried.
          if (target === sweepId) return;
        }
      }
    } finally {
      // No await between the loop's last check and here, so a move made now starts a new flight.
      flying = null;
    }
  }

  return {
    moveTo(sweepId) {
      target = sweepId;
      flying ??= fly();
      return flying;
    },
    disconnect() {
      gone = true;
      sdk.disconnect?.();
    },
  };
}
