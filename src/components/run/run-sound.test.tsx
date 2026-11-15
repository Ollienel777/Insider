// The mute button and its key (issue 101), and that the Run screen carries
// them. Effects do not run in a static render and Web Audio does not exist
// here, so what the hook does with audio is covered through
// sound-player.test.ts; this file holds the parts a render and a key can show.
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LevelManifest } from "@/domain";
import cached from "../../../data/levels/F1.romaine-1974.json";
import { RunScreen } from "./run-screen";
import { isMuteKey, MuteToggle } from "./run-sound";

const key = (over: Partial<Parameters<typeof isMuteKey>[0]> = {}) => ({
  key: "m",
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  repeat: false,
  target: { closest: () => null },
  ...over,
});

describe("the mute key", () => {
  it("is M, in either case", () => {
    expect(isMuteKey(key())).toBe(true);
    expect(isMuteKey(key({ key: "M" }))).toBe(true);
  });

  it("is no other key: the board's own keys stay the board's", () => {
    for (const other of ["w", "s", "l", "1", " ", "Escape", "Enter", "n"]) {
      expect(isMuteKey(key({ key: other })), other).toBe(false);
    }
  });

  it("is not a shortcut with a modifier, or a key held down", () => {
    expect(isMuteKey(key({ ctrlKey: true }))).toBe(false);
    expect(isMuteKey(key({ metaKey: true }))).toBe(false);
    expect(isMuteKey(key({ altKey: true }))).toBe(false);
    expect(isMuteKey(key({ repeat: true }))).toBe(false);
  });

  it("is left alone while typing in a field", () => {
    const asked: string[] = [];
    const field = {
      closest: (selector: string) => {
        asked.push(selector);
        return {};
      },
    };
    expect(isMuteKey(key({ target: field }))).toBe(false);
    expect(asked[0]).toContain("input");
    expect(asked[0]).toContain("textarea");
    expect(asked[0]).toContain("contenteditable");
  });

  it("works when the press has no element behind it", () => {
    expect(isMuteKey(key({ target: null }))).toBe(true);
    expect(isMuteKey(key({ target: {} }))).toBe(true);
  });
});

describe("the mute button", () => {
  const render = (muted: boolean) => renderToStaticMarkup(<MuteToggle muted={muted} onToggle={() => {}} className="absolute top-2" />);

  it("exposes its state as pressed, and names itself and its key", () => {
    expect(render(false)).toContain('aria-pressed="false"');
    expect(render(true)).toContain('aria-pressed="true"');
    for (const out of [render(false), render(true)]) {
      expect(out).toContain('data-testid="mute-toggle"');
      expect(out).toContain('aria-keyshortcuts="M"');
      expect(out).toMatch(/<span class="sr-only">Mute<\/span>/);
      expect(out).toMatch(/<kbd[^>]*aria-hidden="true"[^>]*>M<\/kbd>/);
    }
  });

  it("shows a different icon muted, so its state is not carried by its tint alone", () => {
    const icon = (out: string) => /<svg[^>]*class="([^"]*)"/.exec(out)?.[1];
    expect(icon(render(false))).toContain("lucide-volume-2");
    expect(icon(render(true))).toContain("lucide-volume-x");
  });

  it("is at least 40px each way, and goes where it is put", () => {
    const classes = /<button[^>]*class="([^"]*)"/.exec(render(false))![1].split(" ");
    expect(classes).toEqual(expect.arrayContaining(["h-10", "min-w-10", "absolute", "top-2"]));
  });
});

describe("the Run screen", () => {
  const manifest = LevelManifest.parse(structuredClone(cached));

  it("shows no mute button while the board is still loading", () => {
    // A static render has no run yet: the loading board, which the button is kept off.
    const out = renderToStaticMarkup(<RunScreen building={{ id: "F1", name: "Halvorsen Tower" }} manifest={manifest} source="fixture" />);
    expect(out).not.toContain('data-testid="mute-toggle"');
  });

  it("carries the mute button over the board once a run is on it", () => {
    const source = readFileSync(path.join(import.meta.dirname, "run-screen.tsx"), "utf8");
    expect(source).toMatch(/\{run \? \(\s*<div[^>]*>[\s\S]{0,200}?<FullscreenToggle [^>]*\/>\s*<MuteToggle muted=\{muted\} onToggle=\{toggleMute\}/);
  });

  it("hands its run to the sound hook, which a static render cannot show", () => {
    const source = readFileSync(path.join(import.meta.dirname, "run-screen.tsx"), "utf8");
    expect(source).toMatch(/const \[muted, toggleMute\] = useRunSound\(run\);/);
    expect(source).toMatch(/<MuteToggle muted=\{muted\} onToggle=\{toggleMute\}/);
  });
});
