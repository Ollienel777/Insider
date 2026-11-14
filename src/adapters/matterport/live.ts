// The live Matterport adapter: connects to a model through the Showcase SDK,
// reads `Sweep.data` and `Room.data` once, and hands them to mapping.ts. What
// it assumes about the SDK lives in mapping.ts.
//
// Not exercised against Matterport: there is no SDK key yet. Its unit tests
// run it on a stubbed SDK connection.
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

/** Opens a Showcase SDK session on one model. */
export type ShowcaseConnect = (modelId: string, sdkKey: string) => Promise<ShowcaseSession>;

export interface LiveMatterportConfig {
  sdkKey?: string;
  /** Injected in tests; defaults to a hidden Showcase iframe. */
  connect?: ShowcaseConnect;
  /** How long each collection may take to arrive once connected. */
  timeoutMs?: number;
  /**
   * How long the connection itself may take (the SDK script, the player and
   * the handshake). Without it a player that never loads holds the board on
   * its skeleton for good; with it the fixture floor takes over (issue 28).
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
 * `connect`, bounded by `ms`. A session that opens after the deadline is
 * disconnected at once, so a late player does not linger in the page.
 */
export function connectWithin(connect: ShowcaseConnect, modelId: string, sdkKey: string, ms: number): Promise<ShowcaseSession> {
  return new Promise((resolve, reject) => {
    let late = false;
    const timer = setTimeout(() => {
      late = true;
      reject(new MatterportTimeoutError("the Showcase connection", ms));
    }, ms);
    connect(modelId, sdkKey).then(
      (session) => {
        if (late) return session.disconnect();
        clearTimeout(timer);
        resolve(session);
      },
      (error: unknown) => {
        if (late) return;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export class MatterportNotConfiguredError extends Error {
  constructor() {
    super("Matterport live adapter not configured: NEXT_PUBLIC_MATTERPORT_SDK_KEY missing");
    this.name = "MatterportNotConfiguredError";
  }
}

/** The collection's first full snapshot, then unsubscribe. */
function snapshot<T>(collection: ObservableCollection<T>, what: string, timeoutMs: number): Promise<Record<string, T>> {
  return new Promise((resolve, reject) => {
    let done = false;
    // The timer and the callback both run after `subscribe` has returned (the
    // callback defers its cancel), so `subscription` is always set by then.
    const timer = setTimeout(() => {
      done = true;
      subscription.cancel();
      reject(new MatterportTimeoutError(what, timeoutMs));
    }, timeoutMs);
    const subscription = collection.subscribe({
      onCollectionUpdated(items) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        // The SDK may call back before `subscribe` returns.
        queueMicrotask(() => subscription.cancel());
        resolve({ ...items });
      },
    });
  });
}

export function createLiveMatterport(config: LiveMatterportConfig): MatterportAdapter {
  const { sdkKey } = config;
  if (!sdkKey) throw new MatterportNotConfiguredError();
  const connect = config.connect ?? connectShowcase;
  const timeoutMs = config.timeoutMs ?? 15_000;
  const connectTimeoutMs = config.connectTimeoutMs ?? 20_000;

  return {
    async loadFloor(building) {
      if (!building.matterportModelId) return null;
      const session = await connectWithin(connect, building.matterportModelId, sdkKey, connectTimeoutMs);
      try {
        const [sweeps, rooms] = await Promise.all([
          snapshot(session.sdk.Sweep.data, "Sweep.data", timeoutMs),
          snapshot(session.sdk.Room.data, "Room.data", timeoutMs),
        ]);
        return toFloorGraph(sweeps, rooms);
      } finally {
        session.disconnect();
      }
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
 * before the iframe joins the page, so a fast load is not missed.
 */
async function mountPlayer(
  parent: HTMLElement,
  iframe: HTMLIFrameElement,
  modelId: string,
  sdkKey: string,
): Promise<ShowcaseSdk & InsideSdk> {
  const loaded = new Promise<void>((resolve) => iframe.addEventListener("load", () => resolve(), { once: true }));
  iframe.src = SHOWCASE.embedUrl(modelId, sdkKey);
  iframe.allow = "xr-spatial-tracking";
  parent.appendChild(iframe);
  await Promise.all([loadSdkScript(), loaded]);
  const mp = (window as unknown as { MP_SDK?: MpSdkGlobal }).MP_SDK;
  if (!mp) throw new Error("Matterport: MP_SDK missing after the SDK script loaded");
  return mp.connect(iframe, sdkKey, SHOWCASE.sdkVersion);
}

/** Loads the model in a hidden iframe and connects the SDK to it. */
export const connectShowcase: ShowcaseConnect = async (modelId, sdkKey) => {
  if (typeof document === "undefined") {
    throw new Error("Matterport: the Showcase SDK runs only in the browser");
  }
  const iframe = document.createElement("iframe");
  iframe.title = "Matterport model (hidden)";
  iframe.setAttribute("aria-hidden", "true");
  iframe.tabIndex = -1;
  Object.assign(iframe.style, { position: "fixed", width: "1px", height: "1px", left: "-10px", top: "-10px", border: "0" });
  try {
    const sdk = await mountPlayer(document.body, iframe, modelId, sdkKey);
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
  /** Moves the view to `sweepId`. A move the player refuses is ignored: the board, not the view, is the game. */
  moveTo(sweepId: string): Promise<void>;
  disconnect(): void;
}

/** Opens the Inside view's player in `parent`; injected in tests. */
export type InsideConnect = (parent: HTMLElement, modelId: string, sdkKey: string) => Promise<InsideSdk>;

const connectVisiblePlayer: InsideConnect = async (parent, modelId, sdkKey) => {
  const iframe = document.createElement("iframe");
  iframe.title = "Inside view: the scan at the player's spot";
  Object.assign(iframe.style, { width: "100%", height: "100%", border: "0", display: "block" });
  try {
    const sdk = await mountPlayer(parent, iframe, modelId, sdkKey);
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
 * SDK. It only moves the camera; it reads nothing, and nothing leaves the
 * page (SPEC §4.5).
 */
export async function connectInsideView(
  parent: HTMLElement,
  modelId: string,
  sdkKey: string,
  connect: InsideConnect = connectVisiblePlayer,
): Promise<InsideView> {
  const sdk = await connect(parent, modelId, sdkKey);
  return {
    async moveTo(sweepId) {
      try {
        await sdk.Sweep.moveTo(sweepId, { transition: "transition.fly", transitionTime: 600 });
      } catch (error) {
        console.warn(`Matterport: the Inside view did not move (${(error as Error)?.message ?? String(error)})`);
      }
    },
    disconnect() {
      sdk.disconnect?.();
    },
  };
}
