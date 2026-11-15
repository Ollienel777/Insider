// The first-time controls hint (issue 146) goes once the player has walked and looked.
import { describe, expect, it } from "vitest";
import { HINT_FADE_MS, HINT_LOOK_RAD, HINT_WALK_M, hintDone, hintPhase, hintTicks, NO_PROGRESS } from "./hint";

describe("the controls hint", () => {
  it("stays up until the player has both walked and looked", () => {
    expect(hintDone(NO_PROGRESS)).toBe(false);
    expect(hintDone({ ...NO_PROGRESS, walkedM: HINT_WALK_M })).toBe(false);
    expect(hintDone({ ...NO_PROGRESS, lookedRad: HINT_LOOK_RAD })).toBe(false);
    expect(hintDone({ ...NO_PROGRESS, walkedM: HINT_WALK_M, lookedRad: HINT_LOOK_RAD })).toBe(true);
  });

  it("never waits on E", () => {
    expect(hintDone({ walkedM: 0.2, lookedRad: 0.1, used: true })).toBe(false);
    expect(hintDone({ walkedM: 5, lookedRad: 2, used: false })).toBe(true);
  });

  it("ticks off each control as it is tried", () => {
    expect(hintTicks({ walkedM: HINT_WALK_M, lookedRad: 0, used: true })).toEqual({ move: true, look: false, use: true });
  });

  it("fades over its length, and goes at once under reduced motion", () => {
    expect(hintPhase(null, false)).toBe("shown");
    expect(hintPhase(null, true)).toBe("shown");
    expect(hintPhase(0, false)).toBe("fading");
    expect(hintPhase(HINT_FADE_MS - 1, false)).toBe("fading");
    expect(hintPhase(HINT_FADE_MS, false)).toBe("gone");
    expect(hintPhase(0, true)).toBe("gone");
  });
});
