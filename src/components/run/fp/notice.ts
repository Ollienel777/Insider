// How near the player is to being noticed, in first person (issue 146): the
// one suspicion meter and the noise cue. Every level is read from the engine's
// own run state, through the same `cones` and `coverage` the board draws
// (board.ts), so the meter can never disagree with the board:
//
// - Seen: a camera's or a guard's sight this turn covers the player's node.
//   The engine would raise the alarm to Alert on it: red.
// - Tripped: the alarm went up on the last turn, and who raised it.
// - Heard: the player's last turn was a sprint or a pick (the engine's noisy
//   actions), and guards stood within hearing range of where it ended. As in
//   the engine, noise counts for nothing once the alarm is at Alert.
// - Glimpsed: only a cleaner's sight covers the player's node. The engine
//   takes a cleaner's look as a suspicion, Suspicious at most, and ignores it
//   at Alert: amber, never red.
// - Next to sight: a node someone watches this turn is one open move away, or
//   a sweeping camera covers the player's node next turn.
// - In earshot: a guard stands within the engine's hearing range, in hops: a
//   sprint or a pick here would be heard.
// - The alarm's level sets a floor under all of it.
//
// Pure: no DOM, no renderer.
import type { AlarmState } from "@/domain";
import { hearingRange, neighbours, withinHops, type RunState } from "@/engine";
import { cones, coverage, type WatcherKind } from "../board";
import { trippedBy } from "./sight";

export type NoticeTone = "calm" | "warning" | "danger";

/** The meter's level for each thing that can be true at once; the highest wins. */
export const NOTICE_LEVEL = Object.freeze({
  seen: 1,
  tripped: 0.8,
  alert: 0.8,
  near: 0.6,
  heard: 0.6,
  glimpsed: 0.6,
  suspicious: 0.4,
  earshot: 0.2,
});

/** What the meter's line is about: the first of these that holds, in this order. */
export type NoticeCause = "seen" | "tripped" | "heard" | "glimpsed" | "near" | "alarm" | "earshot" | "unseen";

export interface Notice {
  /** 0 nothing near, 1 seen. */
  level: number;
  tone: NoticeTone;
  /** What the line names, which sets its icon: the ear for noise, the eye for sight. */
  cause: NoticeCause;
  /** Cameras and guards whose sight covers the player's node this turn. */
  seenBy: readonly string[];
  /** Cleaners whose sight covers it, while their look still counts (below Alert). */
  glimpsedBy: readonly string[];
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
  /** Guards within that range, which the engine had hear it: none when it was at Alert and ignored the noise. */
  heardBy: readonly string[];
}

const KIND_WORD: Record<WatcherKind, string> = { camera: "Camera", guard: "Guard", cleaner: "Cleaner" };

const isAlert = (alarm: AlarmState) => alarm === "alert" || alarm === "lockdown";

/** The noise the player's last turn made, as the engine heard it. */
export function noiseCue(run: RunState): NoiseCue {
  const last = run.turns[run.turns.length - 1];
  const kind = last?.player.kind === "sprint" || last?.player.kind === "pick" ? last.player.kind : null;
  if (!kind) return { loud: false, kind: null, rangeHops: 0, heardBy: [] };
  const source = last.player.nodeId;
  const rangeHops = hearingRange(run.board, source);
  // At Alert the engine drops what a guard hears (alarm.ts `detect`). The alarm as the turn began is
  // the `from` of the turn's first transition (a `set` between turns is not one of them), or, with
  // none, the alarm as it stands.
  const during = run.alarmEvents.filter((e) => e.turn === last.turn && e.cause.kind !== "set");
  if (isAlert(during[0]?.from ?? run.alarm)) return { loud: true, kind, rangeHops, heardBy: [] };
  // The engine listens before the guards move: where they stood is the turn before's log entry, or,
  // on the run's first turn, the first node of each patrol. The turn's noise events name who heard it too.
  const logged = during.filter((e) => e.cause.kind === "noise" && e.cause.id).map((e) => e.cause.id!);
  const heard = withinHops(run.board, source, rangeHops);
  const before = run.turns[run.turns.length - 2]?.guards ?? run.board.level.guards.map((g) => ({ guardId: g.id, nodeId: g.patrol[0] }));
  const near = before.filter((g) => heard.has(g.nodeId)).map((g) => g.guardId);
  return { loud: true, kind, rangeHops, heardBy: [...new Set([...logged, ...near])] };
}

