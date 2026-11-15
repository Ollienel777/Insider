// How near the player is to being noticed, in first person (issue 146): the
// edge glow, the meter, the noise cue and which guards show through walls.
// All of it is read from the run state the engine already keeps; nothing
// here decides anything the engine does not.
//
// - In view: the engine's own sight this turn (sight.ts) covers the node it
//   has the player on. Standing there is being seen, so the glow is full.
// - Close: a node someone watches this turn is a few metres from the body,
//   or a sweeping camera covers the player's node next turn.
// - Heard: the player's last turn was a sprint or a pick (the engine's noisy
//   actions), and guards stood within hearing range of where it ended.
// - Tripped: the alarm went up on the last turn, and who raised it.
// - Earshot: the guards and cleaners within the engine's hearing range of the
//   player's node, in hops: the ones the view outlines through walls.
//
// Pure: no DOM, no renderer.
import { hearingRange, withinHops, type RunState } from "@/engine";
import type { Vec } from "./ground";
import { trippedBy, watchedNodes, type Sight } from "./sight";
import { FP } from "./tuning";

/** Within this many metres of a watched node's disc edge, the glow starts to rise. */
export const NOTICE_NEAR_M = 4;
/** The glow's level when the player is right at a watched disc's edge, or a sweep comes next turn. */
export const NOTICE_CLOSE_MAX = 0.6;

export type NoticeTone = "calm" | "warning" | "danger";

export interface Notice {
  /** 0 nothing near, 1 seen. */
  level: number;
  tone: NoticeTone;
  /** Watchers whose sight covers the player's node this turn. */
  seenBy: readonly string[];
  /** The watcher whose watched node is nearest, while the player is close and not seen. */
  closeTo: string | null;
  /** Guards that heard the player's last action. */
  heardBy: readonly string[];
  /** The watcher that raised the alarm on the last turn. */
  tripped: string | null;
  /** One short line for the meter, or null when nothing is near. */
  reason: string | null;
}

export interface NoiseCue {
  /** The last turn's action made noise. */
  loud: boolean;
  kind: "sprint" | "pick" | null;
  /** How many hops that noise carried. */
  rangeHops: number;
  /** Guards within that range: they heard it. */
  heardBy: readonly string[];
}

const KIND_WORD: Record<Sight["kind"], string> = { camera: "Camera", guard: "Guard", cleaner: "Cleaner" };

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

/** The noise the player's last turn made, as the engine heard it. */
export function noiseCue(run: RunState): NoiseCue {
  const last = run.turns[run.turns.length - 1];
  const kind = last?.player.kind === "sprint" || last?.player.kind === "pick" ? last.player.kind : null;
  if (!kind) return { loud: false, kind: null, rangeHops: 0, heardBy: [] };
  const source = last.player.nodeId;
  const rangeHops = hearingRange(run.board, source);
  // The engine checks hearing before the guards move: the log's guards are where they stood after.
  // Noise alarm events of that turn name exactly who heard it; at Alert the engine logs none, so the
  // positions before the move (the turn before's entry, or the guards as they are) fill in.
  const turn = last.turn;
  const logged = run.alarmEvents.filter((e) => e.turn === turn && e.cause.kind === "noise" && e.cause.id).map((e) => e.cause.id!);
  const heard = withinHops(run.board, source, rangeHops);
  const before = run.turns[run.turns.length - 2]?.guards ?? run.guards.map((g) => ({ guardId: g.id, nodeId: g.nodeId }));
  const near = before.filter((g) => heard.has(g.nodeId)).map((g) => g.guardId);
  return { loud: true, kind, rangeHops, heardBy: [...new Set([...logged, ...near])] };
}

/** The guards and cleaners within the engine's hearing range of the player's node, by id. */
export function earshot(run: RunState): Set<string> {
  const near = withinHops(run.board, run.playerNode, hearingRange(run.board, run.playerNode));
  return new Set([...run.guards, ...run.cleaners].filter((g) => near.has(g.nodeId)).map((g) => g.id));
}

/**
 * How near the player stands to being noticed this turn. `pos` is the body
 * on the floor in metres; `nodes` every node's place in metres.
 */
export function noticeOf(
  run: RunState,
  sight: readonly Sight[],
  pos: Vec,
  nodes: ReadonlyMap<string, Vec>,
  /** Whether nothing solid stands between two points: a watched node behind a wall is not close. */
  clear: (a: Vec, b: Vec) => boolean = () => true,
): Notice {
  const kinds = new Map(sight.map((s) => [s.id, s.kind]));
  const name = (id: string) => `${KIND_WORD[kinds.get(id) ?? "guard"]} ${id}`;
  const tripped = run.status === "playing" || run.status === "caught" ? trippedBy(run) : null;
  const noise = noiseCue(run);
  const heardBy = noise.heardBy;
  const watched = watchedNodes(sight);
  const seenBy = watched.get(run.playerNode)?.by ?? [];

  let close = 0;
  let closeTo: string | null = null;
  if (seenBy.length === 0) {
    for (const [nodeId, seen] of watched) {
      const at = nodes.get(nodeId);
      if (!at) continue;
      const gap = Math.max(0, dist(pos, at) - FP.watchedM);
      const k = Math.max(0, 1 - gap / NOTICE_NEAR_M) * NOTICE_CLOSE_MAX;
      if (k > close && clear(pos, at)) {
        close = k;
        closeTo = seen.by[0] ?? null;
      }
    }
    // A sweeping camera's next part covers the player's node: it turns onto them next turn.
    for (const s of sight) {
      if (s.next.includes(run.playerNode) && NOTICE_CLOSE_MAX > close) {
        close = NOTICE_CLOSE_MAX;
        closeTo = s.id;
      }
    }
  }

  const level = seenBy.length > 0 ? 1 : Math.max(close, heardBy.length > 0 ? 0.5 : 0, tripped ? 0.8 : 0);
  const tone: NoticeTone = seenBy.length > 0 || tripped ? "danger" : level > 0 ? "warning" : "calm";
  const reason =
    seenBy.length > 0
      ? `${name(seenBy[0])} has you in view`
      : tripped
        ? `${name(tripped)} saw you`
        : heardBy.length > 0
          ? `${heardBy.join(", ")} heard you`
          : closeTo && close > 0
            ? `Near ${name(closeTo)}'s sight`
            : null;
  return { level: Math.round(level * 20) / 20, tone, seenBy, closeTo: close > 0 ? closeTo : null, heardBy, tripped, reason };
}
