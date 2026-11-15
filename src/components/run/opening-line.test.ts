// The Run's opening line (issue 185): how to move, in the view the run is played in.
import { describe, expect, it } from "vitest";
import { openingLine } from "./run-screen";

describe("the Run's opening line", () => {
  it("on the board, says to pick a number, as it always has", () => {
    expect(openingLine("Loading dock", false)).toBe("You're in at the loading dock. Pick a number to move.");
  });

  it("in first person, says what moves the player, and no number", () => {
    const line = openingLine("Roof hatch", true);
    expect(line).toBe("You're in at the roof hatch. W to walk, the mouse to look.");
    expect(line).not.toMatch(/number/);
  });
});
