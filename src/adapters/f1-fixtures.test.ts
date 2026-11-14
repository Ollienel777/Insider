// F1's two fixtures name the same stairs (#21, from the PR #52 review): the
// Vexcel aerial's entry notes and labels, and the Matterport floor's stair
// rooms. The Why card shows Vexcel's words beside the floor's rooms, so a
// stair called A in one and B in the other would be a false claim on screen.
import { describe, expect, it } from "vitest";
import { F1_DEMO, FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { FIXTURE_AERIALS } from "@/adapters/vexcel/fake";

const floor = FIXTURE_FLOORS.F1;
const aerial = FIXTURE_AERIALS.get("F1")!;

/** The stair letter a text names ("stair A", "Stair B exit"), or null. */
const stairIn = (text: string): string | null => /\bstair ([A-Z])\b/i.exec(text)?.[1].toUpperCase() ?? null;

/** The floor's stair rooms by letter: "West Stair (Stair B)" → B. */
const stairRooms = new Map(
  floor.rooms.flatMap((room) => {
    const letter = /\(Stair ([A-Z])\)/.exec(room.label)?.[1];
    return letter ? [[letter, room] as const] : [];
  }),
);

describe("F1's Vexcel aerial and Matterport floor agree on the stairs", () => {
  it("names two lettered stairs on the floor, one west and one east", () => {
    expect([...stairRooms.keys()].sort()).toEqual(["A", "B"]);
    expect([...stairRooms.values()].map((r) => r.label.split(" ")[0]).sort()).toEqual(["East", "West"]);
  });

  it("puts the roof hatch into the stair the floor's roof entry comes up", () => {
    const roof = aerial.entries.find((e) => e.kind === "roof")!;
    const letter = stairIn(roof.note);
    expect(letter, roof.note).not.toBeNull();
    const roofRoom = floor.nodes.find((n) => n.id === F1_DEMO.roofEntry)!.roomId;
    expect(stairRooms.get(letter!)?.id).toBe(roofRoom);
  });

  it("puts the west-face stair exit on the floor's west stair", () => {
    const exit = aerial.entries.find((e) => e.view === "W" && stairIn(e.label))!;
    expect(exit, "a west-face stair exit").toBeDefined();
    const letter = stairIn(exit.label)!;
    expect(stairIn(exit.note), "its label and note name the same stair").toBe(letter);
    expect(stairRooms.get(letter)?.label).toMatch(/^West Stair/);
  });

  it("names no stair on the aerial that the floor does not have", () => {
    for (const entry of aerial.entries) {
      for (const text of [entry.label, entry.note]) {
        const letter = stairIn(text);
        if (letter) expect(stairRooms.has(letter), text).toBe(true);
      }
    }
  });
});
