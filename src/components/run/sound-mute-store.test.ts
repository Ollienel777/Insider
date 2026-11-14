// The mute choice (issue 101): remembered in storage, and still a working
// switch where storage is missing, blocked or full.
import { describe, expect, it, vi } from "vitest";
import { createMuteStore, MUTE_KEY } from "./sound-mute-store";

/** A Map behind the two calls the store makes. */
function fakeStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

const blocked = () => {
  throw new DOMException("The operation is insecure.", "SecurityError");
};

describe("the mute choice", () => {
  it("is unmuted until the player says otherwise", () => {
    expect(createMuteStore(() => fakeStorage()).get()).toBe(false);
  });

  it("is remembered: a store opened later on the same storage reads it back", () => {
    const storage = fakeStorage();
    createMuteStore(() => storage).set(true);
    expect(storage.items.get(MUTE_KEY)).toBe("true");
    expect(createMuteStore(() => storage).get()).toBe(true);

    createMuteStore(() => storage).set(false);
    expect(createMuteStore(() => storage).get()).toBe(false);
  });

  it("reads anything it did not write as unmuted", () => {
    expect(createMuteStore(() => fakeStorage({ [MUTE_KEY]: "yes" })).get()).toBe(false);
  });

  it("tells its subscribers on every change, until they leave", () => {
    const store = createMuteStore(() => fakeStorage());
    const listener = vi.fn();
    const leave = store.subscribe(listener);
    store.set(true);
    store.set(false);
    expect(listener).toHaveBeenCalledTimes(2);
    leave();
    store.set(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("where storage does not work, mute still does", () => {
  it.each([
    ["there is no storage", () => undefined],
    ["reaching storage throws", blocked],
    ["reading and writing throw", () => ({ getItem: blocked, setItem: blocked })],
  ])("when %s", (_name, storage) => {
    const store = createMuteStore(storage);
    expect(store.get()).toBe(false);
    expect(() => store.set(true)).not.toThrow();
    expect(store.get()).toBe(true);
    store.set(false);
    expect(store.get()).toBe(false);
  });

  it("when storage is full: the write is lost, and the choice is kept for this page", () => {
    const storage = { ...fakeStorage(), setItem: blocked };
    const store = createMuteStore(() => storage);
    store.set(true);
    expect(store.get()).toBe(true);
    expect(createMuteStore(() => storage).get()).toBe(false);
  });
});
