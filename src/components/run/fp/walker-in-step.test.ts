// The body and the engine's node stay in step (issue 136; the review of
// issue 115's first person, finding R1-M1). Until a move is played, the
// engine judges the player on its node, so the body must stay where that is
// true. Here a node's region is the part of its room nearer it than any other
// node in that room: the area `Ground.regionOf` gives it (world.ts), worked
// out again locally so these tests do not grade the walker by its own code.
// Leaving the region must hand back the move into the neighbour's area, or
// the body is held back. The tests read only `stepWalker`'s output, the rooms
// (`roomAt`) and that local region, so a walker that lets the body drift out
// of the start node's region with no move played fails them, on each floor.
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { LevelManifest } from "@/domain";
import { createRun, neighbours, type Action, type RunState } from "@/engine";
import { placeLevel } from "@/level/placer";
import f1 from "../../../../data/levels/F1.romaine-1974.json";
import f2 from "../../../../data/levels/F2.sunset-1986.json";
import f3 from "../../../../data/levels/F3.night-desk.json";
import { RUN_SEED } from "../run-screen";
import type { Vec } from "./ground";
import { FP } from "./tuning";
import { createWalker, stepWalker, type Controls } from "./walker";
import { buildWorld, groundOf, roomAt } from "./world";

const CASES = [
  { id: "F1", cached: f1 },
  { id: "F2", cached: f2 },
  { id: "F3", cached: f3 },
] as const;

const IDLE: Controls = { forward: 0, strafe: 0, yaw: 0, use: false, usePressed: false };

function floor(id: keyof typeof FIXTURE_FLOORS, cached: unknown) {
  const placed = placeLevel(LevelManifest.parse(structuredClone(cached)), structuredClone(FIXTURE_FLOORS[id]), RUN_SEED);
  const world = buildWorld(placed.level.floor);
  // Nobody on the floor to catch the player: these tests are of the walking alone. Doors stay as the level locks them.
  const run: RunState = { ...createRun(placed.level), guards: [], cleaners: [] };
  return { world, ground: groundOf(world), run };
}

/** The rooms the body may stand in while the engine has the player on `nodeId`: that node's own, and its legal neighbours'. */
function allowedRooms(world: ReturnType<typeof buildWorld>, run: RunState, nodeId: string): Set<string> {
  const legal = neighbours(run.board, nodeId).filter((exit) => exit.doorId === undefined || !run.locked.includes(exit.doorId));
  return new Set([nodeId, ...legal.map((exit) => exit.to)].map((id) => world.nodes.get(id)!.roomId));
}

/** Whether `p` is in `nodeId`'s region: in its room, and no other node of that room nearer. */
function inRegion(world: ReturnType<typeof buildWorld>, nodeId: string, p: Vec): boolean {
  const node = world.nodes.get(nodeId)!;
  if (roomAt(world, p)?.id !== node.roomId) return false;
  const d = (q: Vec) => Math.hypot(q.x - p.x, q.y - p.y);
  return [...world.nodes.values()].every((other) => other.roomId !== node.roomId || d(node) <= d(other) + 1e-9);
}

describe("the body and the engine's node stay in step (issue 136)", () => {
  it("F1: walking from the lift straight at the dock doorway hands back the move to the lobby before the body leaves the lift's region", () => {
    const { world, ground, run } = floor("F1", f1);
    expect(run.playerNode).toBe("fl-car");
    expect(ground.nodes.get("fl-car")!.x).toBeCloseTo(2.1);
    expect(ground.nodes.get("fl-car")!.y).toBeCloseTo(2.1);
    // The lift and the lobby share one room, so only the region, not the room, tells them apart.
    const doorway: Vec = { x: 6.3, y: 2.05 };
    expect(inRegion(world, "fl-car", doorway)).toBe(false);

    let walker = createWalker(ground, run);
    let handed: Action | null = null;
    for (let i = 0; i < 12 / FP.stepS && Math.hypot(walker.pos.x - doorway.x, walker.pos.y - doorway.y) > 0.06; i++) {
      const yaw = Math.atan2(doorway.y - walker.pos.y, doorway.x - walker.pos.x);
      const out = stepWalker(walker, ground, run, { ...IDLE, forward: 1, yaw });
      walker = out.walker;
      if (out.action) {
        handed = out.action;
        break;
      }
      // No move yet: the engine still has the player on the lift, so the body must still be in its region.
      const at = `(${walker.pos.x.toFixed(2)}, ${walker.pos.y.toFixed(2)})`;
      expect(inRegion(world, "fl-car", walker.pos), `with no move played, the body left the lift's region at ${at}`).toBe(true);
    }
    // The line leaves the lift's region (the doorway is not in it), so the move to the lobby must come back.
    expect(handed).toEqual({ kind: "move", to: "fl-lobby" });
  });

  it.each(CASES)("$id: a flood fill of where the body can go from the start with no move played finds no room but the engine node's own and its legal neighbours', and never leaves its region", ({ id, cached }) => {
    const { world, ground, run } = floor(id, cached);
    const allowed = allowedRooms(world, run, run.playerNode);
    const start = createWalker(ground, run);
    // Flood over the places the body can stand: from each, a short run in each of 16 directions through the
    // walker itself. A place counts as reached only if no step on the way there handed back an action. On all
    // three floors the start's one neighbour shares its room, so rooms alone cannot see the body drift into that
    // neighbour's area: any place reached outside the start's region is also counted, as "off-region".
    const cell = (p: Vec) => `${Math.round(p.x / 0.25)},${Math.round(p.y / 0.25)}`;
    const seen = new Set([cell(start.pos)]);
    const todo: Vec[] = [start.pos];
    const reached = new Set<string>();
    while (todo.length > 0) {
      const from = todo.pop()!;
      for (let k = 0; k < 16; k++) {
        const yaw = (k / 16) * 2 * Math.PI;
        let walker = { ...start, pos: from, vel: { x: Math.cos(yaw) * FP.runMps, y: Math.sin(yaw) * FP.runMps } };
        let played = false;
        for (let i = 0; i < 7; i++) {
          const out = stepWalker(walker, ground, run, { ...IDLE, forward: 1, yaw });
          walker = out.walker;
          played = out.action !== null;
          if (played) break;
          const room = roomAt(world, walker.pos)?.id;
          if (room) reached.add(room);
          if (!inRegion(world, run.playerNode, walker.pos)) reached.add(`off-region:${room ?? "doorway"}`);
        }
        if (played || seen.has(cell(walker.pos))) continue;
        seen.add(cell(walker.pos));
        todo.push(walker.pos);
      }
    }
    // The flood did walk: the start's own room is among what it reached.
    expect(reached).toContain(world.nodes.get(run.playerNode)!.roomId);
    expect([...reached].filter((room) => !allowed.has(room))).toEqual([]);
  });
});
