// What the player could see from their node (issue 108): solid when the
// engine's sightlines join a piece's node to the player's, an outline when it
// is within hearing, and nothing otherwise.
import { describe, expect, it } from "vitest";
import { compileBoard } from "@/engine";
import { level } from "./testing";
import { seenFrom } from "./visibility";

const board = compileBoard(level());

describe("seenFrom", () => {
  it("is solid on the player's own node", () => {
    expect(seenFrom(board, "a1", "a1")).toBe("solid");
  });

  it("is solid when the sightlines join the two nodes", () => {
    expect(seenFrom(board, "a1", "a3")).toBe("solid");
    expect(seenFrom(board, "a3", "a1")).toBe("solid");
  });

  it("is solid when only one node's sightlines name the other", () => {
    const oneWay = compileBoard(level({ floor: { ...level().floor, sightlines: { ...level().floor.sightlines, a1: [] } } }));
    expect(seenFrom(oneWay, "a1", "a3")).toBe("solid");
  });

  it("is never solid behind a wall, however near: two hops through the door is an outline", () => {
    // b1 is 3 m from a2 and 4.2 m from a1, but in another room: no sightline.
    expect(seenFrom(board, "a1", "b1")).toBe("outline");
    expect(seenFrom(board, "a2", "b1")).toBe("outline");
  });

  it("draws nothing beyond hearing and out of sight", () => {
    expect(seenFrom(board, "a1", "b2")).toBe("hidden");
    expect(seenFrom(board, "a1", "c1")).toBe("hidden");
  });

  it("follows the level's hearing range", () => {
    const deaf = compileBoard(level({ hearing: 0 }));
    expect(seenFrom(deaf, "a1", "b1")).toBe("hidden");
    expect(seenFrom(deaf, "a1", "a3")).toBe("solid");
    const keen = compileBoard(level({ hearing: 3 }));
    expect(seenFrom(keen, "a1", "b2")).toBe("outline");
  });

  it("hears one hop further from a piece in a quiet zone, as the engine's noise carries", () => {
    const quiet = compileBoard(level({ zones: { vacant: ["b2"] }, quietZones: ["vacant"] }));
    expect(seenFrom(quiet, "a1", "b2")).toBe("outline");
  });

  it("is hidden for a node the board does not have", () => {
    expect(seenFrom(board, "a1", "nowhere")).toBe("hidden");
  });
});
