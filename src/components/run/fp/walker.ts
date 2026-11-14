// Free movement mapped onto the engine's nodes (issue 115). The engine stays
// the game: it knows nodes, and who sees which. The walker is where the
// player's body is between them. It plays nothing itself; each step it may
// hand back one engine action, and the Run screen plays that through the same
// `play` a key press takes.
//
// - The floor is split into areas, one per node (`Ground.regionOf`). Stepping
//   into a neighbouring node's area hands back that `move` at once. Crossing
//   into an area that is not one legal move away (a corner cut, two areas in
//   one step) hands back the legal moves between, in order, up to
//   `FP.maxHops`; with none, the body is held at the edge of its own area.
//   What is legal is the engine's own adjacency with its locked doors shut,
//   as `choices` (board.ts) reads it.
// - Holding E at a locked door, looking at it, hands back the moves to the
//   door's own node if the player is not on it, then a `pick`. While E stays
//   down, the turn clock picks again each turn (`heldAction`); letting go
//   lets the clock wait instead, and the engine then starts the lock over.
//   A press plays a pick at once only to start a lock. On a part-picked one
//   it is kept for the turn (`pickDue`) and the clock's turn plays it, so
//   tapping E picks once a turn, no faster than holding it.
// - E at the objective hands back `take`. Carrying it onto an exit is the
//   engine's win, by the move that gets there.
// - The engine is the truth. When its player node is not the one this view
//   expected (a restart, a number key, a refused move), the body goes back to
//   where it last stood in the engine's node's area, or onto the node.
//
// Pure: no DOM, no renderer, no clock but the `dt` it is given. It reads the
// floor only through `Ground` (ground.ts).
import { neighbours, picksToOpen, type Action, type RunState } from "@/engine";
import { canTake } from "../board";
import type { Ground, GroundDoor, Vec } from "./ground";
import { accelerate, facing, wishVelocity, type Wish } from "./motion";
import { FP } from "./tuning";

export interface Walker {
  pos: Vec;
  vel: Vec;
  /** The engine's player node, as this view last read it. */
  node: string;
  /** The engine's turn, as this view last read it. */
  turn: number;
  /** The area the body was last counted in. */
  region: string;
  /** The last place the body stood in the engine's node's area, with nothing queued: where a refused move puts it back. */
  home: Vec;
  /** Actions still to hand back, in order: the moves of a crossing, a pick after the move to its door. */
  queue: readonly Action[];
  /** An action handed back that the engine has not answered yet: nothing else is handed back meanwhile. */
  pending: { to: string | null; age: number } | null;
  /** Metres walked, for the view bob. */
  walked: number;
  /** E was pressed this turn at this part-picked door: the clock's turn picks it, as if E were still held. */
  pickDue: string | null;
}

export interface Controls extends Wish {
  yaw: number;
  /** E is down. */
  use: boolean;
  /** E went down since the last step. */
  usePressed: boolean;
}

/** A walker standing on the engine's player node. */
export function createWalker(ground: Ground, run: RunState): Walker {
  const at = ground.nodes.get(run.playerNode);
  const pos = { x: at?.x ?? 0, y: at?.y ?? 0 };
  return { pos, vel: { x: 0, y: 0 }, node: run.playerNode, turn: run.turn, region: run.playerNode, home: pos, queue: [], pending: null, walked: 0, pickDue: null };
}

/** Where the engine will have the player once everything handed back and queued is played. */
function destination(walker: Walker): string {
  for (let i = walker.queue.length - 1; i >= 0; i--) {
    const a = walker.queue[i];
    if (a.kind === "move") return a.to;
  }
  return walker.pending?.to ?? walker.node;
}

/**
 * Brings the walker in line with the engine's state. A new turn that left the
 * player where this view expected (on the same node, or on the node of the
 * move it handed back) changes nothing about the body. Anything else, and a
 * turn count that went backwards, is the engine saying the player is
 * somewhere this view did not put them: the body goes onto the engine's node.
 */
