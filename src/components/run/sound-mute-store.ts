// The mute choice for the run's sound (issue 101), remembered per browser in
// localStorage. Storage can be blocked or full, so every read and write may
// quietly do nothing (even reaching `localStorage` throws when site data is
// blocked). The choice is therefore also kept in memory: mute still works on
// this page when it cannot be saved, and is only forgotten on the next visit.

/** One key for every building: muting is about the room you are sitting in, not the level. */
export const MUTE_KEY = "heist:sound-muted";

/** The browser's storage, read inside the caller's `try`: the getter itself throws when site data is blocked. */
const browserStorage = (): Storage | undefined => globalThis.localStorage;

export interface MuteStore {
  /** Whether sound is muted. Unmuted until the player says otherwise. */
  get(): boolean;
  set(muted: boolean): void;
  /** Calls `listener` on every `set`, and returns the way to stop: the shape `useSyncExternalStore` takes. */
  subscribe(listener: () => void): () => void;
}

export function createMuteStore(
  storage: () => Pick<Storage, "getItem" | "setItem"> | undefined = browserStorage,
): MuteStore {
  /** The choice as this page knows it: null until first asked for, then read from storage once. */
  let muted: boolean | null = null;
  const listeners = new Set<() => void>();

  function get(): boolean {
    if (muted === null) {
      try {
        muted = storage()?.getItem(MUTE_KEY) === "true";
      } catch {
        muted = false;
      }
    }
    return muted;
  }

  function set(next: boolean): void {
    muted = next;
    try {
      storage()?.setItem(MUTE_KEY, String(next));
    } catch {
      // The choice holds for this page; only the next visit forgets it.
    }
    for (const listener of [...listeners]) listener();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return { get, set, subscribe };
}

/** The page's own store, over the browser's storage. */
export const muteStore = createMuteStore();
