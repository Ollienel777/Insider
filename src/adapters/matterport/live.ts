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
  timeoutMs?: number;
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
      reject(new Error(`Matterport: ${what} did not arrive within ${timeoutMs} ms`));
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

  return {
    async loadFloor(building) {
      if (!building.matterportModelId) return null;
      const session = await connect(building.matterportModelId, sdkKey);
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
  connect(target: HTMLIFrameElement, sdkKey: string, version: string): Promise<ShowcaseSdk & { disconnect?: () => void }>;
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

/** Loads the model in a hidden iframe and connects the SDK to it. */
export const connectShowcase: ShowcaseConnect = async (modelId, sdkKey) => {
  if (typeof document === "undefined") {
    throw new Error("Matterport: the Showcase SDK runs only in the browser");
  }
  await loadSdkScript();
  const iframe = document.createElement("iframe");
  iframe.src = SHOWCASE.embedUrl(modelId, sdkKey);
  iframe.title = "Matterport model (hidden)";
  iframe.setAttribute("aria-hidden", "true");
  iframe.tabIndex = -1;
  iframe.allow = "xr-spatial-tracking";
  Object.assign(iframe.style, { position: "fixed", width: "1px", height: "1px", left: "-10px", top: "-10px", border: "0" });
  document.body.appendChild(iframe);
  try {
    await new Promise<void>((resolve) => iframe.addEventListener("load", () => resolve(), { once: true }));
    const mp = (window as unknown as { MP_SDK?: MpSdkGlobal }).MP_SDK;
    if (!mp) throw new Error("Matterport: MP_SDK missing after the SDK script loaded");
    const sdk = await mp.connect(iframe, sdkKey, SHOWCASE.sdkVersion);
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