/** The guards within the engine's hearing range of the player's node, by id. */
export function earshot(run: RunState): string[] {
  const near = withinHops(run.board, run.playerNode, hearingRange(run.board, run.playerNode));
  return run.guards.filter((g) => near.has(g.nodeId)).map((g) => g.id);
}

/** How near the player stands to being noticed this turn, from the engine's state alone. */
export function noticeOf(run: RunState): Notice {
  const sight = cones(run);
  const kinds = new Map(sight.map((s) => [s.id, s.kind]));
  const name = (id: string) => `${KIND_WORD[kinds.get(id) ?? "guard"]} ${id}`;
  const names = (ids: readonly string[]) =>
    ids.length <= 1 ? name(ids[0]) : `${ids.slice(0, -1).map(name).join(", ")} and ${name(ids[ids.length - 1])}`;
  const alert = isAlert(run.alarm);
  // A cleaner's look counts for nothing at Alert; a camera's or a guard's always does.
  const counts = (id: string) => kinds.get(id) !== "cleaner" || !alert;
  const watched = coverage(run);
  const covering = (watched.get(run.playerNode) ?? []).filter(counts);
  const seenBy = covering.filter((id) => kinds.get(id) !== "cleaner");
  const glimpsedBy = covering.filter((id) => kinds.get(id) === "cleaner");
  const tripped = trippedBy(run);
  const heardBy = noiseCue(run).heardBy;
  const ears = earshot(run);

  // One open move from a watched node, or under a sweep's next part.
  let nearTo: string | null = null;
  if (covering.length === 0) {
    for (const exit of neighbours(run.board, run.playerNode)) {
      if (exit.doorId !== undefined && run.locked.includes(exit.doorId)) continue;
      const by = (watched.get(exit.to) ?? []).find(counts);
      if (by) {
        nearTo = by;
        break;
      }
    }
    nearTo ??= sight.find((s) => counts(s.id) && s.next.includes(run.playerNode))?.id ?? null;
  }

  const floor = run.alarm === "calm" ? 0 : run.alarm === "suspicious" ? NOTICE_LEVEL.suspicious : NOTICE_LEVEL.alert;
  const level = Math.max(
    seenBy.length > 0 ? NOTICE_LEVEL.seen : 0,
    tripped ? NOTICE_LEVEL.tripped : 0,
    glimpsedBy.length > 0 ? NOTICE_LEVEL.glimpsed : 0,
    nearTo ? NOTICE_LEVEL.near : 0,
    heardBy.length > 0 ? NOTICE_LEVEL.heard : 0,
    ears.length > 0 ? NOTICE_LEVEL.earshot : 0,
    floor,
  );
  // Red is what raises the alarm to Alert, or the alarm there already; amber is anything less.
  const tone: NoticeTone = seenBy.length > 0 || tripped || alert ? "danger" : level > 0 ? "warning" : "calm";
  const cause: NoticeCause =
    seenBy.length > 0
      ? "seen"
      : tripped
        ? "tripped"
        : heardBy.length > 0
          ? "heard"
          : glimpsedBy.length > 0
            ? "glimpsed"
            : nearTo
              ? "near"
              : run.alarm !== "calm"
                ? "alarm"
                : ears.length > 0
                  ? "earshot"
                  : "unseen";
  const reason: Record<NoticeCause, () => string> = {
    seen: () => `${name(seenBy[0])} has you in view`,
    tripped: () => `${name(tripped!)} saw you`,
    heard: () => `${names(heardBy)} heard you`,
    glimpsed: () => `${name(glimpsedBy[0])} has you in view`,
    near: () => `Next to ${name(nearTo!)}'s sight`,
    alarm: () => `Alarm ${run.alarm}`,
    earshot: () => `${names(ears)} in earshot`,
    unseen: () => "Unseen",
  };
  return { level, tone, cause, seenBy, glimpsedBy, nearTo, heardBy, earshot: ears, tripped, reason: reason[cause]() };
}
