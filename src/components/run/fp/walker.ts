// Free movement mapped onto the engine's nodes (issue 115). The engine stays
// the game: it knows nodes, and who sees which. The walker is where the
// player's body is between them. It plays nothing itself; each step it may
// hand back one engine action, and the Run screen plays that through the same
// `play` a key press takes.
//
// - Walking into the ground around a node the engine would let the player
//   move to hands back that `move`, once. What is legal is the engine's own
//   answer, read the way the board reads it (`choices`, board.ts). Reaching a
//   node that is not a legal move hands back nothing: the engine still has
//   the player where it had them, until they reach a node that is.
// - Leaning on a locked door, or pressing E facing it, hands back the engine's
//   `pick` for that door when the engine's node is beside it.
// - E at the objective hands back `take`. Carrying it onto an exit is the
//   engine's win, by the move that gets there.
// - Sprinting (Q held, the board's S, issue 121): reaching a node two open
//   hops away hands back the engine's `sprint` to it, and the node between is
//   passed over without a move of its own.
// - The engine is the truth. When its player node is not the one this view
//   expected (a restart, a number key, a refused move), the body is put back
//   on the engine's node.
//
// Pure: no DOM, no renderer, no clock but the `dt` it is given. It reads the
// floor only through `Ground` (ground.ts), so any floor that can move a body
// and place the engine's nodes can be walked.
import { neighbours, type Action, type RunState } from "@/engine";
import { canTake, choices } from "../board";
import type { Ground, GroundDoor, Vec } from "./ground";
import { accelerate, facing, nearestOn, wishVelocity, type Wish } from "./motion";
import { FP } from "./tuning";

export interface Walker {
  pos: Vec;
  vel: Vec;
  /** The engine's player node, as this view last read it. */
  node: string;
  /** The engine's turn, as this view last read it. */
  turn: number;
  /** An action handed back that the engine has not answered yet: nothing else is handed back meanwhile. */
  pending: { to: string | null; age: number } | null;
  /** A node whose move the engine did not take; it is not offered again until the player steps off it. */
  refused: string | null;
  /** The locked door being leaned on, and for how long. */
  push: { doorId: string; s: number } | null;
  /** Metres walked, for the view bob. */
  walked: number;
}

export interface Controls extends Wish {
  yaw: number;
  /** E went down since the last step. */
  interact: boolean;
  /** The sprint key is held: two open hops in one turn. */
  sprint?: boolean;
}

/** A walker standing on the engine's player node. */
export function createWalker(ground: Ground, run: RunState): Walker {
  const at = ground.nodes.get(run.playerNode);
  return {
    pos: { x: at?.x ?? 0, y: at?.y ?? 0 },
    vel: { x: 0, y: 0 },
    node: run.playerNode,
    turn: run.turn,
    pending: null,
    refused: null,
    push: null,
    walked: 0,
  };
}

/**
 * Brings the walker in line with the engine's state. A new turn that left the
 * player where this view expected (on the same node, or on the node of the
 * move it handed back) changes nothing about the body. Anything else, and a
 * turn count that went backwards, is the engine saying the player is
 * somewhere this view did not put them: the body goes to the engine's node.
 */
export function reconcile(walker: Walker, ground: Ground, run: RunState): Walker {
  if (run.turn === walker.turn && run.playerNode === walker.node) return walker;
  const expected = run.playerNode === walker.node || run.playerNode === walker.pending?.to;
  const next: Walker = { ...walker, node: run.playerNode, turn: run.turn, pending: null };
  if (run.turn >= walker.turn && expected) return next;
  const at = ground.nodes.get(run.playerNode);
  if (!at) return next;
  return { ...next, pos: { x: at.x, y: at.y }, vel: { x: 0, y: 0 }, refused: null, push: null };
}

const distance = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

