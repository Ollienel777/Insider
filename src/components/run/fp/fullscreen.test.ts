import { describe, expect, it, vi } from "vitest";
import { fullscreenSupported, isFullscreenKey, toggleFullscreen } from "./fullscreen";

const key = (over: Partial<KeyboardEvent> = {}) =>
  ({ key: "f", altKey: false, ctrlKey: false, metaKey: false, repeat: false, target: null, ...over }) as KeyboardEvent;

describe("isFullscreenKey", () => {
  it("takes F either case, alone", () => {
    expect(isFullscreenKey(key())).toBe(true);
    expect(isFullscreenKey(key({ key: "F" }))).toBe(true);
  });

  it("leaves other keys, modifiers and repeats", () => {
    expect(isFullscreenKey(key({ key: "g" }))).toBe(false);
    expect(isFullscreenKey(key({ ctrlKey: true }))).toBe(false);
    expect(isFullscreenKey(key({ metaKey: true }))).toBe(false);
    expect(isFullscreenKey(key({ altKey: true }))).toBe(false);
    expect(isFullscreenKey(key({ repeat: true }))).toBe(false);
  });

  it("leaves an F typed into a field", () => {
    const field = { closest: () => ({}) } as unknown as EventTarget;
    expect(isFullscreenKey(key({ target: field }))).toBe(false);
    const page = { closest: () => null } as unknown as EventTarget;
    expect(isFullscreenKey(key({ target: page }))).toBe(true);
  });
});

describe("fullscreenSupported", () => {
  it("needs the document to allow it", () => {
    expect(fullscreenSupported(undefined)).toBe(false);
    expect(fullscreenSupported({ fullscreenEnabled: false })).toBe(false);
    expect(fullscreenSupported({})).toBe(false);
  });
});

describe("toggleFullscreen", () => {
  const doc = (fullscreenElement: Element | null) => ({
    fullscreenElement,
    fullscreenEnabled: true,
    exitFullscreen: vi.fn(() => Promise.resolve()),
  });

  it("asks for the root when nothing is fullscreen", async () => {
    const root = { requestFullscreen: vi.fn(() => Promise.resolve()) };
    const d = doc(null);
    await toggleFullscreen(root, d);
    expect(root.requestFullscreen).toHaveBeenCalledWith({ navigationUI: "hide" });
    expect(d.exitFullscreen).not.toHaveBeenCalled();
  });

  it("exits when something is fullscreen", async () => {
    const root = { requestFullscreen: vi.fn(() => Promise.resolve()) };
    const d = doc({} as Element);
    await toggleFullscreen(root, d);
    expect(d.exitFullscreen).toHaveBeenCalled();
    expect(root.requestFullscreen).not.toHaveBeenCalled();
  });

  it("resolves when the browser refuses", async () => {
    const root = { requestFullscreen: vi.fn(() => Promise.reject(new TypeError("no gesture"))) };
    await expect(toggleFullscreen(root, doc(null))).resolves.toBeUndefined();
  });
});
