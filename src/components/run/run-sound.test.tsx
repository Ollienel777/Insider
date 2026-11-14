// The mute button and its key (issue 101), and that the Run screen carries
// them. Effects do not run in a static render and Web Audio does not exist
// here, so the hook's audio side is covered through sound-player.test.ts, and
// in a real browser by tests/smoke/sound.spec.ts.
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
  const render = (muted: boolean) => renderToStaticMarkup(<MuteToggle muted={muted} onToggle={() => {}} />);

  it("exposes its state as pressed, names itself and its key", () => {
    expect(render(false)).toContain('aria-pressed="false"');
    expect(render(true)).toContain('aria-pressed="true"');
    for (const out of [render(false), render(true)]) {
      expect(out).toContain('data-testid="mute-toggle"');
      expect(out).toContain('aria-keyshortcuts="M"');
      expect(out).toMatch(/<span[^>]*>Mute<\/span>/);
    }
  });

  it("shows a different icon muted, so the state is not carried by its tint alone", () => {
    const icon = (out: string) => /<svg[^>]*class="([^"]*)"/.exec(out)?.[1];
    expect(icon(render(false))).toContain("lucide-volume-2");
    expect(icon(render(true))).toContain("lucide-volume-x");
  });
});

describe("the Run screen", () => {
  const manifest = LevelManifest.parse(structuredClone(cached));

  it("carries the mute button in its top bar, with sound on until the stored choice is read", () => {
    const out = renderToStaticMarkup(<RunScreen building={{ id: "F1", name: "Halvorsen Tower" }} manifest={manifest} />);
    expect(out).toMatch(/data-testid="mute-toggle"[^>]*aria-pressed="false"/);
    // Beside the Layer lens, before Restart.
    expect(out.indexOf('data-testid="lens-toggle"')).toBeLessThan(out.indexOf('data-testid="mute-toggle"'));
    expect(out.indexOf('data-testid="mute-toggle"')).toBeLessThan(out.indexOf("Restart"));
  });

  it("keeps it where there is no board to play: the choice is the player's either way", () => {
    const out = renderToStaticMarkup(<RunScreen building={{ id: "F2", name: "Figueroa Exchange" }} manifest={null} />);
    expect(out).toContain('data-testid="mute-toggle"');
  });
});
