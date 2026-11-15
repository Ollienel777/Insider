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
//
// The Inside view (the last part of this file) is a visible player. It can
// report the camera's pose and the scan's floor points to its caller, under
// the same terms: read only when asked for, held in the page's memory, never
// stored or sent.
import { z } from "zod";
import { SHOWCASE, toFloorGraph, type ObservableCollection, type ShowcaseSdk, type Subscription } from "./mapping";
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
 * The scan's player never started: a hidden load's deadline ran out with the
 * player short of its playing phase, or after the page had been hidden. A
 * browser throttles a background tab, and its player stalls (issue 156).
 * Named `NotStartedError`, so the fallback says the viewer didn't start
 * rather than blaming the scan. `hidden` says the page was hidden during the load.
 */
export class MatterportNotStartedError extends Error {
  constructor(readonly hidden: boolean) {
    super(`Matterport: the scan's player did not start${hidden ? " (the page was hidden)" : ""}`);
    this.name = "NotStartedError";
  }
}

/**
 * The caller stopped waiting for the scan's floor (it left the screen, or
 * took the stand-in floor plan): the load stops where it is. Not a failure of
 * the scan or the connection, so nothing falls back or toasts for it.
 */
export class MatterportAbandonedError extends Error {
  constructor() {
    super("Matterport: the scan's load was given up on");
    this.name = "AbortError";
  }
}

/** Whether the page is showing. With no document (the server, unit tests on node) it counts as showing. */
function pageVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

/**
 * `setTimeout(callback, ms)`, counting only time the page is visible: hidden,
 * the clock stops, and visible again, it goes on from where it stopped. A
 * hidden tab's player is throttled until it stalls, so a deadline that ran
 * on while the tab was hidden would blame the scan for the window (issue
 * 156). Returns the cancel.
 */
export function visibleTimeout(callback: () => void, ms: number): () => void {
  if (typeof document === "undefined") {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
  }
  let left = ms;
  let since = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    since = Date.now();
    timer = setTimeout(() => {
      cancel();
      callback();
    }, left);
  };
  const onChange = () => {
    if (pageVisible()) {
      if (timer === undefined) run();
    } else if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
      left = Math.max(0, left - (Date.now() - since));
    }
  };
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    document.removeEventListener("visibilitychange", onChange);
  };
  document.addEventListener("visibilitychange", onChange);
  if (pageVisible()) run();
  return cancel;
}

/** Whether the page is hidden at any point from now until `stop`. */
function watchHidden(): { hidden(): boolean; stop(): void } {
  if (typeof document === "undefined") return { hidden: () => false, stop() {} };
  let hidden = !pageVisible();
  const onChange = () => {
    if (!pageVisible()) hidden = true;
  };
  document.addEventListener("visibilitychange", onChange);
  return { hidden: () => hidden, stop: () => document.removeEventListener("visibilitychange", onChange) };
}

/**
 * Whether the hidden player has reached its playing phase: undefined when
 * the SDK gives no phase to read (a stubbed connection).
 */
function watchPlaying(sdk: ShowcaseSdk): { playing(): boolean | undefined; stop(): void } {
  const app = (sdk as ShowcaseSdk & Partial<Pick<InsideSdk, "App">>).App;
  if (!app) return { playing: () => undefined, stop() {} };
  let playing = false;
  let subscription: Subscription;
  try {
    subscription = app.state.subscribe((state) => {
      if (state?.phase === PLAYING) playing = true;
    });
  } catch {
    return { playing: () => undefined, stop() {} };
  }
  return { playing: () => playing, stop: () => subscription.cancel() };
}

