// The first-person world (issue 115) on the three fixture floors: every edge
// between rooms gets a doorway, the walls are shut everywhere else, and a
// locked door closes its doorway until the run's own list opens it.
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import type { FloorGraph } from "@/domain";
import { blocked, distanceTo } from "./motion";
import { FP } from "./tuning";
import { buildWorld, edgePath, onFloor, openingBetween, regionAt, roomAt, solids, type Vec, type World } from "./world";

const FLOORS = ["F1", "F2", "F3"] as const;

/** The rooms a body of the player's size can reach from `start`, by flood fill on a 0.15 m grid. */
function roomsReached(world: World, locked: readonly string[], start: Vec): Set<string> {
  const cell = 0.15;
  const walls = solids(world, locked);
  const cols = Math.ceil(world.bounds.w / cell) + 1;
  const rows = Math.ceil(world.bounds.h / cell) + 1;
  const at = (c: number, r: number): Vec => ({ x: world.bounds.x + c * cell, y: world.bounds.y + r * cell });
  const free = (p: Vec) => onFloor(world, p) && walls.every((s) => distanceTo(s, p) >= FP.radiusM);
  const seen = new Uint8Array(cols * rows);
  const c0 = Math.round((start.x - world.bounds.x) / cell);
  const r0 = Math.round((start.y - world.bounds.y) / cell);
  const queue: [number, number][] = [[c0, r0]];
  seen[r0 * cols + c0] = 1;
  const rooms = new Set<string>();
  while (queue.length > 0) {
    const [c, r] = queue.pop()!;
    const room = roomAt(world, at(c, r));
    if (room) rooms.add(room.id);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows || seen[nr * cols + nc]) continue;
      seen[nr * cols + nc] = 1;
      if (free(at(nc, nr))) queue.push([nc, nr]);
    }
  }
  return rooms;
}

/** The rooms the floor graph reaches from `startNode` with the `locked` doors' edges taken out. */
function roomsByGraph(floor: FloorGraph, locked: readonly string[], startNode: string): Set<string> {
  const roomOf = new Map(floor.nodes.map((n) => [n.id, n.roomId]));
  const reached = new Set([startNode]);
  const queue = [startNode];
  while (queue.length > 0) {
    const here = queue.shift()!;
    for (const edge of floor.edges) {
      if (edge.door && locked.includes(edge.door.id)) continue;
      const next = edge.a === here ? edge.b : edge.b === here ? edge.a : null;
      if (next && !reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }
  return new Set([...reached].map((id) => roomOf.get(id)!));
}

describe.each(FLOORS)("the first-person world of %s", (id) => {
  const floor = FIXTURE_FLOORS[id];
  const world = buildWorld(floor);
  const lockable = floor.edges.flatMap((e) => (e.door?.lockable ? [e.door.id] : []));
  const start = world.nodes.get(floor.nodes[0].id)!;

  it("cuts a doorway for every edge between two rooms, and nowhere else", () => {
    const roomOf = new Map(floor.nodes.map((n) => [n.id, n.roomId]));
    const crossing = floor.edges.filter((e) => roomOf.get(e.a) !== roomOf.get(e.b));
    expect(world.unplaced).toEqual([]);
    expect(world.openings).toHaveLength(crossing.length);
    for (const edge of crossing) {
      const opening = openingBetween(world, edge.a, edge.b)!;
      expect(opening, `${edge.a}–${edge.b}`).not.toBeNull();
      expect(opening.doorId).toBe(edge.door?.id ?? null);
      expect(opening.width).toBeGreaterThanOrEqual(2 * FP.radiusM + 0.1);
    }
  });

  it("leaves each doorway open from one room to the other, and shuts it while its door is locked", () => {
    for (const opening of world.openings) {
      const name = `${opening.a}–${opening.b}`;
      expect(roomAt(world, opening.sideA)?.id, name).toBe(opening.roomA);
      expect(roomAt(world, opening.sideB)?.id, name).toBe(opening.roomB);
      expect(blocked(solids(world, []), opening.sideA, opening.sideB), name).toBe(false);
      if (opening.doorId !== null) {
        expect(blocked(solids(world, [opening.doorId]), opening.sideA, opening.sideB), name).toBe(true);
      }
    }
  });

  it("gives every edge a way to walk it that no wall crosses", () => {
    const walls = solids(world, []);
    for (const edge of floor.edges) {
      for (const [a, b] of [[edge.a, edge.b], [edge.b, edge.a]]) {
        const path = edgePath(world, a, b);
        expect(path[0]).toEqual({ x: world.nodes.get(a)!.x, y: world.nodes.get(a)!.y });
        expect(path.at(-1)).toEqual({ x: world.nodes.get(b)!.x, y: world.nodes.get(b)!.y });
        for (let i = 1; i < path.length; i++) expect(blocked(walls, path[i - 1], path[i]), `${a}→${b} leg ${i}`).toBe(false);
      }
    }
  });

  it("stands every node on the floor with room for the player's body", () => {
    const walls = solids(world, lockable);
    for (const node of world.nodes.values()) {
      expect(roomAt(world, node)?.id, node.id).toBe(node.roomId);
      for (const wall of walls) expect(distanceTo(wall, node), node.id).toBeGreaterThan(FP.radiusM);
    }
  });

  it("has no way between rooms but the doorways: with every door open, a body reaches every room", () => {
    expect([...roomsReached(world, [], start)].sort()).toEqual(floor.rooms.map((r) => r.id).sort());
  });

  it("has no way round a locked door: a body reaches only the rooms the graph reaches without it", () => {
    expect(lockable.length).toBeGreaterThan(0);
    const byGraph = roomsByGraph(floor, lockable, floor.nodes[0].id);
    expect(byGraph.size).toBeLessThan(floor.rooms.length);
    expect([...roomsReached(world, lockable, start)].sort()).toEqual([...byGraph].sort());
  });
});

describe.each(FLOORS)("the areas of %s", (id) => {
  const world = buildWorld(FIXTURE_FLOORS[id]);
  const cell = 0.1;
  const cols = Math.ceil(world.bounds.w / cell) + 1;
  const rows = Math.ceil(world.bounds.h / cell) + 1;
  // Points between grid lines, so none sits exactly on a wall's line.
  const at = (c: number, r: number): Vec => ({ x: world.bounds.x + (c + 0.5) * cell, y: world.bounds.y + (r + 0.5) * cell });
  /** Every grid point on the floor, with the area it is in. */
  const grid: (string | null)[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) grid.push(onFloor(world, at(c, r)) ? regionAt(world, at(c, r)) : null);

  it("puts every point of the floor in exactly one node's area, a node it can reach without crossing a wall", () => {
    const walls = solids(world, []);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const p = at(c, r);
        if (!onFloor(world, p)) continue;
        const region = grid[r * cols + c];
        expect(region, `${p.x},${p.y}`).not.toBeNull();
        const node = world.nodes.get(region!)!;
        const room = roomAt(world, p);
        if (room) {
          expect(node.roomId).toBe(room.id);
          expect(blocked(walls, p, node), `${p.x},${p.y} → ${node.id}`).toBe(false);
        } else {
          const opening = world.openings.find((o) => p.x >= o.passage.x - 1e-6 && p.x <= o.passage.x + o.passage.w + 1e-6 && p.y >= o.passage.y - 1e-6 && p.y <= o.passage.y + o.passage.h + 1e-6)!;
          expect([opening.roomA, opening.roomB]).toContain(node.roomId);
        }
      }
    }
  });

  it("gives every node an area that holds the node and is in one piece", () => {
    for (const node of world.nodes.values()) {
      expect(regionAt(world, node)).toBe(node.id);
      const cells = grid.flatMap((region, i) => (region === node.id ? [i] : []));
      const seen = new Set([cells[0]]);
      const queue = [cells[0]];
      while (queue.length > 0) {
        const i = queue.pop()!;
        const c = i % cols;
        const r = (i - c) / cols;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nc = c + dc;
          const nr = r + dr;
          const j = nr * cols + nc;
          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows || seen.has(j) || grid[j] !== node.id) continue;
          seen.add(j);
          queue.push(j);
        }
      }
      expect(seen.size, node.id).toBe(cells.length);
    }
  });
});

