// Free movement mapped onto engine moves (issue 115), on the cached levels
// placed on the three fixture floors as the Run screen places them. A bot
// walks the floor with the same controls a player has (a yaw and a forward
// key); every action comes out of `stepWalker` and goes into the engine's
// `act`, which must accept it.
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { LevelManifest } from "@/domain";
import { act, createRun, type Action, type RunState } from "@/engine";
import { placeLevel } from "@/level/placer";
import { quietRoute } from "@/level/quiet-route";
import f1 from "../../../../data/levels/F1.romaine-1974.json";
import f2 from "../../../../data/levels/F2.sunset-1986.json";
import f3 from "../../../../data/levels/F3.night-desk.json";
import { choices } from "../board";
import { RUN_SEED } from "../run-screen";
import type { Ground, Vec } from "./ground";
import { FP } from "./tuning";
import { createWalker, nearestNode, nodeUnderfoot, promptFor, reconcile, stepWalker, type Controls, type Walker } from "./walker";
import { buildWorld, groundOf, openingBetween, type World } from "./world";

const CASES = [
  { id: "F1", cached: f1 },
  { id: "F2", cached: f2 },
  { id: "F3", cached: f3 },
] as const;

const IDLE: Controls = { forward: 0, strafe: 0, walk: false, yaw: 0, interact: false };
const distance = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

/** The walker, the engine's run, and every action the walker has handed back, in order. */
interface Session {
  world: World;
  ground: Ground;
  walker: Walker;
  run: RunState;
  played: Action[];
}

function session(world: World, run: RunState): Session {
  const ground = groundOf(world);
  return { world, ground, walker: createWalker(ground, run), run, played: [] };
}

/** One step. An action handed back is played through the engine, which must accept it. */
function step(s: Session, controls: Controls): void {
  const { walker, action } = stepWalker(s.walker, s.ground, s.run, controls);
  s.walker = walker;
  if (!action) return;
  const result = act(s.run, action);
  if (!result.ok) throw new Error(`the engine refused ${JSON.stringify(action)}: ${result.reason}`);
  s.run = result.run;
  s.played.push(action);
}

/** Runs (or walks) straight at `target` until within 6 cm of it, or `seconds` pass. */
function walkTo(s: Session, target: Vec, { walk = false, seconds = 12 } = {}): void {
  for (let i = 0; i < seconds / FP.stepS && distance(s.walker.pos, target) > 0.06; i++) {
    const yaw = Math.atan2(target.y - s.walker.pos.y, target.x - s.walker.pos.x);
    const near = distance(s.walker.pos, target) < 0.4;
    step(s, { forward: 1, strafe: 0, walk: walk || near, yaw, interact: false });
  }
}

/** Walks the engine's edge from the walker's node to `to`, through its doorway if it has one. */
function walkEdge(s: Session, from: string, to: string): void {
  for (const point of s.ground.path(from, to).slice(1)) walkTo(s, point);
}

function rest(s: Session, steps = 30): void {
  for (let i = 0; i < steps; i++) step(s, IDLE);
}

