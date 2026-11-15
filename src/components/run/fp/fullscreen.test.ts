import { describe, expect, it, vi } from "vitest";
import { fullscreenStep, fullscreenSupported, isFullscreenKey, stageFullscreen, toggleFullscreen } from "./fullscreen";

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

describe("stageFullscreen", () => {
  const el = (marked: boolean) => ({ hasAttribute: (name: string) => marked && name === "data-fullscreen-root" }) as unknown as Element;

  it("is true only while the element in fullscreen is the Run screen's stage", () => {
    expect(stageFullscreen(undefined)).toBe(false);
    expect(stageFullscreen({ fullscreenElement: null })).toBe(false);
    expect(stageFullscreen({ fullscreenElement: el(false) })).toBe(false);
    expect(stageFullscreen({ fullscreenElement: el(true) })).toBe(true);
  });
});

describe("fullscreenStep: the stage in fullscreen and the side panel never show together", () => {
  it("does nothing while only one of them shows", () => {
    expect(fullscreenStep(false, false, true, true)).toBeNull();
    expect(fullscreenStep(false, true, false, true)).toBeNull();
    expect(fullscreenStep(true, true, false, true)).toBeNull();
    expect(fullscreenStep(true, false, true, false)).toBeNull();
  });

  it("closes Details when the stage goes fullscreen over an open panel", () => {
    expect(fullscreenStep(false, true, true, true)).toBe("close-details");
  });

  it("leaves fullscreen when Details opens while the stage is fullscreen", () => {
    expect(fullscreenStep(true, true, true, true)).toBe("leave-fullscreen");
  });

  it("leaves fullscreen in Tactical, whose panel cannot be closed", () => {
    expect(fullscreenStep(true, true, true, false)).toBe("leave-fullscreen");
    expect(fullscreenStep(false, true, true, false)).toBe("leave-fullscreen");
  });
});