/** The nearest node within `reach` of `pos` with nothing solid between. */
function nodeNear(ground: Ground, run: RunState, pos: Vec, reach: number): string | null {
  let best: string | null = null;
  let bestD = reach;
  for (const node of ground.nodes.values()) {
    const d = distance(node, pos);
    if (d <= bestD && ground.clear(pos, node, run.locked)) {
      best = node.id;
      bestD = d;
    }
  }
  return best;
}

/** The node whose ground `pos` is on: the nearest within arrival range with no wall between. */
export const nodeUnderfoot = (ground: Ground, run: RunState, pos: Vec): string | null =>
  nodeNear(ground, run, pos, FP.arriveM);

/** The node the player stands nearest, however far, with no wall between: the HUD names its room. */
export const nearestNode = (ground: Ground, run: RunState, pos: Vec): string | null =>
  nodeNear(ground, run, pos, Infinity);

/** What E would do from here, for the HUD's prompt and for `stepWalker`. */
export type Prompt =
  | { kind: "pick"; doorId: string; done: number; of: number }
  /** A locked door in reach that the engine's node is not beside: no pick from here. */
  | { kind: "locked"; doorId: string }
  | { kind: "take" }
  | null;

/** Whether the engine would let the player pick `doorId` now. */
const pickable = (run: RunState, doorId: string) => choices(run).some((c) => c.kind === "pick" && c.doorId === doorId);

/**
 * The locked door within reach that the view faces, nearest first; one the
 * engine would let the player pick before one it wouldn't. On a scan two board
 * edges can cross one doorway (issue 118), so two doors can stand in it.
 */
function doorInReach(ground: Ground, run: RunState, pos: Vec, yaw: number): GroundDoor | null {
  const look = facing(yaw);
  let best: GroundDoor | null = null;
  let bestD: number = FP.reachM;
  let bestPickable = false;
  for (const door of ground.doors) {
    if (!run.locked.includes(door.doorId)) continue;
    const d = distance(nearestOn(door.bar, pos), pos);
    if (d > FP.reachM) continue;
    const to = { x: door.centre.x - pos.x, y: door.centre.y - pos.y };
    const length = Math.hypot(to.x, to.y) || 1;
    if ((to.x * look.x + to.y * look.y) / length < 0.4) continue;
    const canPick = pickable(run, door.doorId);
    if (bestPickable && !canPick) continue;
    if (canPick === bestPickable && d > bestD) continue;
    best = door;
    bestD = d;
    bestPickable = canPick;
  }
  return best;
}

export function promptFor(walker: Walker, ground: Ground, run: RunState, yaw: number): Prompt {
  if (run.status !== "playing") return null;
  const door = doorInReach(ground, run, walker.pos, yaw);
  if (door) return pickPrompt(run, door.doorId);
  const objective = ground.nodes.get(run.board.level.objective);
  if (canTake(run) && objective && distance(objective, walker.pos) <= FP.reachM) return { kind: "take" };
  return null;
}

function pickPrompt(run: RunState, doorId: string): Prompt {
  const pick = choices(run).find((c) => c.kind === "pick" && c.doorId === doorId);
  if (!pick) return { kind: "locked", doorId };
  return { kind: "pick", doorId, done: pick.progress?.done ?? 0, of: pick.progress?.of ?? 1 };
}

/**
 * One fixed step: reconcile with the engine, move, and say what the engine
 * should be asked to play, if anything. The caller plays the action; the
 * walker learns the answer from the next `run` it is stepped with.
 */