describe("the first-person world", () => {
  it("opens the whole shared wall where an edge joins two rooms with no door", () => {
    const world = buildWorld({
      source: "fixture",
      rooms: [
        { id: "west", label: "West", rect: { x: 0, y: 0, w: 10, h: 10 } },
        { id: "east", label: "East", rect: { x: 10, y: 2, w: 10, h: 6 } },
      ],
      nodes: [
        { id: "w", x: 5, y: 5, roomId: "west", tags: [] },
        { id: "e", x: 15, y: 5, roomId: "east", tags: [] },
      ],
      edges: [{ a: "w", b: "e" }],
      sightlines: {},
    });
    const [opening] = world.openings;
    expect(opening.doorId).toBeNull();
    // The shared wall is the east room's 6 units, less the walls' own thickness and margin.
    expect(opening.width).toBeCloseTo(6 * FP.unitM - 2 * (FP.wallHalfM + 0.05));
    expect(blocked(solids(world, []), world.nodes.get("w")!, world.nodes.get("e")!)).toBe(false);
  });

  it("puts a door between rooms a thick wall apart, with a longer way through", () => {
    const world = buildWorld({
      source: "fixture",
      rooms: [
        { id: "north", label: "North", rect: { x: 0, y: 0, w: 10, h: 5 } },
        { id: "south", label: "South", rect: { x: 0, y: 6, w: 10, h: 5 } },
      ],
      nodes: [
        { id: "n", x: 5, y: 2, roomId: "north", tags: [] },
        { id: "s", x: 5, y: 8, roomId: "south", tags: [] },
      ],
      edges: [{ a: "n", b: "s", door: { id: "d", lockable: true } }],
      sightlines: {},
    });
    const [opening] = world.openings;
    expect(opening.axis).toBe("y");
    expect(opening.passage.h).toBeCloseTo(1 * FP.unitM + 2 * FP.wallHalfM);
    expect(opening.width).toBe(FP.doorWidthM);
    expect(opening.centre.x).toBeCloseTo(5 * FP.unitM);
    expect(onFloor(world, opening.centre)).toBe(true);
  });
});
