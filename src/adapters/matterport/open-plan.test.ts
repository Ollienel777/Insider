// An open-plan scan (#127): two big open rooms and no corridor, the shape a
// real office scan took on 14 November (kit building 52227: two rooms of 15
// positions). Before #127 its board placed one of two guards and no camera.
// The records are hand-written in the shape mapping.ts reads, as in
// scan-board.test.ts: no scan data is kept.
import { describe, expect, it } from "vitest";
import { LevelManifest } from "@/domain";
import { act, createRun, type Action, type RunState } from "@/engine";
import { placeLevel } from "@/level/placer";
import { quietRoute } from "@/level/quiet-route";
import cached from "../../../data/levels/F1.romaine-1974.json";
import { toFloorGraph } from "./mapping";

const v = (x: number, z: number) => ({ x, y: 1.5, z });

/**
 * Two open rooms side by side, each a 5 × 3 grid of sweeps 4 m apart, joined
 * along their shared wall. As on a real scan, every sweep lists every other
 * within 9 m as a neighbour; `toFloorGraph` prunes those to near hops (#116).
 */
function openPlan() {
  const at = new Map<string, { x: number; z: number; room: string }>();
  for (const [room, x0] of [["r-west", 0], ["r-east", 20]] as const) {
    for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) at.set(`${room}-${i}-${j}`, { x: x0 + i * 4, z: j * 4, room });
  }
  const sweeps = Object.fromEntries(
    [...at].map(([sid, p]) => [
      sid,
      {
        sid,
        uuid: `uuid-${sid}`,
        enabled: true,
        neighbors: [...at].filter(([other, q]) => other !== sid && Math.hypot(p.x - q.x, p.z - q.z) <= 9).map(([other]) => other),
        position: v(p.x, p.z),
        floorInfo: { id: "floor-a", sequence: 0 },
        roomInfo: { id: p.room },
      },
    ]),
  );
  const rooms = {
    "r-west": { id: "r-west", label: "", bounds: { min: v(-1, -1), max: v(17, 9) } },
    "r-east": { id: "r-east", label: "", bounds: { min: v(19, -1), max: v(37, 9) } },
  };
  return toFloorGraph(sweeps, rooms);
}

/** F1's level with what the real building's level asked for: two guards, two cameras, two ways in. */
function manifest() {
  const m = structuredClone(cached) as typeof cached;
  m.securityProfile.guardCount = 2;
  m.securityProfile.cameraCount = 2;
  // Two ways in, as the real level had (the roof hatch and the street lobby).
  m.entries = m.entries.filter((e) => e.kind === "roof" || e.kind === "lobby");
  return LevelManifest.parse(m);
}

const play = (run: RunState, actions: readonly Action[]) =>
  actions.reduce((state, action, i) => {
    const result = act(state, action);
    if (!result.ok) throw new Error(`action ${i} refused: ${result.reason}`);
    return result.run;
  }, run);

describe("an open-plan scan with no corridor (#127)", () => {
  const floor = openPlan();

  it("is the shape the real scan took: two big rooms, no corridor", () => {
    expect(floor.source).toBe("matterport");
    expect(floor.rooms).toHaveLength(2);
    expect(floor.nodes).toHaveLength(30);
  });

  it.each([1, 7, 21])("places every guard and camera the level asks for (seed %i)", (seed) => {
    const placed = placeLevel(manifest(), structuredClone(floor), seed);
    expect(placed.unplaced.filter((u) => /^(guard|camera):/.test(u.elementRole))).toEqual([]);
    expect(placed.guards).toHaveLength(2);
    expect(placed.cameras).toHaveLength(2);
    // Two guards never start on one node.
    expect(new Set(placed.guards.map((g) => g.patrol[0])).size).toBe(2);
    // No camera watches the start or a way in: a player is not seen before they move.
    const wayIn = new Set(placed.entries.map((e) => e.nodeId));
    for (const camera of placed.cameras) {
      expect(camera.cover).not.toContain(placed.level.start);
      for (const node of camera.cover) expect(wayIn.has(node), node).toBe(false);
    }
  });

  it.each([1, 7, 21])("still has a quiet route to the objective and out (seed %i)", (seed) => {
    const placed = placeLevel(manifest(), structuredClone(floor), seed);
    const route = quietRoute(placed);
    expect(route).not.toBeNull();
    const end = play(createRun(placed.level), route!);
    expect(end.status).toBe("won");
    expect(end.alarmEvents).toEqual([]);
  });
});
