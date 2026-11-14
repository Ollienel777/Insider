// What Live mode draws on the Run screen (issue 99): the switch and the turn
// timer, rendered for each state the clock can be in. The behaviour behind
// them is in turn-clock.test.ts and tests/smoke/live.spec.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CLOCK_LABEL, LiveControls, PlayModeSwitch, TurnTimer } from "./live-controls";
import { LIVE_TURN_MS, type LiveClock, type TurnClockState } from "./turn-clock";

const clock = (state: TurnClockState, lap = "0:0"): LiveClock => ({ state, lap, togglePause: () => {} });

/** The opening tag of the element with `testId`. */
function tag(html: string, testId: string): string {
  const found = html.match(new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`));
  if (!found) throw new Error(`no ${testId} in ${html}`);
  return found[0];
}

describe("the play mode switch", () => {
  it("offers Tactical and Live as one labelled group, and presses the one in play", () => {
    const tactical = renderToStaticMarkup(<PlayModeSwitch mode="tactical" onChange={() => {}} />);
    expect(tag(tactical, "play-mode")).toContain('aria-label="Play mode"');
    expect(tag(tactical, "play-mode")).toContain('data-mode="tactical"');
    expect(tag(tactical, "play-mode-tactical")).toContain('aria-pressed="true"');
    expect(tag(tactical, "play-mode-live")).toContain('aria-pressed="false"');
    expect(tactical).toContain(">Tactical<");
    expect(tactical).toContain(">Live<");

    const live = renderToStaticMarkup(<PlayModeSwitch mode="live" onChange={() => {}} />);
    expect(tag(live, "play-mode")).toContain('data-mode="live"');
    expect(tag(live, "play-mode-tactical")).toContain('aria-pressed="false"');
    expect(tag(live, "play-mode-live")).toContain('aria-pressed="true"');
  });
});

describe("the turn timer", () => {
  it("shows nothing in Tactical, before a run is on the board, or once it has ended", () => {
    expect(renderToStaticMarkup(<TurnTimer clock={clock("off")} />)).toBe("");
    expect(renderToStaticMarkup(<TurnTimer clock={clock("over")} />)).toBe("");
  });

  it("running: says so, drains its bar over LIVE_TURN_MS, and offers the pause", () => {
    const out = renderToStaticMarkup(<TurnTimer clock={clock("running")} />);
    expect(tag(out, "turn-timer")).toContain('data-state="running"');
    expect(out).toContain(`>${CLOCK_LABEL.running}<`);
    const bar = tag(out, "turn-timer-bar");
    expect(bar).toContain("turn-drain");
    expect(bar).toContain(`animation-duration:${LIVE_TURN_MS}ms`);
    expect(bar).toContain("animation-play-state:running");
    expect(bar).toContain("bg-accent");
    const pause = tag(out, "turn-pause");
    expect(pause).toContain('aria-label="Pause the clock"');
    expect(pause).toContain('aria-keyshortcuts="P"');
  });

  it.each(["paused", "held"] as const)("%s: says so in a word, and its bar stands where it stopped, out of the accent", (state) => {
    const out = renderToStaticMarkup(<TurnTimer clock={clock(state)} />);
    expect(tag(out, "turn-timer")).toContain(`data-state="${state}"`);
    expect(out).toContain(`>${CLOCK_LABEL[state]}<`);
    const bar = tag(out, "turn-timer-bar");
    expect(bar).toContain("animation-play-state:paused");
    expect(bar).not.toContain("bg-accent");
  });

  it("offers Resume only when the player paused it", () => {
    expect(tag(renderToStaticMarkup(<TurnTimer clock={clock("paused")} />), "turn-pause")).toContain('aria-label="Resume the clock"');
    expect(tag(renderToStaticMarkup(<TurnTimer clock={clock("held")} />), "turn-pause")).toContain('aria-label="Pause the clock"');
  });

  it("names its state for a screen reader as a status", () => {
    const out = renderToStaticMarkup(<TurnTimer clock={clock("paused")} />);
    expect(tag(out, "turn-timer-state")).toContain('role="status"');
  });
});

describe("the Live controls on the board", () => {
  it("in Tactical are the switch alone", () => {
    const out = renderToStaticMarkup(<LiveControls mode="tactical" onChange={() => {}} clock={clock("off")} />);
    expect(out).toContain('data-testid="play-mode"');
    expect(out).not.toContain('data-testid="turn-timer"');
  });

  it("in Live are the switch and the timer", () => {
    const out = renderToStaticMarkup(<LiveControls mode="live" onChange={() => {}} clock={clock("running")} />);
    expect(tag(out, "play-mode")).toContain('data-mode="live"');
    expect(out).toContain('data-testid="turn-timer"');
  });
});
