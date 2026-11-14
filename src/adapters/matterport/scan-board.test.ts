// A scan from end to end (PR 58 review): the SDK's sweep and room records,
// through toFloorGraph, the placer and the engine, to a run that can be played,
// with a lock to pick on the way to the files. The records are hand-written in
// the shape mapping.ts reads (as in live.test.ts): no scan data is kept.
import { describe, expect, it } from "vitest";
import { LevelManifest, type FloorGraph } from "@/domain";
import { act, createRun } from "@/engine";
import { placeLevel } from "@/level/placer";
import cached from "../../../data/levels/F1.romaine-1974.json";
import { toFloorGraph } from "./mapping";

const manifest = LevelManifest.parse(structuredClone(cached));
const v = (x: number, z: number) => ({ x, y: 1.5, z });
const room = (id: string, label: string, x0: number, z0: number, x1: number, z1: number) => ({
  id,
  label,
  bounds: { min: v(x0, z0), max: v(x1, z1) },
});

/**
 * One office floor: a freight lift and a stair at either end of an unlabelled
 * corridor, unlabelled offices of different sizes off it to the north, and an
 * open floor to the south. Only the lift and the stair have the scan's own labels.
 */
function scan(): { sweeps: Record<string, unknown>; rooms: Record<string, unknown> } {
  const links: [string, string][] = [];
  const at = new Map<string, { x: number; z: number; room: string }>();
  const add = (sid: string, x: number, z: number, roomId: string) => at.set(sid, { x, z, room: roomId });
  const link = (a: string, b: string) => links.push([a, b]);

  add("lift", -3, 0, "r-lift");
  for (let i = 0; i < 8; i++) add(`c${i}`, i * 3, 0, "r-corridor");
  add("stair", 24, 0, "r-stair");
  link("lift", "c0");
  for (let i = 0; i < 7; i++) link(`c${i}`, `c${i + 1}`);
  link("c7", "stair");

  // North: three offices of different sizes, each with its own door off the corridor.
  add("a1", 1, 4, "r-north-a");
  add("a2", 3, 6, "r-north-a");
  link("c1", "a1");
  link("a1", "a2");
  add("b1", 9, 4, "r-north-b");
  add("b2", 11, 5, "r-north-b");
  add("b3", 10, 8, "r-north-b");
  link("c3", "b1");
  link("b1", "b2");
  link("b2", "b3");
  add("d1", 18, 4, "r-north-d");
  link("c6", "d1");

  // South: an open floor, reached from both ends of the corridor.
  for (const [i, [x, z]] of [[2, -5], [8, -5], [14, -5], [20, -5], [8, -10], [14, -10]].entries()) add(`o${i}`, x, z, "r-open");
  link("c1", "o0");
  link("o0", "o1");
  link("o1", "o2");
  link("o2", "o3");
  link("o3", "c7");
  link("o1", "o4");
  link("o4", "o5");
  link("o5", "o2");

  const neighbours = new Map<string, string[]>();
  for (const [a, b] of links) {
    neighbours.set(a, [...(neighbours.get(a) ?? []), b]);
    neighbours.set(b, [...(neighbours.get(b) ?? []), a]);
  }
  const sweeps = Object.fromEntries(
    [...at].map(([sid, { x, z, room: roomId }]) => [
      sid,
      {
        sid,
        uuid: `uuid-${sid}`,
        enabled: true,
        neighbors: neighbours.get(sid) ?? [],
        position: v(x, z),
        floorInfo: { id: "floor-a", sequence: 0 },
        roomInfo: { id: roomId },
      },
    ]),
  );
  const rooms = Object.fromEntries(
    [
      room("r-lift", "Freight Elevator", -4, -1, -2, 1),
      room("r-corridor", "", -1, -1, 22, 1),
      room("r-stair", "Stairwell", 23, -1, 25, 1),
      room("r-north-a", "", 0, 2, 4, 7),
      room("r-north-b", "", 8, 2, 13, 9),
      room("r-north-d", "", 16, 2, 20, 6),
      room("r-open", "", 0, -12, 22, -2),
    ].map((r) => [r.id, r]),
  );
  return { sweeps, rooms };
}