describe.each(CASES)("free movement on $id", ({ id, cached }) => {
  const placed = placeLevel(LevelManifest.parse(structuredClone(cached)), structuredClone(FIXTURE_FLOORS[id]), RUN_SEED);
  const world = buildWorld(placed.level.floor);
  const fresh = () => createRun(placed.level);
  /** The same run with nobody on the floor to catch the player, for the tests of the walking alone. */
  const empty = (): RunState => ({ ...fresh(), guards: [], cleaners: [] });

  it("walks the quiet route node to node, handing the engine exactly its moves, picks and take, in order", () => {
    const route = quietRoute(placed)!;
    expect(route).not.toBeNull();
    const s = session(world, fresh());
    const waited: number[] = [];
    route.forEach((expected, i) => {
      const before = s.played.length;
      if (expected.kind === "move") {
        walkEdge(s, s.run.playerNode, expected.to);
      } else if (expected.kind === "pick") {
        const opening = world.openings.find((o) => o.doorId === expected.doorId)!;
        walkTo(s, opening.a === s.run.playerNode ? opening.sideA : opening.sideB);
        // Lean on the door until the engine has been handed one pick.
        for (let n = 0; n < 2 / FP.stepS && s.played.length === before; n++) {
          const yaw = Math.atan2(opening.centre.y - s.walker.pos.y, opening.centre.x - s.walker.pos.x);
          step(s, { forward: 1, strafe: 0, walk: false, yaw, interact: false });
        }
      } else if (expected.kind === "take") {
        step(s, { ...IDLE, interact: true });
      } else if (expected.kind === "wait") {
        // A wait is the Run screen's (a key, or the turn clock): the walker stands through it and hands back nothing.
        const result = act(s.run, expected);
        if (!result.ok) throw new Error(result.reason);
        s.run = result.run;
        waited.push(i);
        rest(s);
        expect(s.played.length, `step ${i}: standing still played something`).toBe(before);
        return;
      }
      expect(s.played.slice(before), `step ${i}: ${JSON.stringify(expected)}`).toEqual([expected]);
    });
    expect(s.played).toEqual(route.filter((a) => a.kind !== "wait"));
    expect(s.run.status).toBe("won");
    expect(s.run.alarmEvents).toEqual([]);
    expect(s.run.turn).toBe(route.length);
    expect(s.run.turns.map((t) => t.player.kind)).toEqual(route.map((a) => a.kind));
  });

  it("walks every edge of the floor both ways, each one a single engine move", () => {
    for (const edge of placed.level.floor.edges) {
      for (const [from, to] of [[edge.a, edge.b], [edge.b, edge.a]]) {
        // The engine's own state, with the player stood on `from` and every door open.
        const s = session(world, { ...empty(), playerNode: from, locked: [] });
        walkEdge(s, from, to);
        expect(s.played, `${from} → ${to}`).toEqual([{ kind: "move", to }]);
        expect(s.run.playerNode).toBe(to);
        expect(distance(s.walker.pos, world.nodes.get(to)!)).toBeLessThan(0.1);
      }
    }
  });

  it("stops at a locked door: leaning on it picks it, turn by turn, and only then does the way open", () => {
    const run0 = empty();
    const doorId = run0.locked[0];
    const opening = world.openings.find((o) => o.doorId === doorId)!;
    const picks = choices({ ...run0, playerNode: opening.a }).find((c) => c.doorId === doorId)!.progress!.of;
    const s = session(world, { ...run0, playerNode: opening.a });
    const far = world.nodes.get(opening.b)!;
    walkTo(s, opening.sideA);
    // Straight at the room beyond: the door holds, and every action handed back is a pick of it.
    for (let n = 0; n < (picks + 1) * FP.pickEveryS / FP.stepS && s.run.locked.includes(doorId); n++) {
      const yaw = Math.atan2(opening.centre.y - s.walker.pos.y, opening.centre.x - s.walker.pos.x);
      step(s, { forward: 1, strafe: 0, walk: false, yaw, interact: false });
      if (s.run.locked.includes(doorId)) {
        const across = opening.axis === "x" ? "x" : "y";
        const side = Math.sign(opening.sideA[across] - opening.centre[across]);
        expect(Math.sign(s.walker.pos[across] - opening.centre[across])).toBe(side);
      }
    }
    expect(s.played).toEqual(Array.from({ length: picks }, () => ({ kind: "pick", doorId })));
    expect(s.run.locked).not.toContain(doorId);
    expect(s.run.turn).toBe(picks);
    walkEdge(s, opening.a, opening.b);
    expect(s.played.at(-1)).toEqual({ kind: "move", to: opening.b });
    expect(distance(s.walker.pos, far)).toBeLessThan(0.1);
  });

  it("picks a locked door with E when facing it from the engine's node, and not when facing away", () => {
    const run0 = fresh();
    const doorId = run0.locked[0];
    const opening = world.openings.find((o) => o.doorId === doorId)!;
    const s = session(world, { ...run0, playerNode: opening.a });
    walkTo(s, opening.sideA);
    const yaw = Math.atan2(opening.centre.y - s.walker.pos.y, opening.centre.x - s.walker.pos.x);
    expect(promptFor(s.walker, s.ground, s.run, yaw)).toMatchObject({ kind: "pick", doorId, done: 0 });
    expect(promptFor(s.walker, s.ground, s.run, yaw + Math.PI)).toBeNull();
    step(s, { ...IDLE, yaw: yaw + Math.PI, interact: true });
    expect(s.played).toEqual([]);
    step(s, { ...IDLE, yaw, interact: true });
    expect(s.played).toEqual([{ kind: "pick", doorId }]);
  });

  it("says a locked door cannot be picked from a node the engine does not have beside it", () => {
    const run0 = fresh();
    const doorId = run0.locked[0];
    const opening = world.openings.find((o) => o.doorId === doorId)!;
    // The engine has the player on a node with no edge through this door.
    const elsewhere = placed.level.floor.nodes.find((n) => n.id !== opening.a && n.id !== opening.b)!.id;
    const s = session(world, { ...run0, playerNode: elsewhere });
    s.walker = { ...s.walker, pos: { ...opening.sideA } };
    const yaw = Math.atan2(opening.centre.y - s.walker.pos.y, opening.centre.x - s.walker.pos.x);
    expect(promptFor(s.walker, s.ground, s.run, yaw)).toEqual({ kind: "locked", doorId });
    for (let n = 0; n < 120; n++) step(s, { forward: 1, strafe: 0, walk: false, yaw, interact: n === 0 });
    expect(s.played.filter((a) => a.kind === "pick")).toEqual([]);
  });

  it("hands back nothing at a node that is not a legal move, until the player reaches one that is", () => {
    const run0 = fresh();
    const board = run0.board;
    // A node two hops from the start: not a neighbour, so not a move.
    const first = choices({ ...run0, locked: [] })[0].nodeId;
    const second = choices({ ...run0, locked: [], playerNode: first }).find(
      (c) => c.nodeId !== run0.playerNode && !board.adjacency.get(run0.playerNode)!.some((e) => e.to === c.nodeId),
    )!.nodeId;
    const s = session(world, { ...run0, locked: [] });
    s.walker = { ...s.walker, pos: { x: world.nodes.get(second)!.x, y: world.nodes.get(second)!.y } };
    rest(s, 60);
    expect(nodeUnderfoot(s.ground, s.run, s.walker.pos)).toBe(second);
    expect(s.played).toEqual([]);
    expect(s.run.playerNode).toBe(run0.playerNode);
    // Back to a neighbour of the engine's node: that one is a move.
    walkEdge(s, second, first);
    expect(s.played).toEqual([{ kind: "move", to: first }]);
  });

  it("plays a move once: standing on the node it arrived at hands back nothing more", () => {
    const s = session(world, { ...fresh(), locked: [] });
    const to = choices(s.run)[0].nodeId;
    walkEdge(s, s.run.playerNode, to);
    rest(s, 240);
    expect(s.played).toEqual([{ kind: "move", to }]);
  });

  it("goes back to the engine's node when the engine says the player is somewhere else", () => {
    const s = session(world, { ...fresh(), locked: [] });
    const start = s.run.playerNode;
    const to = choices(s.run)[0].nodeId;
    walkEdge(s, start, to);
    // A restart: turn 0 again, at the start.
    s.run = { ...fresh(), locked: [] };
    rest(s, 1);
    expect(s.walker.pos).toEqual({ x: world.nodes.get(start)!.x, y: world.nodes.get(start)!.y });
    expect(s.walker.vel).toEqual({ x: 0, y: 0 });
    // A number key: the engine moved the player without the walker.
    const hop = act(s.run, { kind: "move", to });
    if (!hop.ok) throw new Error(hop.reason);
    s.run = hop.run;
    rest(s, 1);
    expect(s.walker.node).toBe(to);
    expect(distance(s.walker.pos, world.nodes.get(to)!)).toBeLessThan(1e-9);
    expect(s.played).toEqual([{ kind: "move", to }]);
  });

  it("stays put through a turn that left the player where they were (a wait from the clock)", () => {
    const s = session(world, { ...fresh(), locked: [] });
    const target = s.ground.path(s.run.playerNode, choices(s.run)[0].nodeId)[1];
    for (let i = 0; i < 20; i++) step(s, { forward: 1, strafe: 0, walk: true, yaw: Math.atan2(target.y - s.walker.pos.y, target.x - s.walker.pos.x), interact: false });
    const pos = s.walker.pos;
    const waited = act(s.run, { kind: "wait" });
    if (!waited.ok) throw new Error(waited.reason);
    expect(reconcile(s.walker, s.ground, waited.run).pos).toBe(pos);
    expect(reconcile(s.walker, s.ground, waited.run).turn).toBe(1);
  });

  it("offers a move again after the engine did not answer it, once the player has stepped off and back", () => {
    const s = session(world, { ...fresh(), locked: [] });
    const to = choices(s.run)[0].nodeId;
    const handed: Action[] = [];
    const drive = (target: Vec, seconds: number) => {
      for (let i = 0; i < seconds / FP.stepS && distance(s.walker.pos, target) > 0.06; i++) {
        const yaw = Math.atan2(target.y - s.walker.pos.y, target.x - s.walker.pos.x);
        // The engine never answers: the run stays as it was.
        const out = stepWalker(s.walker, s.ground, s.run, { forward: 1, strafe: 0, walk: false, yaw, interact: false });
        s.walker = out.walker;
        if (out.action) handed.push(out.action);
      }
    };
    const path = s.ground.path(s.run.playerNode, to);
    for (const point of path.slice(1)) drive(point, 12);
    for (let i = 0; i < 2 / FP.stepS; i++) s.walker = stepWalker(s.walker, s.ground, s.run, IDLE).walker;
    expect(handed).toEqual([{ kind: "move", to }]);
    expect(s.walker.refused).toBe(to);
    drive(path[0], 12);
    expect(s.walker.refused).toBeNull();
    for (const point of path.slice(1)) drive(point, 12);
    expect(handed).toEqual([{ kind: "move", to }, { kind: "move", to }]);
  });

  it("names the nearest node with no wall between, for the HUD", () => {
    const s = session(world, fresh());
    for (const opening of world.openings) {
      expect(world.nodes.get(nearestNode(s.ground, { ...s.run, locked: [opening.doorId ?? ""] }, opening.sideA)!)!.roomId).toBe(opening.roomA);
    }
    expect(openingBetween(world, "no", "edge")).toBeNull();
  });

  it("stops the body when the run is over", () => {
    const s = session(world, { ...fresh(), locked: [] });
    for (let i = 0; i < 30; i++) step(s, { forward: 1, strafe: 0, walk: false, yaw: 0.3, interact: false });
    s.run = { ...s.run, status: "caught" };
    for (let i = 0; i < 30; i++) step(s, { forward: 1, strafe: 0, walk: false, yaw: 0.3, interact: true });
    const pos = s.walker.pos;
    for (let i = 0; i < 30; i++) step(s, { forward: 1, strafe: 0, walk: false, yaw: 0.3, interact: true });
    expect(s.walker.pos).toEqual(pos);
    expect(s.played.every((a) => a.kind === "move")).toBe(true);
  });
});
