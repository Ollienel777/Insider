// Free movement mapped onto engine moves (issue 115), on the cached levels
// placed on the three fixture floors as the Run screen places them. A bot
// walks the floor with the same controls a player has (a yaw, the movement
// keys and E); every action comes out of `stepWalker` or `heldAction` and goes
// into the engine's `act`, which must accept it.
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { LevelManifest } from "@/domain";
import { act, createRun, neighbours, type Action, type RunState } from "@/engine";
import { placeLevel } from "@/level/placer";
import { quietRoute } from "@/level/quiet-route";
import f1 from "../../../../data/levels/F1.romaine-1974.json";
import f2 from "../../../../data/levels/F2.sunset-1986.json";
import f3 from "../../../../data/levels/F3.night-desk.json";
import { RUN_SEED } from "../run-screen";
import type { Ground, Vec } from "./ground";
import { FP } from "./tuning";
import { createWalker, doorInView, heldAction, legalMoves, promptFor, reconcile, stepWalker, type Controls, type Walker } from "./walker";
import { buildWorld, groundOf, type World } from "./world";

const CASES = [
  { id: "F1", cached: f1 },
  { id: "F2", cached: f2 },
  { id: "F3", cached: f3 },
] as const;

const IDLE: Controls = { forward: 0, strafe: 0, walk: false, yaw: 0, use: false, usePressed: false };
const distance = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
const yawTo = (from: Vec, to: Vec) => Math.atan2(to.y - from.y, to.x - from.x);

/** The walker, the engine's run, and every action handed to the engine, in order. */
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

function play(s: Session, action: Action): void {
  const result = act(s.run, action);
  if (!result.ok) throw new Error(`the engine refused ${JSON.stringify(action)}: ${result.reason}`);
  s.run = result.run;
  s.played.push(action);
}

/** One step. An action handed back is played through the engine, which must accept it. */
function step(s: Session, controls: Controls): void {
  const { walker, action } = stepWalker(s.walker, s.ground, s.run, controls);
  s.walker = walker;
  if (action) play(s, action);
}

/** Runs straight at `target` until within 6 cm of it, or `seconds` pass. */
function walkTo(s: Session, target: Vec, seconds = 12): void {
  for (let i = 0; i < seconds / FP.stepS && distance(s.walker.pos, target) > 0.06; i++) {
    const near = distance(s.walker.pos, target) < 0.4;
    step(s, { ...IDLE, forward: 1, walk: near, yaw: yawTo(s.walker.pos, target) });
  }
}

/** Walks the engine's edge from `from` to `to`, through its doorway if it has one. */
function walkEdge(s: Session, from: string, to: string): void {
  for (const point of s.ground.path(from, to).slice(1)) walkTo(s, point);
}

/** A place 0.6 m in front of `door`, on `nodeId`'s side of it. */
function inFront(ground: Ground, door: { centre: Vec }, nodeId: string): Vec {
  const node = ground.nodes.get(nodeId)!;
  const dx = node.x - door.centre.x;
  const dy = node.y - door.centre.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: door.centre.x + (dx / length) * 0.6, y: door.centre.y + (dy / length) * 0.6 };
}

function rest(s: Session, steps = 30): void {
  for (let i = 0; i < steps; i++) step(s, IDLE);
}