/**
 * `start`, bounded by `ms` of visible time (`visibleTimeout`). At the deadline
 * the signal aborts, so the starter can tidy up after itself, and the promise
 * rejects with a `TimeoutError`. A result that arrives after the deadline is
 * handed to `release`.
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
      stopClock();
      outer?.removeEventListener("abort", onOuter);
    };
    const giveUp = (error: Error) => {
      if (late || settled) return;
      late = true;
      finish();
      abort.abort();
      reject(error);
    };
    const stopClock = visibleTimeout(() => giveUp(new MatterportTimeoutError(what, ms)), ms);
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
export function connectWithin(
  connect: ShowcaseConnect,
  modelId: string,
  sdkKey: string,
  ms: number,
  outer?: AbortSignal,
): Promise<ShowcaseSession> {
  return within((signal) => connect(modelId, sdkKey, signal), "the Showcase connection", ms, (session) => session.disconnect(), outer);
}

function isTimeout(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === "TimeoutError";
}

export class MatterportNotConfiguredError extends Error {
  constructor() {
    super("Matterport live adapter not configured: NEXT_PUBLIC_MATTERPORT_SDK_KEY missing");
    this.name = "MatterportNotConfiguredError";
  }
}

/**
 * How long the rooms may trail the sweeps. Measured on localhost (SDK 26.11,
 * issue 141): they came 0 to 6 s after the sweeps on a fast connection, and
 * about 20 s after at 2 Mbit/s with nothing cached, where the connection
 * itself took 14 s of its 20: a link too slow for this wait misses that
 * deadline first. The wait ends when the rooms arrive, so only a model that
 * sends none waits it out, and its board is one room either way.
 */
export const ROOMS_WAIT_MS = 30_000;

/**
 * The sweeps and the rooms, once both are in: the latest non-empty copy of
 * each. The player can call back with an empty collection before it is
 * playing, so an empty sweep list is not an answer, and the sweeps have
 * `timeoutMs` to arrive. The rooms then have `ROOMS_WAIT_MS`. Running out of
 * that is not a failure: the answer then has no rooms, as for a model that
 * has none, and says the wait ran out. Both waits count visible time only
 * (`visibleTimeout`). When `signal` aborts first, both waits stop and the
 * call rejects with a `MatterportAbandonedError`.
 */
