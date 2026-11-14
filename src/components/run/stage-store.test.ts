// The Run stage's stored choice (issue 117): kept per browser, read back on
// the next visit, and never a reason to throw. Blocked site data makes even
// reaching `localStorage` throw, and that must stay inside the store.
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_STAGE_MODE, loadStageMode, saveStageMode, STAGE_MODE_KEY, STAGE_MODES } from "./stage-store";

const own = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

function blockStorage() {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new DOMException("The operation is insecure.", "SecurityError");
    },
  });
}

function fakeStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

afterEach(() => {
  if (own) Object.defineProperty(globalThis, "localStorage", own);
  else delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe("the stage's stored choice", () => {
  it("is Split until a choice is stored", () => {
    expect(DEFAULT_STAGE_MODE).toBe("split");
    expect(loadStageMode(fakeStorage())).toBe("split");
  });

  it.each(STAGE_MODES)("keeps %s and reads it back", (mode) => {
    const storage = fakeStorage();
    saveStageMode(mode, storage);
    expect(storage.items.get(STAGE_MODE_KEY)).toBe(mode);
    expect(loadStageMode(storage)).toBe(mode);
  });

  it("stores the mode's name and nothing else, under one key for every building", () => {
    const storage = fakeStorage();
    saveStageMode("scan", storage);
    expect([...storage.items]).toEqual([["heist:run-stage", "scan"]]);
  });

  it("reads a value that is not a mode as Split", () => {
    for (const junk of ["", "SPLIT", "both", "{}", "null"]) {
      expect(loadStageMode(fakeStorage({ [STAGE_MODE_KEY]: junk })), junk).toBe("split");
    }
  });

  it("uses the browser's storage when it is handed none", () => {
    const storage = fakeStorage();
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
    saveStageMode("board");
    expect(storage.items.get(STAGE_MODE_KEY)).toBe("board");
    expect(loadStageMode()).toBe("board");
  });

  it("saves nothing and reads Split, without throwing, when site data is blocked", () => {
    blockStorage();
    expect(() => saveStageMode("scan")).not.toThrow();
    expect(() => loadStageMode()).not.toThrow();
    expect(loadStageMode()).toBe("split");
  });

  it("swallows a full storage and one that cannot be read", () => {
    const broken = {
      getItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
    };
    expect(() => saveStageMode("board", broken)).not.toThrow();
    expect(loadStageMode(broken)).toBe("split");
  });
});