describe.each(CASES)("free movement on $id", ({ id, cached }) => {
  const placed = placeLevel(LevelManifest.parse(structuredClone(cached)), structuredClone(FIXTURE_FLOORS[id]), RUN_SEED);
  const world = buildWorld(placed.level.floor);
  const ground = groundOf(world);
  const fresh = () => createRun(placed.level);
  /** The same run with nobody on the floor to catch the player, for the tests of the walking alone. */
  const empty = (): RunState => ({ ...fresh(), guards: [], cleaners: [] });

  it("walks the quiet route and wins: every action handed over is the engine's to accept, and the route's own moves, picks and take are among them in order", () => {
    const route = quietRoute(placed)!;
    const s = session(world, fresh());
    for (const expected of route) {
      if (expected.kind === "move") {
        walkEdge(s, s.run.playerNode, expected.to);
        expect(s.run.playerNode, JSON.stringify(expected)).toBe(expected.to);
      } else if (expected.kind === "pick") {
        const door = ground.doors.find((d) => d.doorId === expected.doorId)!;
        walkTo(s, inFront(ground, door, s.run.playerNode));
        const yaw = yawTo(s.walker.pos, door.centre);
        const before = s.played.length;
        // E held: the press starts the lock, and each pick after it is the clock's turn.
        if (s.run.picking?.doorId === expected.doorId) play(s, heldAction(s.walker, s.ground, s.run, { use: true, yaw }));
        else step(s, { ...IDLE, yaw, use: true, usePressed: true });
        rest(s, 2);
        expect(s.played.slice(before), JSON.stringify(expected)).toEqual([expected]);
      } else if (expected.kind === "take") {
        const objective = ground.nodes.get(s.run.board.level.objective)!;
        step(s, { ...IDLE, yaw: yawTo(s.walker.pos, { x: objective.x + 1, y: objective.y }), usePressed: true, use: true });
        expect(s.played.at(-1)).toEqual({ kind: "take" });
      } else {
        // A wait is the turn clock's: the walker stands through it and hands back nothing.
        play(s, expected);
        const before = s.played.length;
        rest(s);
        expect(s.played.length).toBe(before);
      }
    }
    expect(s.run.status).toBe("won");
  });

  it("walks every edge of the floor both ways, ending on the far node with every move one the engine accepts", () => {
    for (const edge of placed.level.floor.edges) {
      for (const [from, to] of [[edge.a, edge.b], [edge.b, edge.a]]) {
        const s = session(world, { ...empty(), playerNode: from, locked: [] });
        walkEdge(s, from, to);
        rest(s, 2);
        expect(s.run.playerNode, `${from} → ${to}: ${JSON.stringify(s.played)}`).toBe(to);
        expect(s.played.every((a) => a.kind === "move")).toBe(true);
        expect(s.walker.region).toBe(to);
      }
    }
  });

  it("plays the move at once when the body steps from a node's area into a neighbour's", () => {
    for (const [nodeId, node] of ground.nodes) {
      for (const exit of neighbours(fresh().board, nodeId)) {
        const s = session(world, { ...empty(), playerNode: nodeId, locked: [] });
        // Just across the line: the body stands on the neighbour's ground, the walker still counts it here.
        const there = ground.nodes.get(exit.to)!;
        s.walker = { ...s.walker, pos: { x: there.x, y: there.y } };
        step(s, IDLE);
        expect(s.played, `${nodeId} → ${exit.to}`).toEqual([{ kind: "move", to: exit.to }]);
        expect(s.run.playerNode).toBe(exit.to);
        void node;
      }
    }
  });

  it("plays the legal moves in between, in order, when the body skips an area, and holds it back when there are none", () => {
    const run0 = { ...empty(), locked: [] };
    let checked = 0;
    for (const [nodeId] of ground.nodes) {
      for (const [farId, far] of ground.nodes) {
        const moves = legalMoves({ ...run0, playerNode: nodeId }, nodeId, farId);
        if (!moves || moves.length !== 2) continue;
        const s = session(world, { ...run0, playerNode: nodeId });
        s.walker = { ...s.walker, pos: { x: far.x, y: far.y } };
        step(s, IDLE);
        rest(s, 3);
        expect(s.played, `${nodeId} ⇒ ${farId}`).toEqual(moves);
        expect(s.run.playerNode).toBe(farId);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
    // Nothing within reach: four hops and more away, the body goes back to where it was.
    const start = fresh().playerNode;
    const far = [...ground.nodes.values()].find((n) => legalMoves({ ...run0, playerNode: start }, start, n.id, 20)!.length > FP.maxHops)!;
    const s = session(world, { ...run0, playerNode: start });
    const was = s.walker.pos;
    s.walker = { ...s.walker, pos: { x: far.x, y: far.y } };
    step(s, IDLE);
    expect(s.played).toEqual([]);
    expect(s.walker.pos).toEqual(was);
    expect(s.walker.region).toBe(start);
  });

  it("holding E at a locked door, standing in its node's area, picks on each held turn and moves nowhere; letting go starts it over, as the engine rules", () => {
    const run0 = empty();
    const doorId = run0.locked[0];
    const door = ground.doors.find((d) => d.doorId === doorId)!;
    // Walked there, never placed by hand: the engine starts one move short of the door's node, and the body
    // walks that move and then up to the door, so the walker's area and the engine's node are its own doing.
    const before = neighbours(run0.board, door.a).find((e) => e.to !== door.b && e.doorId === undefined)!.to;
    const s = session(world, { ...run0, playerNode: before });
    walkEdge(s, before, door.a);
    walkTo(s, inFront(ground, door, door.a));
    rest(s, 2);
    expect(s.played).toEqual([{ kind: "move", to: door.a }]);
    expect(ground.regionOf(s.walker.pos)).toBe(s.run.playerNode);
    const yaw = yawTo(s.walker.pos, door.centre);
    const held = { ...IDLE, yaw, use: true };
    expect(promptFor(s.walker, s.ground, s.run, yaw)).toMatchObject({ kind: "pick", doorId, node: door.a });
    step(s, { ...held, usePressed: true });
    rest(s, 2);
    expect(s.played).toEqual([{ kind: "move", to: door.a }, { kind: "pick", doorId }]);
    expect(ground.regionOf(s.walker.pos)).toBe(s.run.playerNode);
    const of = (promptFor(s.walker, s.ground, s.run, yaw) as { of: number }).of;
    expect(s.run.picking).toEqual({ doorId, progress: 1 });
    // Let go for a turn: the clock waits, and the engine starts the lock over.
    play(s, heldAction(s.walker, s.ground, s.run, { use: false, yaw }));
    expect(s.played.at(-1)).toEqual({ kind: "wait" });
    expect(s.run.picking).toBeNull();
    // Hold again: one pick a turn until it opens.
    step(s, { ...held, usePressed: true });
    for (let turn = 1; turn < of; turn++) play(s, heldAction(s.walker, s.ground, s.run, held));
    expect(s.run.locked).not.toContain(doorId);
    expect(s.played.slice(-of)).toEqual(Array.from({ length: of }, () => ({ kind: "pick", doorId })));
    expect(promptFor(s.walker, s.ground, s.run, yaw)).toBeNull();
  });

  it("tapping E picks no faster than holding it: one pick a turn, the clock's, through the same path", () => {
    const run0 = empty();
    const doorId = run0.locked[0];
    const door = ground.doors.find((d) => d.doorId === doorId)!;
    const yaw = yawTo(inFront(ground, door, door.a), door.centre);
    const at = () => {
      const s = session(world, { ...run0, playerNode: door.a });
      s.walker = { ...s.walker, pos: inFront(ground, door, door.a), region: door.a };
      return s;
    };
    const first = at();
    const of = (promptFor(first.walker, first.ground, first.run, yaw) as { of: number }).of;
    expect(of).toBeGreaterThan(1);
    const tap = (s: Session) => {
      step(s, { ...IDLE, yaw, use: true, usePressed: true });
      step(s, { ...IDLE, yaw });
    };
    const clock = (s: Session, use: boolean) => play(s, heldAction(s.walker, s.ground, s.run, { use, yaw }));

    // Held: a pick on the press, then one on each turn the clock plays.
    const held = at();
    step(held, { ...IDLE, yaw, use: true, usePressed: true });
    for (let turn = 1; turn < of; turn++) {
      rest(held, 2);
      clock(held, true);
    }
    // Tapped, many times a turn: the first tap starts the lock, the rest are kept for the clock's turn.
    const tapped = at();
    for (let turn = 0; turn < of; turn++) {
      for (let i = 0; i < 6; i++) tap(tapped);
      if (turn < of - 1) clock(tapped, false);
    }
    expect(tapped.played).toEqual(held.played);
    expect(tapped.played).toEqual(Array.from({ length: of }, () => ({ kind: "pick", doorId })));
    expect(tapped.run.locked).not.toContain(doorId);

    // A turn with no tap and E up is a wait, and the lock starts over, as when E is let go.
    const idle = at();
    tap(idle);
    tap(idle);
    clock(idle, false);
    clock(idle, false);
    expect(idle.played).toEqual([{ kind: "pick", doorId }, { kind: "pick", doorId }, { kind: "wait" }]);
    expect(idle.run.picking).toBeNull();
  });

  it("does not pick a door the view is not on, or one out of reach", () => {
    const run0 = empty();
    const doorId = run0.locked[0];
    const door = ground.doors.find((d) => d.doorId === doorId)!;
    const s = session(world, { ...run0, playerNode: door.a });
    const a = ground.nodes.get(door.a)!;
    s.walker = { ...s.walker, pos: { x: a.x, y: a.y }, region: door.a };
    const yaw = yawTo(a, door.centre);
    if (distance(a, door.centre) > FP.reachM) expect(promptFor(s.walker, s.ground, s.run, yaw)?.kind).not.toBe("pick");
    step(s, { ...IDLE, yaw: yaw + Math.PI, use: true, usePressed: true });
    expect(s.played).toEqual([]);
  });

  it("walls stop a body at a locked door: it stays in its own area until the door opens", () => {
    const run0 = empty();
    const doorId = run0.locked[0];
    const door = ground.doors.find((d) => d.doorId === doorId)!;
    const s = session(world, { ...run0, playerNode: door.a });
    walkTo(s, door.centre, 3);
    expect(s.played).toEqual([]);
    expect(ground.regionOf(s.walker.pos)).not.toBe(door.b);
  });

  it("goes back onto the engine's node when the engine says the player is somewhere else", () => {
    const s = session(world, { ...empty(), locked: [] });
    const start = s.run.playerNode;
    const to = neighbours(s.run.board, start)[0].to;
    walkEdge(s, start, to);
    // A restart: turn 0 again, at the start.
    s.run = { ...empty(), locked: [] };
    rest(s, 1);
    expect(s.walker.pos).toEqual({ x: ground.nodes.get(start)!.x, y: ground.nodes.get(start)!.y });
    expect(s.walker.region).toBe(start);
    // A number key: the engine moved the player without the walker.
    play(s, { kind: "move", to });
    rest(s, 1);
    expect(s.walker.node).toBe(to);
    expect(distance(s.walker.pos, ground.nodes.get(to)!)).toBeLessThan(1e-9);
  });

  it("goes back onto the engine's node on a restart even when that is the node it last read (#134)", () => {
    // The #119 review (R1-N1): a turn count that went backwards is a new run, whatever the node says. Here the
    // engine's node is the one the walker last read, so only `reconcile`'s turn check can tell it is a restart.
    const s = session(world, { ...empty(), locked: [] });
    const start = s.run.playerNode;
    const at = { x: ground.nodes.get(start)!.x, y: ground.nodes.get(start)!.y };
    const later = { ...s.walker, turn: 5, pos: { x: at.x + 0.7, y: at.y }, vel: { x: 1, y: 0 }, region: "elsewhere", queue: [{ kind: "wait" } as const] };
    const back = reconcile(later, s.ground, { ...empty(), locked: [] });
    expect(back.turn).toBe(0);
    expect(back.pos).toEqual(at);
    expect(back.home).toEqual(at);
    expect(back.vel).toEqual({ x: 0, y: 0 });
    expect(back.region).toBe(start);
    expect(back.queue).toEqual([]);
  });

  it("stays put through turns that leave the player where they were (the clock's waits)", () => {
    const s = session(world, { ...empty(), locked: [] });
    for (let i = 0; i < 20; i++) step(s, { ...IDLE, forward: 1, walk: true, yaw: 0.4 });
    const pos = s.walker.pos;
    play(s, { kind: "wait" });
    expect(reconcile(s.walker, s.ground, s.run).pos).toBe(pos);
  });

  it("puts the body back in its node's area when the engine does not answer a move", () => {
    const s = session(world, { ...empty(), locked: [] });
    const to = neighbours(s.run.board, s.run.playerNode)[0].to;
    const handed: Action[] = [];
    for (const point of ground.path(s.run.playerNode, to).slice(1)) {
      for (let i = 0; i < 12 / FP.stepS && distance(s.walker.pos, point) > 0.06 && handed.length === 0; i++) {
        const out = stepWalker(s.walker, s.ground, s.run, { ...IDLE, forward: 1, yaw: yawTo(s.walker.pos, point) });
        s.walker = out.walker;
        if (out.action) handed.push(out.action);
      }
    }
    expect(handed).toEqual([{ kind: "move", to }]);
    for (let i = 0; i < 1 / FP.stepS; i++) s.walker = stepWalker(s.walker, s.ground, s.run, IDLE).walker;
    expect(ground.regionOf(s.walker.pos)).toBe(s.run.playerNode);
    expect(s.walker.region).toBe(s.run.playerNode);
  });

  it("E at a locked door never puts the engine's node anywhere but the area the body stands in, from wherever the door is faced", () => {
    // The second review of issue 115's first person (M2): E used to queue the moves to the door's node on the far side of
    // its line, wherever the body was, and move the engine there without the body. Each door locked alone,
    // the body set down in every area within 2 m of it, facing the door, presses E and holds it.
    let picks = 0;
    for (const door of ground.doors) {
      for (let dx = -2; dx <= 2; dx += 0.25) {
        for (let dy = -2; dy <= 2; dy += 0.25) {
          const pos = { x: door.centre.x + dx, y: door.centre.y + dy };
          const area = ground.regionOf(pos);
          if (area === null) continue;
          // Only where a body can stand: one set down in a wall is pushed out, maybe over an area's edge.
          const stood = ground.collide(pos, { x: 0, y: 0 }, FP.stepS, [door.doorId]).pos;
          if (distance(stood, pos) > 1e-9) continue;
          const run = { ...empty(), playerNode: area, locked: [door.doorId] };
          const s: Session = { world, ground, walker: { ...createWalker(ground, run), pos, home: pos }, run, played: [] };
          const yaw = yawTo(pos, door.centre);
          for (let i = 0; i < 4; i++) step(s, { ...IDLE, yaw, use: true, usePressed: i === 0 });
          const where = `${door.doorId} from ${area} at (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}): ${JSON.stringify(s.played)}`;
          expect(s.played.filter((a) => a.kind === "move"), where).toEqual([]);
          expect(ground.regionOf(s.walker.pos), where).toBe(s.run.playerNode);
          if (s.played.some((a) => a.kind === "pick")) picks++;
        }
      }
    }
    expect(picks).toBeGreaterThan(0);
  });

  it("a move the engine refuses stays refused when a clock turn lands before the walker gives up on it", () => {
    // The second review of issue 115's first person (M3): a new turn that left the player where they were used to clear the
    // unanswered move and keep counting the body in the area it had walked into, with the engine elsewhere.
    const s = session(world, { ...empty(), locked: [] });
    const start = s.run.playerNode;
    const to = neighbours(s.run.board, start)[0].to;
    let handed: Action | null = null;
    for (const point of ground.path(start, to).slice(1)) {
      for (let i = 0; i < 12 / FP.stepS && distance(s.walker.pos, point) > 0.06 && handed === null; i++) {
        const out = stepWalker(s.walker, s.ground, s.run, { ...IDLE, forward: 1, yaw: yawTo(s.walker.pos, point) });
        s.walker = out.walker;
        handed = out.action;
      }
    }
    // The engine refuses the move (it is not played), and within the answer time the clock plays its wait.
    expect(handed).toEqual({ kind: "move", to });
    expect(ground.regionOf(s.walker.pos)).toBe(to);
    play(s, { kind: "wait" });
    step(s, IDLE);
    expect(s.run.playerNode).toBe(start);
    expect(ground.regionOf(s.walker.pos)).toBe(s.run.playerNode);
    expect(s.walker.region).toBe(start);
    expect(s.walker.queue).toEqual([]);
    expect(s.walker.pending).toBeNull();
    rest(s, 60);
    expect(s.played).toEqual([{ kind: "wait" }]);
    // The next crossing hands the move back again.
    walkEdge(s, start, to);
    rest(s, 2);
    expect(s.played).toEqual([{ kind: "wait" }, { kind: "move", to }]);
    expect(ground.regionOf(s.walker.pos)).toBe(s.run.playerNode);
  });

  it("stops the body when the run is over", () => {
    const s = session(world, { ...empty(), locked: [] });
    s.run = { ...s.run, status: "caught" };
    const pos = s.walker.pos;
    for (let i = 0; i < 30; i++) step(s, { ...IDLE, forward: 1, yaw: 0.3, use: true, usePressed: true });
    expect(s.played).toEqual([]);
    expect(distance(s.walker.pos, pos)).toBeLessThan(0.5);
  });
});

describe("E at a locked door seen from another node's area plays nothing", () => {
  // The two places the second review of issue 115's first person (M2) found: E there played the moves to the door's far node
  // and a pick, and left the engine metres from the body, for good.
  it.each([
    { id: "F1", cached: f1, area: "sc-rack", doorId: "d-freight-lobby", pos: { x: 6.4, y: 2.9 }, through: "the server closet's wall" },
    { id: "F2", cached: f2, area: "fl-car", doorId: "d-freight-north", pos: { x: 5.6, y: 22.74 }, through: null },
  ] as const)("$id: from $area, facing $doorId", ({ id, cached, area, doorId, pos, through }) => {
    const placed = placeLevel(LevelManifest.parse(structuredClone(cached)), structuredClone(FIXTURE_FLOORS[id]), RUN_SEED);
    const world = buildWorld(placed.level.floor);
    const ground = groundOf(world);
    const fresh = createRun(placed.level);
    // F1's closet door stands open (picked), the freight door is shut; on F2 the freight door is shut too.
    const locked = [...fresh.locked.filter((d) => d !== "d-server-closet"), doorId];
    const run: RunState = { ...fresh, guards: [], cleaners: [], playerNode: area, locked };
    const door = ground.doors.find((d) => d.doorId === doorId)!;
    const yaw = yawTo(pos, door.centre);
    // The case as found: the body in `area`, the view's line on the door within reach, a wall between or not.
    expect(ground.regionOf(pos)).toBe(area);
    expect(doorInView(ground, run, pos, yaw)?.doorId).toBe(doorId);
    expect(ground.clear(pos, door.centre, [])).toBe(through === null);
    const s: Session = { world, ground, walker: { ...createWalker(ground, run), pos, home: pos }, run, played: [] };
    // Not "Hold E to pick": through a wall nothing is pointed out; in plain view, the player is told to step up to it.
    expect(promptFor(s.walker, ground, s.run, yaw)).toEqual(through === null ? { kind: "far", doorId } : null);
    for (let i = 0; i < 4; i++) step(s, { ...IDLE, yaw, use: true, usePressed: i === 0 });
    expect(s.played).toEqual([]);
    expect(s.run.playerNode).toBe(area);
    expect(ground.regionOf(s.walker.pos)).toBe(s.run.playerNode);
    // Walking away plays the moves the body makes, as ever.
    walkEdge(s, area, neighbours(s.run.board, area).find((e) => e.doorId === undefined || !locked.includes(e.doorId))!.to);
    expect(ground.regionOf(s.walker.pos)).toBe(s.run.playerNode);
  });
});

describe.each(CASES)("the prompt at a way out on $id (issue 188)", ({ id, cached }) => {
  it("names the exit the player stands near once the objective is carried, and not before", () => {
    const placed = placeLevel(LevelManifest.parse(structuredClone(cached)), structuredClone(FIXTURE_FLOORS[id]), RUN_SEED);
    const ground = groundOf(buildWorld(placed.level.floor));
    const exit = placed.level.exits[0];
    const run: RunState = { ...createRun(placed.level), playerNode: exit };
    const walker = createWalker(ground, run);
    expect(promptFor(walker, ground, { ...run, carrying: true }, 0)).toEqual({ kind: "exit", nodeId: exit });
    expect(promptFor(walker, ground, run, 0)?.kind).not.toBe("exit");
  });
});