export function reconcile(walker: Walker, ground: Ground, run: RunState): Walker {
  if (run.turn === walker.turn && run.playerNode === walker.node) return walker;
  const expected = run.playerNode === walker.node || (walker.pending !== null && run.playerNode === walker.pending.to);
  const next: Walker = { ...walker, node: run.playerNode, turn: run.turn, pending: null, pickDue: null };
  if (run.turn >= walker.turn && expected) return next;
  const at = ground.nodes.get(run.playerNode);
  if (!at) return { ...next, queue: [] };
  const pos = { x: at.x, y: at.y };
  return { ...next, pos, home: pos, region: run.playerNode, vel: { x: 0, y: 0 }, queue: [] };
}

/**
 * The legal moves from `from` to `to`, in order, by the fewest hops through
 * open edges (the engine's `move` refuses a locked door); null when `to` is
 * further than `maxHops` or cannot be reached.
 */
export function legalMoves(run: RunState, from: string, to: string, maxHops: number = FP.maxHops): Action[] | null {
  if (from === to) return [];
  const open = (doorId: string | undefined) => doorId === undefined || !run.locked.includes(doorId);
  const back = new Map<string, string>([[from, from]]);
  let layer = [from];
  for (let hop = 0; hop < maxHops && layer.length > 0; hop++) {
    const next: string[] = [];
    for (const here of layer) {
      for (const exit of neighbours(run.board, here)) {
        if (!open(exit.doorId) || back.has(exit.to)) continue;
        back.set(exit.to, here);
        if (exit.to === to) {
          const path: string[] = [to];
          while (path[0] !== from) path.unshift(back.get(path[0])!);
          return path.slice(1).map((id) => ({ kind: "move", to: id }));
        }
        next.push(exit.to);
      }
    }
    layer = next;
  }
  return null;
}

const distance = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

/** The middle of a door's face, nudged 5 cm towards `pos`, so a line to it ends before the door itself. */
function nearestOnBar(door: GroundDoor, pos: Vec): Vec {
  const d = distance(door.centre, pos) || 1;
  return { x: door.centre.x + ((pos.x - door.centre.x) / d) * 0.05, y: door.centre.y + ((pos.y - door.centre.y) / d) * 0.05 };
}

/** What E does from here, for the HUD's prompt, the door's ring and `stepWalker`. */
export type Prompt =
  /** A locked door: `node` is its node on the player's side, `moves` the legal moves there first. */
  | { kind: "pick"; doorId: string; node: string; moves: readonly Action[]; done: number; of: number }
  /** A locked door in reach that cannot be picked from here: its node on this side is too far by legal moves. */
  | { kind: "locked"; doorId: string }
  /** A locked door in view, too far off to pick: the player should step up to it. */
  | { kind: "far"; doorId: string }
  | { kind: "take" }
  | null;

/** Where the view's line meets the door's face, in metres along the line; null when it misses. */
function lineMeets(door: GroundDoor, pos: Vec, look: Vec): number | null {
  const { a, b } = door.bar;
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const den = look.x * ey - look.y * ex;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((a.x - pos.x) * ey - (a.y - pos.y) * ex) / den;
  const u = ((a.x - pos.x) * look.y - (a.y - pos.y) * look.x) / den;
  // A little past each end of the door counts: the frame is part of it.
  return t >= 0 && u >= -0.15 && u <= 1.15 ? t : null;
}