function snapshots(
  sweepData: ObservableCollection<unknown>,
  roomData: ObservableCollection<unknown>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ sweeps: Record<string, unknown>; rooms: Record<string, unknown>; roomsRanOut: boolean }> {
  return new Promise((resolve, reject) => {
    let sweeps: Record<string, unknown> | null = null;
    let rooms: Record<string, unknown> = {};
    let done = false;
    let stopRoomsWait: (() => void) | undefined;
    const subscriptions: { cancel(): void }[] = [];
    const onAbort = () => {
      if (done) return;
      done = true;
      stopSweepsDeadline();
      stopRoomsWait?.();
      queueMicrotask(() => subscriptions.forEach((s) => s.cancel()));
      reject(new MatterportAbandonedError());
    };
    const finish = (roomsRanOut = false) => {
      if (done || !sweeps) return;
      done = true;
      stopRoomsWait?.();
      signal?.removeEventListener("abort", onAbort);
      // The SDK may call back before `subscribe` returns.
      queueMicrotask(() => subscriptions.forEach((s) => s.cancel()));
      resolve({ sweeps, rooms, roomsRanOut });
    };
    const stopSweepsDeadline = visibleTimeout(() => {
      if (done) return;
      done = true;
      signal?.removeEventListener("abort", onAbort);
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
          // The sweeps are in, so their deadline is met: from here only the rooms are waited for.
          stopSweepsDeadline();
          if (Object.keys(rooms).length > 0) finish();
          else stopRoomsWait ??= visibleTimeout(() => finish(true), ROOMS_WAIT_MS);
        },
      }),
    );
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function createLiveMatterport(config: LiveMatterportConfig): MatterportAdapter {
  const { sdkKey } = config;
  if (!sdkKey) throw new MatterportNotConfiguredError();
  const connect = config.connect ?? connectShowcase;
  const timeoutMs = config.timeoutMs ?? 15_000;
  const connectTimeoutMs = config.connectTimeoutMs ?? 20_000;

  // A deadline that runs out after the page was hidden, or with the player
  // short of playing, is the player not starting, not the scan: a board built
  // without its rooms is one room, and the level can't be placed on it.
  // A caller that stopped waiting (`signal`) ends the load where it is, with a
  // `MatterportAbandonedError`: before the player opens, when it was still queued.
  async function load(modelId: string, signal?: AbortSignal) {
    if (signal?.aborted) throw new MatterportAbandonedError();
    const page = watchHidden();
    try {
      let session: ShowcaseSession;
      try {
        session = await connectWithin(connect, modelId, sdkKey!, connectTimeoutMs, signal);
      } catch (error) {
        if (signal?.aborted) throw new MatterportAbandonedError();
        if (page.hidden() && isTimeout(error)) throw new MatterportNotStartedError(true);
        throw error;
      }
      const player = watchPlaying(session.sdk);
      const stalled = () => page.hidden() || player.playing() === false;
      try {
        let got: Awaited<ReturnType<typeof snapshots>>;
        try {
          got = await snapshots(session.sdk.Sweep.data, session.sdk.Room.data, timeoutMs, signal);
        } catch (error) {
          if (isTimeout(error) && stalled()) throw new MatterportNotStartedError(page.hidden());
          throw error;
        }
        if (got.roomsRanOut && stalled()) throw new MatterportNotStartedError(page.hidden());
        return toFloorGraph(got.sweeps, got.rooms);
      } finally {
        player.stop();
        session.disconnect();
      }
    } finally {
      page.stop();
    }
  }

  // One hidden player at a time: two players of one model opened together
  // (a screen that mounts twice, a quick Retry) stalled each other on SDK
  // 26.11, so a load waits for the one before it to settle.
  let queue: Promise<unknown> = Promise.resolve();
  return {
    loadFloor(building, signal) {
      const modelId = building.matterportModelId;
      if (!modelId) return Promise.resolve(null);
      const next = queue.then(() => load(modelId, signal));
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
//
// What this part assumes about the SDK was measured on a real model on
// localhost (SDK 26.11) and is written where it is used. Its unit tests run
// on a stubbed player.

/** A point in the scan's space, as the SDK gives it: metres, with `y` up. */
export interface ScanPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** The camera of the Inside view's player. */
export interface InsidePose {
  /** Where the camera is. Standing on a scan position, it is about 1.5 m above that position's floor point. */
  readonly position: ScanPoint;
  /**
   * Which way it looks, in degrees: `x` is pitch and `y` is yaw. At yaw θ the
   * camera looks along (-sin θ, 0, -cos θ).
   */
  readonly rotation: { readonly x: number; readonly y: number };
}

/** A point in the player's frame: CSS pixels from its top left corner. */
export interface FramePoint {
  readonly x: number;
  readonly y: number;
}

/** The part of the SDK the Inside view drives. */
export interface InsideSdk {
  /** `App.state` in the SDK: the player's phase, sent on subscribing and on every change. */
  App: { state: { subscribe(observer: (state: { phase?: string }) => void): Subscription } };
  Sweep: {
    moveTo(sweepId: string, options?: { transition?: string; transitionTime?: number }): Promise<unknown>;
    data: ObservableCollection<unknown>;
  };
  Camera: {
    pose: { subscribe(observer: (pose: unknown) => void): Subscription };
    rotate(horizontal: number, vertical: number, options?: { speed?: number }): Promise<unknown>;
  };
  Conversion: {
    worldToScreen(point: ScanPoint, pose: unknown, size: { w: number; h: number }): { x: number; y: number; z: number };
  };
  disconnect?: () => void;
}

/** A connected player: the SDK, and the frame the player shows in. */
export interface InsidePlayer extends InsideSdk {
  /** The size of the player's frame as it is laid out now, in CSS pixels. */
  frameSize(): { w: number; h: number };
}

/**
 * A connected Inside view: steer its camera, read where the camera is, and
 * let it go. Nothing is read from the scan until `onPose`, `floorPoints` or
 * `project` asks: a view that is only moved subscribes to nothing once it is
 * open (while it opens, the player's phase is watched; see `oncePlaying`).
 * What is read goes to the caller and nowhere else (SPEC §4.5).
 */
export interface InsideView {
  /**
   * Sends the view to `sweepId`, in a flight of `ms` milliseconds: 600 when
   * `ms` is left out or is not a finite number of at least 0, and at most
   * 10 s when it asks for longer. Moves never
   * overlap: one made while another is in flight is held, and only the latest
   * held target is flown to once the flight settles, in its own `ms`. A move
   * the player refuses is ignored: the board, not the view, is the game.
   */
  moveTo(sweepId: string, ms?: number): Promise<void>;
  /**
   * Turns the camera by `dx` degrees across and `dy` degrees up or down:
   * `Camera.rotate`'s horizontal and vertical, with the signs the SDK gives
   * them: a positive `dx` lowers the yaw (on a real scan, `rotate(30, 0)`
   * turned it by -30 degrees). The turn lands at once (under 20 ms on SDK
   * 26.11) and the promise resolves when it has, after `TURN_MS` (1 s) at
   * most, or at `disconnect`. A turn the player refuses is dropped without a
   * word, since turns come at pointer rate; the promise never rejects.
   */
  rotate(dx: number, dy: number): Promise<void>;
  /**
   * Calls `listener` with the camera's pose each time it changes: about 55
   * times a second while the camera moves. A still camera may send nothing,
   * so a listener added once a pose has arrived hears that pose first. It is
   * never called before `onPose` returns, and hears each pose once. Returns
   * the unsubscribe: after it, and after `disconnect`, the listener hears
   * nothing more.
   */
  onPose(listener: (pose: InsidePose) => void): () => void;
  /**
   * Each scan position's floor point, keyed by the board's node id: every
   * position the scan sends, whether or not the board uses it. A position
   * the scan gives no floor point is left out.
   *
   * Every call reads the scan afresh and keeps nothing: the map is the
   * caller's own, so ask once and hold on to it. It resolves once the
   * positions have stopped arriving (they can come over a few callbacks), or
   * after `FLOOR_POINTS_MS` (15 s) with what has arrived by then, which is
   * an empty map if the scan sent nothing. Once the view is disconnected it
   * resolves empty.
   */
  floorPoints(): Promise<ReadonlyMap<string, ScanPoint>>;
  /**
   * Where `point` shows in the player's frame, by the latest pose and the
   * frame's size as it is laid out now. Null when the point is not in front
   * of the camera, before any pose has arrived (the first call, like the
   * first `onPose`, starts the view reading the pose), and while the frame
   * has no size. A point in front of the camera but outside the frame comes
   * back with coordinates outside it: the caller clips.
   *
   * The frame is measured on every call, so project all of a drawing's
   * points before writing any styles.
   */
  project(point: ScanPoint): FramePoint | null;
  disconnect(): void;
}

/** Opens the Inside view's player in `parent`; injected in tests. */
export type InsideConnect = (parent: HTMLElement, modelId: string, sdkKey: string, signal?: AbortSignal) => Promise<InsidePlayer>;

/** `Sweep.Transition.FLY` in the SDK (checked on SDK 26.11, where `Camera.TransitionType.FLY` has the same value). */
export const FLY = "transition.fly";

/** What the player says when a move is refused because another transition is still running (SDK 26.11). */
const TRANSITION_ACTIVE = /transition.*(active|in progress)/i;
const BUSY_RETRIES = 5;
const BUSY_WAIT_MS = 400;

/** A flight's travel time when the move names none. `Sweep.moveTo` keeps to it within about 50 ms (SDK 26.11). */
const FLY_MS = 600;
/** The longest travel time a move may ask for. A longer one is flown in this, which also keeps the move's deadline within `setTimeout`'s range. */
const MAX_FLY_MS = 10_000;
/** A move that has not settled this long after its travel time counts as refused, so a lost flight cannot freeze the view. */
const MOVE_GRACE_MS = 5_000;

/** `Camera.rotate`'s speed, in degrees a second: at 3000 a turn lands in under 20 ms (SDK 26.11). */
export const LOOK_SPEED = 3_000;
/** How long a turn may take before its promise resolves anyway, so a lost turn cannot leave it pending. */
const TURN_MS = 1_000;

/** How long the scan's positions may go quiet before `floorPoints` takes them as all there. */
export const SWEEPS_QUIET_MS = 300;
/** How long `floorPoints` waits for the scan's positions before it answers with what has arrived. */
export const FLOOR_POINTS_MS = 15_000;

const RawPoint = z.object({ x: z.number(), y: z.number(), z: z.number() });
/**
 * `Camera.pose`, as far as the Inside view reads it: `rotation` is in
 * degrees. The SDK's pose also carries `projection`, `sweep` and `mode`;
 * `Conversion.worldToScreen` takes it whole.
 */
const RawPose = z.object({ position: RawPoint, rotation: z.object({ x: z.number(), y: z.number() }) });
/**
 * A scan position in `Sweep.data`, as far as the Inside view reads it. `sid`
 * is the board's node id (mapping.ts), and `puckPosition` is its floor point;
 * `position` is the camera, about 1.5 m higher.
 */
const RawPuck = z.object({ sid: z.string().min(1), puckPosition: RawPoint });

/** `promise`, or a rejection once `ms` pass without it settling. `what` names it in that rejection. */
function settleWithin<T>(promise: Promise<T>, ms: number, what = "the move"): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not settle within ${ms} ms`)), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/**
 * The scan's positions once they have stopped arriving: the latest non-empty
 * collection, `quietMs` after the last one came. At `timeoutMs` it answers
 * with what has arrived, which may be nothing; when `stop` aborts, with
 * nothing. It cancels its subscription as it answers.
 */
function settledSweeps(
  data: ObservableCollection<unknown>,
  quietMs: number,
  timeoutMs: number,
  stop: AbortSignal,
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let sweeps: Record<string, unknown> = {};
    let done = false;
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const finish = (answer: Record<string, unknown>) => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      clearTimeout(quiet);
      stop.removeEventListener("abort", onStop);
      subscription.cancel();
      resolve(answer);
    };
    const onStop = () => finish({});
    // The SDK may call back before `subscribe` returns, but only a timer or
    // `stop` ends the wait, so the subscription is there to cancel by then.
    const subscription = data.subscribe({
      onCollectionUpdated(items) {
        // The player can call back with an empty collection before it is playing: not an answer.
        if (done || Object.keys(items).length === 0) return;
        sweeps = items;
        clearTimeout(quiet);
        quiet = setTimeout(() => finish(sweeps), quietMs);
      },
    });
    const deadline = setTimeout(() => finish(sweeps), timeoutMs);
    stop.addEventListener("abort", onStop, { once: true });
  });
}

/** Each position's floor point, keyed by the board's node id; a position without one is left out. */
function toFloorPoints(sweeps: Record<string, unknown>): Map<string, ScanPoint> {
  const points = new Map<string, ScanPoint>();
  for (const sweep of Object.values(sweeps)) {
    const puck = RawPuck.safeParse(sweep);
    if (puck.success) points.set(puck.data.sid, puck.data.puckPosition);
  }
  return points;
}

/** How long the Inside view's player may take to connect and start playing before the pane says it failed. */
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
      App: sdk.App,
      Sweep: sdk.Sweep,
      Camera: sdk.Camera,
      Conversion: sdk.Conversion,
      frameSize: () => ({ w: iframe.clientWidth, h: iframe.clientHeight }),
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

/** `App.Phase.PLAYING` in the SDK (checked on SDK 26.11): the player has left its loading screen and shows the scan. */
export const PLAYING = "appphase.playing";

/**
 * `player`, once it is playing. The SDK connects while the player is still
 * loading, and a move made then is taken: the player's own opening move is
 * refused after it, and the player stays on its loading poster for good
 * (issue 117, seen on SDK 26.11). The pose, the positions and the projection
 * need a playing player too, so this one wait covers every member of the
 * view. When `signal` aborts first (the connect deadline, or the caller
 * letting go) the player is disconnected, as a late one is, and the wait
 * rejects.
 */
function oncePlaying<P extends InsideSdk>(player: P, signal: AbortSignal): Promise<P> {
  return new Promise((resolve, reject) => {
    let done = false;
    const subscriptions: Subscription[] = [];
    const finish = () => {
      done = true;
      signal.removeEventListener("abort", onAbort);
      // The SDK may call back before `subscribe` returns.
      queueMicrotask(() => subscriptions.forEach((s) => s.cancel()));
    };
    const onAbort = () => {
      if (done) return;
      finish();
      player.disconnect?.();
      reject(new Error("Matterport: the Inside view's player did not start playing"));
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    subscriptions.push(
      player.App.state.subscribe((state) => {
        if (done || state.phase !== PLAYING) return;
        finish();
        resolve(player);
      }),
    );
  });
}

/**
 * The Inside view: a visible Showcase player in `parent`, connected to the
 * SDK and playing within `connectMs` (a player that gets there later is let
 * go). It moves and turns the camera, and reads two things for its caller:
 * the camera's pose, and each scan position's floor point. Neither is read
 * until it is asked for, both go to the caller and nowhere else, and nothing
 * leaves the page (SPEC §4.5). Sweep ids are the board's node ids: in the SDK
 * a sweep's `id` and `sid` are the same string.
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
    async (inner) => oncePlaying(await connect(parent, modelId, sdkKey, inner), inner),
    "the Inside view's player",
    connectMs,
    (late) => late.disconnect?.(),
    signal,
  );
  let flying: Promise<void> | null = null;
  let target: string | null = null;
  /** The travel time of the move to `target`. */
  let travel = FLY_MS;
  let at: string | null = null;
  let gone = false;
  let busy = 0;

  async function fly(): Promise<void> {
    // Yield first, so `flying` is set before this can finish and clear it.
    await Promise.resolve();
    try {
      while (!gone && target !== null && target !== at) {
        const sweepId = target;
        const ms = travel;
        try {
          await settleWithin(sdk.Sweep.moveTo(sweepId, { transition: FLY, transitionTime: ms }), ms + MOVE_GRACE_MS);
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

  // ---- reading the scan: opened on first ask, closed at disconnect ----------

  /** Aborts at disconnect: the pose subscription is cancelled, and a pending `floorPoints` answers. */
  const closed = new AbortController();

  interface PoseEntry {
    listener: (pose: InsidePose) => void;
    /** The last pose this listener was given, so it hears each pose once. */
    heard: InsidePose | null;
  }
  const poseListeners = new Set<PoseEntry>();
  /** The latest pose: as the SDK sent it, which is what `worldToScreen` takes, and as listeners get it. */
  let latest: { raw: unknown; pose: InsidePose } | null = null;
  let watchingPose = false;

  function tell(entry: PoseEntry) {
    if (!latest || entry.heard === latest.pose || !poseListeners.has(entry)) return;
    entry.heard = latest.pose;
    try {
      entry.listener(latest.pose);
    } catch (error) {
      // One listener's failure is its own: the others still hear this pose.
      console.error("Matterport: a listener to the Inside view's pose threw", error);
    }
  }

  /** Opens the one `Camera.pose` subscription, which the view keeps until it is disconnected. */
  function watchPose() {
    if (watchingPose || gone) return;
    let opening = true;
    const subscription = sdk.Camera.pose.subscribe((raw) => {
      if (gone) return;
      const pose = RawPose.safeParse(raw);
      if (!pose.success) return;
      latest = { raw, pose: pose.data };
      // The SDK may call back before `subscribe` returns. That pose waits for
      // `onPose` to return, which then tells its listener.
      if (!opening) for (const entry of [...poseListeners]) tell(entry);
    });
    opening = false;
    // Only now: a `subscribe` that threw is tried again on the next ask.
    watchingPose = true;
    closed.signal.addEventListener(
      "abort",
      () => {
        latest = null;
        poseListeners.clear();
        subscription.cancel();
      },
      { once: true },
    );
  }

  return {
    moveTo(sweepId, ms) {
      target = sweepId;
      travel = typeof ms === "number" && Number.isFinite(ms) && ms >= 0 ? Math.min(ms, MAX_FLY_MS) : FLY_MS;
      flying ??= fly();
      return flying;
    },
    async rotate(dx, dy) {
      if (gone || closed.signal.aborted) return;
      // Ends the wait at disconnect. Each turn has its own, removed as it settles, so nothing outlives it.
      let onClose = () => {};
      const shut = new Promise<void>((resolve) => (onClose = resolve));
      closed.signal.addEventListener("abort", onClose, { once: true });
      try {
        // Not queued behind moves. Bounded, and ended by disconnect, so a lost turn never leaves the caller waiting.
        await Promise.race([settleWithin(sdk.Camera.rotate(dx, dy, { speed: LOOK_SPEED }), TURN_MS, "the turn"), shut]);
      } catch {
        // Dropped: the next turn is already on its way.
      } finally {
        closed.signal.removeEventListener("abort", onClose);
      }
    },
    onPose(listener) {
      if (gone) return () => {};
      const entry: PoseEntry = { listener, heard: null };
      poseListeners.add(entry);
      try {
        watchPose();
      } catch (error) {
        // No unsubscribe reaches the caller, so the entry must not stay to hear a later subscription.
        poseListeners.delete(entry);
        throw error;
      }
      queueMicrotask(() => tell(entry));
      return () => {
        poseListeners.delete(entry);
      };
    },
    async floorPoints() {
      if (gone) return new Map();
      return toFloorPoints(await settledSweeps(sdk.Sweep.data, SWEEPS_QUIET_MS, FLOOR_POINTS_MS, closed.signal));
    },
    project(point) {
      watchPose();
      if (!latest) return null;
      const size = sdk.frameSize();
      if (!(size.w > 0 && size.h > 0)) return null;
      const { x, y, z } = sdk.Conversion.worldToScreen(point, latest.raw, { w: size.w, h: size.h });
      // In front of the camera `z` is just under 1. Behind it `z` is just over
      // 1, with `x` and `y` mirrored; exactly to the side the numbers are
      // enormous (SDK 26.11).
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || z >= 1) return null;
      return { x, y };
    },
    disconnect() {
      gone = true;
      // The reads close before the SDK is let go, while it can still take a cancel.
      closed.abort();
      sdk.disconnect?.();
    },
  };
}
