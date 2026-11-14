// A scan the level can't be placed on goes to the fixture floor, and the chip
// hears of it (PR 58 review, R1-C1).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { LevelManifest, type FloorGraph } from "@/domain";
import { placeLevel, PlacementError } from "@/level/placer";
import cached from "../../../data/levels/F1.romaine-1974.json";
import { placeOrFixture } from "./scan-fallback";

const manifest = LevelManifest.parse(structuredClone(cached));
const building = { id: "F1", matterportModelId: "scan-f1" };
const place = (floor: FloorGraph) => placeLevel(manifest, floor, 7);

/** A one-room scan: an entry and one more sweep, and no room the objective can take. */
const oneRoomScan = (): FloorGraph => ({
  nodes: [
    { id: "a", x: 0, y: 0, roomId: "only", tags: ["entry"] },
    { id: "b", x: 1, y: 0, roomId: "only", tags: [] },
  ],
  edges: [{ a: "a", b: "b" }],
  rooms: [{ id: "only", label: "Hall", rect: { x: 0, y: 0, w: 2, h: 1 } }],
  sightlines: { a: ["b"], b: ["a"] },
  source: "matterport",
});

describe("placeOrFixture", () => {
  it("places a scan the level can't hold on the fixture floor, and reports the fallback once per building", async () => {
    expect(() => place(oneRoomScan())).toThrow(PlacementError);
    const report = vi.fn();
    const placedOn: FloorGraph[] = [];
    const placed = await placeOrFixture(
      building,
      oneRoomScan(),
      (floor) => {
        placedOn.push(floor);
        return place(floor);
      },
      report,
    );
    expect(placedOn.map((f) => f.source)).toEqual(["matterport", "fixture"]);
    expect(placed!.level.objective).toBe(place(structuredClone(FIXTURE_FLOORS.F1)).level.objective);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toEqual({
      service: "matterport",
      id: "matterport-unplaceable-F1",
      message: "The Matterport scan can't hold this level, so the board uses the fixture floor.",
    });
  });

  it("places a scan that holds the level on the scan itself, and reports nothing", async () => {
    const scan: FloorGraph = { ...structuredClone(FIXTURE_FLOORS.F1), source: "matterport" };
    const report = vi.fn();
    const placed = await placeOrFixture(building, scan, (floor) => ({ floor, placed: place(floor) }), report);
    expect(placed!.floor).toBe(scan);
    expect(report).not.toHaveBeenCalled();
  });

  it("throws a placement error on the fixture floor as it was: there is no floor to fall back to", async () => {
    const fixture = { ...oneRoomScan(), source: "fixture" } as FloorGraph;
    const report = vi.fn();
    await expect(placeOrFixture(building, fixture, place, report)).rejects.toThrow(PlacementError);
    expect(report).not.toHaveBeenCalled();
  });

  it("throws any other error from a scan as it was", async () => {
    const report = vi.fn();
    const boom = () => {
      throw new Error("boom");
    };
    await expect(placeOrFixture(building, oneRoomScan(), boom, report)).rejects.toThrow("boom");
    expect(report).not.toHaveBeenCalled();
  });
});

describe("every screen that places a level on a loaded floor", () => {
  // Run, Plan and the Debrief each place on the floor the adapter loads; each must go through
  // placeOrFixture, or an unplaceable scan shows the error state with the chip on LIVE.
  const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  it.each(["components/run/run-screen.tsx", "components/plan/plan-screen.tsx", "components/debrief/debrief-screen.tsx"])(
    "%s places through placeOrFixture",
    (file) => {
      const source = readFileSync(path.join(src, file), "utf8");
      expect(source).toMatch(/await placeOrFixture\(building, floor,/);
    },
  );
});
