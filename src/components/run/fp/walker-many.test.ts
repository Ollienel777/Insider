// First person plays every legal move out of a node, however many (issue
// 118): on a live scan a junction can have more than the nine neighbours the
// board keys 1–9 (`choices` in board.ts stops at nine). The walker reads the
// engine's own adjacency, so the tenth and eleventh are walked onto like the
// first. Made-up floor: one node with eleven spokes around it.
import { describe, expect, it } from "vitest";
import type { FloorGraph } from "@/domain";
import { act, createRun, type Level, type RunState } from "@/engine";
import { choices } from "../board";
import type { Ground, GroundNode, Vec } from "./ground";
import { FP } from "./tuning";
import { createWalker, legalMoves, stepWalker, type Controls } from "./walker";

const SPOKES = 11;
const RADIUS = 3;
const spoke = (i: number) => `s${i}`;
const at = (i: number): Vec => ({ x: Math.cos((i / SPOKES) * Math.PI * 2) * RADIUS, y: Math.sin((i / SPOKES) * Math.PI * 2) * RADIUS });

function starLevel(): Level {
  const ids = ["hub", ...Array.from({ length: SPOKES }, (_, i) => spoke(i))];
  const floor: FloorGraph = {
    nodes: [
      { id: "hub", x: 0, y: 0, roomId: "hall", tags: [] },
      ...Array.from({ length: SPOKES }, (_, i) => ({ id: spoke(i), ...at(i), roomId: "hall", tags: [] })),
    ],
    edges: Array.from({ length: SPOKES }, (_, i) => ({ a: "hub", b: spoke(i) })),
    rooms: [{ id: "hall", label: "Hall", rect: { x: -RADIUS, y: -RADIUS, w: 2 * RADIUS, h: 2 * RADIUS } }],
    sightlines: Object.fromEntries(ids.map((id) => [id, []])),
    source: "matterport",
  };
  return { buildingId: "T", missionId: "t", seed: 1, floor, start: "hub", objective: spoke(0), exits: ["hub"], lockedDoors: [], pickTurns: 2, patrolTempo: 1, guards: [] };
}

/** An open floor: each point is the nearest node's, and nothing is solid. */
function openGround(level: Level): Ground {
  const nodes = new Map<string, GroundNode>(level.floor.nodes.map((n) => [n.id, { id: n.id, x: n.x, y: n.y }]));
  return {
    unitM: 1,
    nodes,
    doors: [],
    collide: (pos, vel, dt) => ({ pos: { x: pos.x + vel.x * dt, y: pos.y + vel.y * dt }, vel, pressed: [] }),
    clear: () => true,
    path: (a, b) => [nodes.get(a)!, nodes.get(b)!],
    regionOf(pos) {
      let best: string | null = null;
      let bestD = Infinity;
      for (const n of nodes.values()) {
        const d = Math.hypot(n.x - pos.x, n.y - pos.y);
        if (d < bestD) [best, bestD] = [n.id, d];
      }
      return bestD <= RADIUS * 2 ? best : null;
    },
  };
}

describe("a node with more neighbours than the board's nine keys", () => {
  it("leaves the board its nine keys, and first person every one of the eleven moves", () => {
    const run = createRun(starLevel());
    expect(choices(run)).toHaveLength(9);
    for (let i = 0; i < SPOKES; i++) expect(legalMoves(run, "hub", spoke(i))).toEqual([{ kind: "move", to: spoke(i) }]);
  });

  it("walks onto each spoke, the two past the board's nine as well, and the engine takes each move", () => {
    const level = starLevel();
    const ground = openGround(level);
    const shown = new Set(choices(createRun(level)).map((c) => c.nodeId));
    const past = Array.from({ length: SPOKES }, (_, i) => spoke(i)).filter((id) => !shown.has(id));
    expect(past).toHaveLength(SPOKES - 9);
    for (let i = 0; i < SPOKES; i++) {
      let run: RunState = createRun(level);
      let walker = createWalker(ground, run);
      const to = at(i);
      const controls: Controls = { forward: 1, strafe: 0, yaw: Math.atan2(to.y, to.x), use: false, usePressed: false };
      for (let n = 0; n < 2 / FP.stepS && run.playerNode === "hub"; n++) {
        const out = stepWalker(walker, ground, run, controls);
        walker = out.walker;
        if (!out.action) continue;
        const result = act(run, out.action);
        expect(result.ok, `the engine took ${JSON.stringify(out.action)}`).toBe(true);
        if (result.ok) run = result.run;
      }
      expect(run.playerNode).toBe(spoke(i));
    }
  });
});
