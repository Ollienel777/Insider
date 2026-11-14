// The play mode preference (issue 99): Tactical unless the browser chose Live,
// and a storage that is blocked or full never breaks the Run screen.
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PLAY_MODE, loadPlayMode, PLAY_MODE_KEY, savePlayMode } from "./play-mode";

const own = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

function blockStorage() {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new DOMException("The operation is insecure.", "SecurityError");
    },
  });
}

function memoryStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };
}

afterEach(() => {
  if (own) Object.defineProperty(globalThis, "localStorage", own);
  else delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe("the play mode preference", () => {
  it("is Tactical for a browser that has never chosen", () => {
    expect(DEFAULT_PLAY_MODE).toBe("tactical");
    expect(loadPlayMode(memoryStorage())).toBe("tactical");
  });

  it("remembers Live, and Tactical chosen after it, under one key for the browser", () => {
    const storage = memoryStorage();
    savePlayMode("live", storage);
    expect(storage.store.get(PLAY_MODE_KEY)).toBe("live");
    expect(loadPlayMode(storage)).toBe("live");
    savePlayMode("tactical", storage);
    expect(loadPlayMode(storage)).toBe("tactical");
  });

  it("reads anything that is not a mode as Tactical", () => {
    for (const stored of ["", "LIVE", "true", '"live"', "sprint"]) {
      expect(loadPlayMode(memoryStorage({ [PLAY_MODE_KEY]: stored })), stored).toBe("tactical");
    }
  });

  it("with site data blocked, saves nothing and loads Tactical, without throwing", () => {
    blockStorage();
    expect(() => savePlayMode("live")).not.toThrow();
    expect(() => loadPlayMode()).not.toThrow();
    expect(loadPlayMode()).toBe("tactical");
  });

  it("swallows a storage that is full or will not be read", () => {
    const broken = {
      getItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
    };
    expect(() => savePlayMode("live", broken)).not.toThrow();
    expect(loadPlayMode(broken)).toBe("tactical");
  });
});