export function stepWalker(
  before: Walker,
  ground: Ground,
  run: RunState,
  controls: Controls,
  dt: number = FP.stepS,
): { walker: Walker; action: Action | null } {
  let walker = reconcile(before, ground, run);
  const playing = run.status === "playing";

  // Move. A run that is over stops the body where it stands.
  const wish = playing ? wishVelocity(controls, controls.yaw) : { x: 0, y: 0 };
  const moved = ground.collide(walker.pos, accelerate(walker.vel, wish, dt), dt, run.locked);
  walker = { ...walker, pos: moved.pos, vel: moved.vel, walked: walker.walked + distance(moved.pos, walker.pos) };

  if (walker.pending) {
    const age = walker.pending.age + dt;
    // No answer: the engine refused it. That node is left alone until the player steps off it.
    if (age > FP.answerS) walker = { ...walker, pending: null, refused: walker.pending.to };
    else walker = { ...walker, pending: { ...walker.pending, age } };
  }
  const under = playing ? nodeUnderfoot(ground, run, walker.pos) : null;
  if (walker.refused !== null && under !== walker.refused) walker = { ...walker, refused: null };

  // Leaning on a locked door: touching it and walking into it.
  const leaning = playing ? leaningOn(moved.pressed, wish, run) : null;
  const push = leaning ? { doorId: leaning, s: (walker.push?.doorId === leaning ? walker.push.s : 0) + dt } : null;
  walker = { ...walker, push };

  if (!playing || walker.pending) return { walker, action: null };

  if (controls.interact) {
    const prompt = promptFor(walker, ground, run, controls.yaw);
    if (prompt?.kind === "pick") return emit(walker, { kind: "pick", doorId: prompt.doorId }, null);
    if (prompt?.kind === "take") return emit(walker, { kind: "take" }, null);
  }

  if (push && push.s >= FP.pushPickS && pickPrompt(run, push.doorId)?.kind === "pick") {
    // The next pick of a held push comes a turn's length later.
    const held = { ...walker, push: { doorId: push.doorId, s: FP.pushPickS - FP.pickEveryS } };
    return emit(held, { kind: "pick", doorId: push.doorId }, null);
  }

  if (under !== null && under !== walker.node && under !== walker.refused) {
    if (controls.sprint) {
      const dash = sprintTo(run, under);
      if (dash) return emit(walker, dash, under);
      // The node between: passed over on the way to one two hops on.
      if (firstHop(run, under)) return { walker, action: null };
    }
    const legal = choices(run).some((c) => c.kind === "move" && c.nodeId === under);
    if (legal) return emit(walker, { kind: "move", to: under }, under);
  }
  return { walker, action: null };
}

const openExit = (run: RunState, doorId: string | undefined) => doorId === undefined || !run.locked.includes(doorId);

/** The engine's sprint to `to` when it is two open hops from the player's node and not a neighbour, else null. */
export function sprintTo(run: RunState, to: string): Action | null {
  const here = run.playerNode;
  const firsts = neighbours(run.board, here);
  if (to === here || firsts.some((e) => e.to === to)) return null;
  for (const first of firsts) {
    if (!openExit(run, first.doorId)) continue;
    if (neighbours(run.board, first.to).some((e) => e.to === to && openExit(run, e.doorId))) return { kind: "sprint", to, via: first.to };
  }
  return null;
}

/** Whether `node` is an open first hop with somewhere to sprint on to beyond it. */
function firstHop(run: RunState, node: string): boolean {
  const here = run.playerNode;
  const firsts = neighbours(run.board, here);
  const exit = firsts.find((e) => e.to === node);
  if (!exit || !openExit(run, exit.doorId)) return false;
  return neighbours(run.board, node).some((e) => e.to !== here && openExit(run, e.doorId) && !firsts.some((f) => f.to === e.to));
}

function emit(walker: Walker, action: Action, to: string | null): { walker: Walker; action: Action } {
  return { walker: { ...walker, pending: { to, age: 0 } }, action };
}

/** The shut door among `pressed` that `wish` walks into, if any: one the engine would let the player pick first. */
function leaningOn(pressed: readonly { doorId: string; n: Vec }[], wish: Vec, run: RunState): string | null {
  const speed = Math.hypot(wish.x, wish.y);
  if (speed === 0) return null;
  const into = pressed.filter(({ n }) => -(wish.x * n.x + wish.y * n.y) / speed > 0.5).map(({ doorId }) => doorId);
  return into.find((doorId) => pickable(run, doorId)) ?? into[0] ?? null;
}
