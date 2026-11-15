// The end of a first-person run, in words (issue 157), on a made-up level.
import { describe, expect, it } from "vitest";
import type { RunState } from "@/engine";
import type { PlacedLevel } from "@/level/placer";
import { endState } from "./end-state";

const placed = {
  level: {
    missionId: "romaine-1974",
    floor: {
      nodes: [
        { id: "a", roomId: "hall" },
        { id: "b", roomId: "dock" },
      ],
      rooms: [
        { id: "hall", label: "Corridor" },
        { id: "dock", label: "Loading dock" },
      ],
    },
  },
  entries: [{ nodeId: "b", label: "Loading dock", entryId: "dock" }],
  zones: [{ zoneId: "z1", name: "Corridor", roomIds: ["hall"] }],
} as unknown as PlacedLevel;

const run = (over: Partial<RunState>): RunState =>
  ({ status: "playing", turn: 6, playerNode: "a", alarm: "calm", alarmEvents: [], guards: [], ...over }) as unknown as RunState;

describe("the end of a first-person run", () => {
  it("says nothing while the run is played", () => {
    expect(endState(placed, run({}))).toBeNull();
  });

  it("names the room of a capture, who saw the player there, and who reached them", () => {
    const end = endState(
      placed,
      run({
        status: "caught",
        alarm: "lockdown",
        alarmEvents: [
          { turn: 2, from: "calm", to: "alert", lastKnownZone: "z1", cause: { kind: "camera", id: "C1" } },
          { turn: 4, from: "alert", to: "lockdown", lastKnownZone: "z1", cause: { kind: "guard", id: "G2" } },
        ],
        guards: [
          { id: "G2", nodeId: "a" },
          { id: "G3", nodeId: "b" },
        ] as unknown as RunState["guards"],
      }),
    );
    expect(end).toEqual({ outcome: "caught", headline: "Caught in the Corridor.", detail: "Camera C1 saw you in the Corridor. G2 reached you." });
  });

  it("says which way out a win took, and how long", () => {
    expect(endState(placed, run({ status: "won", playerNode: "b", turn: 14, carrying: true }))).toEqual({
      outcome: "won",
      headline: "Out with the files.",
      detail: "Out through the loading dock in 14 turns.",
    });
  });
});