/** The door's node on `pos`'s side of it. */
function nearSide(ground: Ground, door: GroundDoor, pos: Vec): string {
  const { a, b } = door.bar;
  const side = (p: Vec) => Math.sign((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
  const na = ground.nodes.get(door.a);
  return na && side(na) === side(pos) ? door.a : door.b;
}

/** The locked door the middle of the view is on, within reach, if any. */
export function doorInView(ground: Ground, run: RunState, pos: Vec, yaw: number, reach: number = FP.reachM): GroundDoor | null {
  const look = facing(yaw);
  let best: GroundDoor | null = null;
  let bestT: number = reach;
  for (const door of ground.doors) {
    if (!run.locked.includes(door.doorId)) continue;
    const t = lineMeets(door, pos, look);
    if (t !== null && t <= bestT) {
      best = door;
      bestT = t;
    }
  }
  return best;
}

export function promptFor(walker: Walker, ground: Ground, run: RunState, yaw: number): Prompt {
  if (run.status !== "playing") return null;
  const door = doorInView(ground, run, walker.pos, yaw);
  if (door) {
    const node = nearSide(ground, door, walker.pos);
    const moves = legalMoves(run, run.playerNode, node);
    if (!moves) return { kind: "locked", doorId: door.doorId };
    const done = run.picking?.doorId === door.doorId ? run.picking.progress : 0;
    return { kind: "pick", doorId: door.doorId, node, moves, done, of: picksToOpen(run.board.level, door.doorId) };
  }
  const objective = ground.nodes.get(run.board.level.objective);
  if (canTake(run) && objective && distance(objective, walker.pos) <= FP.reachM) return { kind: "take" };
  // Nothing walls the line off: a door seen through a wall is not pointed out.
  const far = doorInView(ground, run, walker.pos, yaw, FP.noticeM);
  if (far && ground.clear(walker.pos, nearestOnBar(far, walker.pos), run.locked.filter((id) => id !== far.doorId))) return { kind: "far", doorId: far.doorId };
  return null;
}

/**
 * The action the turn clock plays for a first-person turn the player lets run
 * out: the next pick while E is held on a door the player stands at, or was
 * pressed there this turn; otherwise a wait (which, as the engine rules,
 * starts a part-picked lock over).
 */
export function heldAction(before: Walker, ground: Ground, run: RunState, controls: Pick<Controls, "use" | "yaw">): Action {
  const walker = reconcile(before, ground, run);
  if (walker.pending || walker.queue.length > 0) return { kind: "wait" };
  const prompt = promptFor(walker, ground, run, controls.yaw);
  if (prompt?.kind !== "pick" || prompt.node !== run.playerNode) return { kind: "wait" };
  if (controls.use || walker.pickDue === prompt.doorId) return { kind: "pick", doorId: prompt.doorId };
  return { kind: "wait" };
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
  const from = walker.pos;
  const moved = ground.collide(from, accelerate(walker.vel, wish, dt), dt, run.locked);
  walker = { ...walker, pos: moved.pos, vel: moved.vel, walked: walker.walked + distance(moved.pos, from) };
  if (!playing) return { walker, action: null };

  if (walker.pending) {
    const age = walker.pending.age + dt;
    if (age > FP.answerS) {
      // No answer: the engine refused it. Back to where the engine has the player.
      walker = { ...walker, pending: null, queue: [], pos: walker.home, vel: { x: 0, y: 0 }, region: walker.node };
    } else {
      walker = { ...walker, pending: { ...walker.pending, age } };
    }
  }

  // Into another area: the legal moves there, or held at the edge of this one.
  const region = ground.regionOf(walker.pos);
  if (region !== null && region !== walker.region) {
    const moves = legalMoves(run, destination(walker), region);
    if (moves) {
      walker = { ...walker, region, queue: [...walker.queue.filter((a) => a.kind === "move"), ...moves] };
    } else {
      // Held back at the edge of its own area: the step that crossed is not taken.
      const back = ground.regionOf(from) === walker.region ? from : walker.home;
      walker = { ...walker, pos: back, vel: { x: 0, y: 0 } };
    }
  }
  if (walker.region === walker.node && walker.queue.length === 0 && !walker.pending) walker = { ...walker, home: walker.pos };

  if (walker.pending) return { walker, action: null };
  if (walker.queue.length === 0 && controls.usePressed) {
    const prompt = promptFor(walker, ground, run, controls.yaw);
    // A lock already under way is the clock's to pick, once a turn, however often E is tapped.
    if (prompt?.kind === "pick" && prompt.done > 0 && prompt.node === run.playerNode) walker = { ...walker, pickDue: prompt.doorId };
    else if (prompt?.kind === "pick") walker ={ ...walker, queue: [...prompt.moves, { kind: "pick", doorId: prompt.doorId }] };
    if (prompt?.kind === "take") walker = { ...walker, queue: [{ kind: "take" }] };
  }
  const [action, ...rest] = walker.queue;
  if (!action) return { walker, action: null };
  return { walker: { ...walker, queue: rest, pending: { to: action.kind === "move" ? action.to : null, age: 0 } }, action };
}
