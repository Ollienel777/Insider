// What the Debrief shows (SPEC §2 beat 6, DESIGN.md Debrief), read off the
// run's log and the level it was played on. Pure: every figure and sentence
// here is a function of the `RunLog` the Run screen wrote (its turns, its
// alarm transitions and the Chief's orders) and of the placed level, so
// nothing on the screen is written that the run did not produce.
import type { AlarmState, ChiefOrders, ChiefSource, GuardOrder, RunAlarmEvent, RunLog, RunOutcome } from "@/domain";
import { applyChiefOrders, createRun, LEVELS } from "@/engine";
import { quietRoute, type PlacedLevel } from "@/level/placer";
import { roomName, zoneName } from "@/components/run/board";

export type Grade = "S" | "A" | "B" | "C" | "D";

/** The board after `turn` turns: frame 0 is the start, frame N the end of the run. */
export interface Frame {
  turn: number;
  player: string;
  guards: readonly { guardId: string; nodeId: string }[];
  alarm: AlarmState;
  /** The player holds the objective by now. */
  carrying: boolean;
  /** The camera or guard whose sighting raised the alarm on the turn that led here, if one did. */
  tripped: string | null;
}

/** One Chief re-plan, as the run's log carries it. */
export interface Decision {
  /** The frame it was given on: after this many turns, before the next one. */
  turn: number;
  rationale: string;
  orders: readonly { guardId: string; intent: GuardOrder["intent"]; zone: string }[];
  /** The zones it locked, by name. */
  locks: readonly string[];
  /** What the engine refused: an unknown guard or zone, or a zone with no lockable door. */
  dropped: readonly { guardId: string; intent: string; reason: string }[];
  source: ChiefSource | null;
  /** It arrived after the run had ended: the Run screen showed it, but no guard ever got its orders. */
  late: boolean;
}

/** What a late decision says in place of orders taking effect: the words the Run screen's panel used. */
export { LATE_NOTE } from "@/components/run/chief-panel";

export interface Stats {
  /** Turns played. */
  turns: number;
  /** The shortest route the engine finds on which the alarm never moves; null when the level has none. */
  par: number | null;
  /** Noisy actions: picks and sprints, the actions a guard can hear. */
  noise: number;
  picks: number;
  sprints: number;
  /** Alarm raises caused by something noticing the player: a camera, a guard, a cleaner or noise. */
  detections: number;
  /** The highest the alarm reached. */
  peak: AlarmState;
}

export interface Debrief {
  outcome: RunOutcome;
  /** Null while the run is still being played. */
  grade: Grade | null;
  /** Why the grade is what it is, in one line. */
  gradeReason: string;
  /** The outcome in a few words, and what caught the player or how they got out. */
  headline: string;
  detail: string;
  stats: Stats;
  decisions: readonly Decision[];
  /** Said in place of the timeline when the Chief made no decision on the run. */
  noDecisions: string;
  frames: readonly Frame[];
}

/** The log of a run on the board that hasn't had a turn yet: there is nothing to replay or grade. */
export const notStarted = (log: RunLog): boolean => log.status === "playing" && log.turns.length === 0;

/** A log the Debrief cannot read: written before it existed, or for another level. */
export class UnreadableLog extends Error {
  override name = "UnreadableLog";
}

const DETECTED = new Set<RunAlarmEvent["cause"]["kind"]>(["camera", "guard", "cleaner", "noise"]);
const rank = (alarm: AlarmState) => LEVELS.indexOf(alarm);
const ALARM_LABEL: Record<AlarmState, string> = { calm: "Calm", suspicious: "Suspicious", alert: "Alert", lockdown: "Lockdown" };

