// How near the player is to being noticed, in first person (issue 146): the
// one suspicion meter and the noise cue. Every level is read from the engine's
// own run state, the same sets the board draws, so the meter can never
// disagree with the board:
//
// - Seen: the engine's sight this turn (sight.ts) covers the player's node.
// - Tripped: the alarm went up on the last turn, and who raised it.
// - Heard: the player's last turn was a sprint or a pick (the engine's noisy
//   actions), and guards stood within hearing range of where it ended.
// - Next to sight: a node someone watches this turn is one open move away, or
//   a sweeping camera covers the player's node next turn.
// - In earshot: a guard stands within the engine's hearing range, in hops: a
//   sprint or a pick here would be heard.
// - The alarm's level sets a floor under all of it.
//
// Pure: no DOM, no renderer.
import { hearingRange, neighbours, withinHops, type RunState } from "@/engine";
import { trippedBy, watchedNodes, type Sight } from "./sight";

export type NoticeTone = "calm" | "warning" | "danger";

/** The meter's level for each thing that can be true at once; the highest wins. */
export const NOTICE_LEVEL = Object.freeze({
  seen: 1,
  tripped: 0.8,
  alert: 0.8,
  near: 0.6,
  heard: 0.6,
  suspicious: 0.4,
  earshot: 0.2,
});

export interface Notice {
  /** 0 nothing near, 1 seen. */
  level: number;
  tone: NoticeTone;
  /** Watchers whose sight covers the player's node this turn. */
  seenBy: readonly string[];
  /** A watcher whose sight is one move away, or sweeps onto the player next turn. */
  nearTo: string | null;
  /** Guards that heard the player's last action. */
  heardBy: readonly string[];
  /** Guards within hearing range of the player's node now. */
  earshot: readonly string[];
  /** The watcher that raised the alarm on the last turn. */
  tripped: string | null;
  /** One short line for the meter. */
  reason: string;
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

/** The noise the player's last turn made, as the engine heard it. */
export function noiseCue(run: RunState): NoiseCue {
  const last = run.turns[run.turns.length - 1];
  const kind = last?.player.kind === "sprint" || last?.player.kind === "pick" ? last.player.kind : null;
  if (!kind) return { loud: false, kind: null, rangeHops: 0, heardBy: [] };
  const source = last.player.nodeId;
  const rangeHops = hearingRange(run.board, source);
  // The engine listens before the guards move: where they stood is the turn before's log entry. The
  // noise alarm events of the turn name who heard it too (at Alert the engine logs none).
  const logged = run.alarmEvents.filter((e) => e.turn === last.turn && e.cause.kind === "noise" && e.cause.id).map((e) => e.cause.id!);
  const heard = withinHops(run.board, source, rangeHops);
  const before = run.turns[run.turns.length - 2]?.guards ?? run.guards.map((g) => ({ guardId: g.id, nodeId: g.nodeId }));
  const near = before.filter((g) => heard.has(g.nodeId)).map((g) => g.guardId);
  return { loud: true, kind, rangeHops, heardBy: [...new Set([...logged, ...near])] };
}

/** The guards within the engine's hearing range of the player's node, by id. */
export function earshot(run: RunState): string[] {
  const near = withinHops(run.board, run.playerNode, hearingRange(run.board, run.playerNode));
  return run.guards.filter((g) => near.has(g.nodeId)).map((g) => g.id);
}

/** How near the player stands to being noticed this turn, from the engine's state alone. */
export function noticeOf(run: RunState, sight: readonly Sight[]): Notice {
  const kinds = new Map(sight.map((s) => [s.id, s.kind]));
  const name = (id: string) => `${KIND_WORD[kinds.get(id) ?? "guard"]} ${id}`;
  const tripped = trippedBy(run);
  const heardBy = noiseCue(run).heardBy;
  const watched = watchedNodes(sight);
  const seenBy = watched.get(run.playerNode)?.by ?? [];
  const ears = earshot(run);

  // One open move from a watched node, or under a sweep's next part.
  let nearTo: string | null = null;
  if (seenBy.length === 0) {
    for (const exit of neighbours(run.board, run.playerNode)) {
      if (exit.doorId !== undefined && run.locked.includes(exit.doorId)) continue;
      const by = watched.get(exit.to)?.by[0];
      if (by) {
        nearTo = by;
        break;
      }
    }
    nearTo ??= sight.find((s) => s.next.includes(run.playerNode))?.id ?? null;
  }

  const alarm = run.alarm === "calm" ? 0 : run.alarm === "suspicious" ? NOTICE_LEVEL.suspicious : NOTICE_LEVEL.alert;
  const level = Math.max(
    seenBy.length > 0 ? NOTICE_LEVEL.seen : 0,
    tripped ? NOTICE_LEVEL.tripped : 0,
    nearTo ? NOTICE_LEVEL.near : 0,
    heardBy.length > 0 ? NOTICE_LEVEL.heard : 0,
    ears.length > 0 ? NOTICE_LEVEL.earshot : 0,
    alarm,
  );
  const tone: NoticeTone = seenBy.length > 0 || tripped || level >= NOTICE_LEVEL.alert ? "danger" : level > 0 ? "warning" : "calm";
  const reason =
    seenBy.length > 0
      ? `${name(seenBy[0])} has you in view`
      : tripped
        ? `${name(tripped)} saw you`
        : heardBy.length > 0
          ? `${heardBy.join(", ")} heard you`
          : nearTo
            ? `Next to ${name(nearTo)}'s sight`
            : run.alarm !== "calm"
              ? `Alarm ${run.alarm}`
              : ears.length > 0
                ? `${ears.join(", ")} in earshot`
                : "Unseen";
  return { level, tone, seenBy, nearTo, heardBy, earshot: ears, tripped, reason };
}