/** Whether `to` can be reached from `from` without passing a door in `shut`. */
function reachable(floor: FloorGraph, from: string, to: string, shut: ReadonlySet<string>): boolean {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (id === to) return true;
    for (const e of floor.edges) {
      if (e.door && shut.has(e.door.id)) continue;
      const next = e.a === id ? e.b : e.b === id ? e.a : null;
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

describe("a scanned floor, from the SDK's records to a run (PR 58 review)", () => {
  const { sweeps, rooms } = scan();
  const floor = toFloorGraph(sweeps, rooms);
  const input = structuredClone(floor);
  const placed = placeLevel(manifest, input, 7);
  const { level } = placed;

  it("maps every scan door as one the scan cannot say is lockable", () => {
    expect(floor.source).toBe("matterport");
    const doors = floor.edges.filter((e) => e.door);
    expect(doors.length).toBeGreaterThan(0);
    expect(doors.every((e) => e.door!.lockable === false)).toBe(true);
  });

  it("places a level with a way in, an objective, guards and a lock on every door into the objective's room", () => {
    expect(placed.entries.length).toBeGreaterThan(0);
    expect(level.guards.length).toBeGreaterThan(0);
    const objectiveZone = placed.zones.find((z) => z.role === "objective")!;
    const inside = new Set(objectiveZone.nodes);
    const intoObjective = level.floor.edges.filter((e) => e.door && inside.has(e.a) !== inside.has(e.b)).map((e) => e.door!.id);
    expect(intoObjective.length).toBeGreaterThan(0);
    for (const id of intoObjective) expect(level.lockedDoors, id).toContain(id);
    // The level's floor marks them lockable, as the engine requires of a locked door.
    const lockable = new Map(level.floor.edges.filter((e) => e.door).map((e) => [e.door!.id, e.door!.lockable]));
    for (const id of level.lockedDoors) expect(lockable.get(id), id).toBe(true);
    // The floor passed in is left as the scan made it.
    expect(input).toEqual(floor);
  });

  it("keeps the files behind the lock: no way to them from the start but through a locked door", () => {
    expect(reachable(level.floor, level.start, level.objective, new Set(level.lockedDoors))).toBe(false);
    expect(reachable(level.floor, level.start, level.objective, new Set())).toBe(true);
  });

  it("locks each door once, however many locked rooms it borders", () => {
    expect(new Set(level.lockedDoors).size).toBe(level.lockedDoors.length);
    expect(new Set(placed.locks.map((l) => l.doorId)).size).toBe(placed.locks.length);
  });

  it("starts a run on it, and a pick at the objective's door opens it after the era's turns", () => {
    let run = createRun(level);
    expect(run.status).toBe("playing");
    expect([...run.locked].sort()).toEqual([...level.lockedDoors].sort());
    // Stand the player at the outside end of a locked door into the objective's room, and pick it.
    const inside = new Set(placed.zones.find((z) => z.role === "objective")!.nodes);
    const edge = level.floor.edges.find((e) => e.door && level.lockedDoors.includes(e.door.id) && inside.has(e.a) !== inside.has(e.b))!;
    const outside = inside.has(edge.a) ? edge.b : edge.a;
    run = { ...run, playerNode: outside };
    for (let i = 0; i < level.pickTurns; i++) {
      const result = act(run, { kind: "pick", doorId: edge.door!.id });
      expect(result.ok, result.ok ? "" : result.reason).toBe(true);
      if (!result.ok) return;
      run = result.run;
      if (run.status !== "playing") throw new Error(`run ended (${run.status}) while picking`);
    }
    expect(run.locked).not.toContain(edge.door!.id);
  });
});