/** Joins ids as "G1", "G1 and G2", "G1, G2 and G3". */
function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The run's frames, start first. Frame 0 is the level's own start (the log
 * begins with the first turn's end); frame k is the log's turn k − 1.
 */
export function framesOf(placed: PlacedLevel, log: RunLog, events: readonly RunAlarmEvent[]): Frame[] {
  const start = createRun(placed.level);
  const trippedOn = (index: number) => {
    const raised = events.find((e) => e.turn === index && rank(e.to) > rank(e.from) && (e.cause.kind === "camera" || e.cause.kind === "guard"));
    return raised?.cause.id ?? null;
  };
  const frames: Frame[] = [
    {
      turn: 0,
      player: start.playerNode,
      guards: start.guards.map((g) => ({ guardId: g.id, nodeId: g.nodeId })),
      alarm: start.alarm,
      carrying: false,
      tripped: null,
    },
  ];
  let carrying = false;
  log.turns.forEach((t, i) => {
    carrying ||= t.player.kind === "take";
    frames.push({ turn: i + 1, player: t.player.nodeId, guards: t.guards, alarm: t.alarm, carrying, tripped: trippedOn(i) });
  });
  return frames;
}

/**
 * The Debrief of `log` as played on `placed`. Throws `UnreadableLog` when the
 * log was not written for this level, or predates the outcome and alarm
 * transitions the Debrief reads.
 */
export function debriefOf(placed: PlacedLevel, log: RunLog, par: number | null = parOf(placed)): Debrief {
  const { level } = placed;
  if (log.status === undefined || log.alarmEvents === undefined) {
    throw new UnreadableLog("the log was written before the Debrief existed");
  }
  if (log.buildingId !== level.buildingId || log.missionId !== level.missionId) {
    throw new UnreadableLog(`the log is for ${log.buildingId} / ${log.missionId}, not this level`);
  }
  const nodes = new Set(level.floor.nodes.map((n) => n.id));
  const guardIds = new Set(level.guards.map((g) => g.id));
  for (const t of log.turns) {
    if (!nodes.has(t.player.nodeId) || t.guards.some((g) => !nodes.has(g.nodeId) || !guardIds.has(g.guardId))) {
      throw new UnreadableLog(`turn ${t.turn} names a node or guard this level does not have`);
    }
  }

  const outcome = log.status;
  const events = log.alarmEvents;
  const frames = framesOf(placed, log, events);
  const last = frames[frames.length - 1];
  const turns = log.turns.length;
  const picks = log.turns.filter((t) => t.player.kind === "pick").length;
  const sprints = log.turns.filter((t) => t.player.kind === "sprint").length;
  const detections = events.filter((e) => DETECTED.has(e.cause.kind)).length;
  // The highest the alarm stood at a turn's end, or reached during one.
  const peak = [...frames.map((f) => f.alarm), ...events.map((e) => e.to)].reduce<AlarmState>(
    (top, alarm) => (rank(alarm) > rank(top) ? alarm : top),
    "calm",
  );
  const stats: Stats = { turns, par, noise: picks + sprints, picks, sprints, detections, peak };

  const where = (nodeId: string) => roomName(level.floor, nodeId);
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  // The first sighting that put the alarm at Alert or above: what tripped the wow beat.
  const trip = events.find((e) => rank(e.to) >= rank("alert") && rank(e.to) > rank(e.from) && DETECTED.has(e.cause.kind));
  // Where it noticed them: the zone the engine recorded, which is where the player was, even mid-sprint.
  const tripPlace = trip ? (trip.lastKnownZone ? zoneName(placed, trip.lastKnownZone) : where(frames[trip.turn + 1].player)) : "";
  const tripLine = trip
    ? `${trip.cause.id ?? "Someone"} ${trip.cause.kind === "noise" ? "heard" : "saw"} you in the ${tripPlace} on turn ${trip.turn + 1}.`
    : null;

  let grade: Grade | null;
  let gradeReason: string;
  let headline: string;
  let detail: string;
  if (outcome === "caught") {
    const by = last.guards.filter((g) => g.nodeId === last.player).map((g) => g.guardId);
    grade = "D";
    gradeReason = "A caught run grades D, whatever came before.";
    headline = `Caught in the ${where(last.player)}.`;
    detail = [tripLine, by.length > 0 ? `${joinAnd(by)} reached you on turn ${turns}.` : null].filter(Boolean).join(" ");
  } else if (outcome === "won") {
    const exit = placed.entries.find((e) => e.nodeId === last.player)?.label ?? where(last.player);
    headline = "Out with the files.";
    detail =
      detections === 0
        ? `Out through the ${exit.toLowerCase()} in ${plural(turns, "turn")}, never seen.`
        : `Out through the ${exit.toLowerCase()} in ${plural(turns, "turn")}, after ${plural(detections, "detection")}.`;
    if (rank(peak) >= rank("alert")) {
      grade = "C";
      gradeReason = `Out, but the alarm reached ${ALARM_LABEL[peak]}.`;
    } else if (detections > 0) {
      grade = "B";
      gradeReason = "Out, but the alarm reached Suspicious.";
    } else if (sprints > 0) {
      grade = "A";
      gradeReason = `Never seen, but you sprinted ${plural(sprints, "time")}.`;
    } else if (par !== null && turns > par) {
      grade = "A";
      gradeReason = `Never seen, ${plural(turns - par, "turn")} over par.`;
    } else {
      grade = "S";
      gradeReason = par !== null ? `Never seen, and on par: ${turns} turns.` : "Never seen, never sprinted.";
    }
  } else {
    grade = null;
    gradeReason = "The run isn't over, so there's no grade yet.";
    headline = "Still on the floor.";
    detail = [`${plural(turns, "turn")} played so far.`, tripLine].filter(Boolean).join(" ");
  }

  // The log keeps the orders as the Chief gave them; the engine's own clamp
  // says which it kept. It refuses unknown guards and zones, and zones with no
  // lockable door, none of which depends on the turn; and everything given at
  // Calm, which is the alarm of the frame the decision was given on.
  const fresh = createRun(level);
  const decisionOf = (turn: number, chief: ChiefOrders, source: ChiefSource | undefined, late: boolean): Decision => {
    const alarm = frames[turn]?.alarm ?? "calm";
    const { applied, locked, dropped } = applyChiefOrders({ ...fresh, alarm }, chief);
    return {
      turn,
      rationale: chief.rationale,
      orders: applied.map((o) => ({ guardId: o.guardId, intent: o.intent, zone: zoneName(placed, o.zoneId) })),
      locks: locked.map((l) => zoneName(placed, l.zoneId)),
      dropped: dropped.map((d) =>
        "guardId" in d.order
          ? { guardId: d.order.guardId, intent: d.order.intent, reason: d.reason }
          : { guardId: "", intent: "lock", reason: d.reason },
      ),
      source: source ?? null,
      late,
    };
  };
  const decisions: Decision[] = log.turns.flatMap((t) => (t.chief ? [decisionOf(t.turn, t.chief, t.chiefSource, false)] : []));
  // An answer that landed after the run ended: the player watched it stream in, so it is listed, as late.
  if (log.lateChief) {
    const { turn, chief, chiefSource } = log.lateChief;
    if (turn !== log.turns.length || outcome === "playing") {
      throw new UnreadableLog(`the late Chief decision is on turn ${turn} of a ${outcome} run of ${log.turns.length} turns`);
    }
    decisions.push(decisionOf(turn, chief, chiefSource, true));
  }
  // Orders the guards are already acting on, in a run still being played, that no turn's entry carries yet.
  if (log.pendingChief) {
    const { turn, chief, chiefSource } = log.pendingChief;
    if (turn !== log.turns.length || outcome !== "playing") {
      throw new UnreadableLog(`the pending Chief decision is on turn ${turn} of a ${outcome} run of ${log.turns.length} turns`);
    }
    decisions.push(decisionOf(turn, chief, chiefSource, false));
  }
  // Said only of what the log shows: a run still being played has not ended, and its alarm may yet move.
  const noDecisions =
    outcome === "playing"
      ? events.length === 0
        ? "The alarm hasn't moved yet, so the Chief hasn't re-planned."
        : "The Chief hadn't answered when you left the run."
      : events.length === 0
        ? "The alarm never moved, so the Chief never re-planned."
        : "No orders reached the guards before the run ended.";

  return { outcome, grade, gradeReason, headline, detail, stats, decisions, noDecisions, frames };
}

/** Par: the turns of the shortest route on which the alarm never moves, as the engine plays it. */
export function parOf(placed: PlacedLevel): number | null {
  return quietRoute(placed)?.length ?? null;
}
