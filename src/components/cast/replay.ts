// The cast screen's replay of the Casting Director's recorded run (SPEC §2
// beat 2): one clock, about eight seconds, drives three things. The trace's
// rows reveal as the dossier's do; each funnel row lands as the location
// scout's `search_inventory` call for it returns, and the pins its filter
// drops dim with it; the finalist cards fill as `write_shortlist` returns.
// The recorded run took a fraction of a second, so the replay spaces its
// moments evenly instead of keeping the recorded gaps.
//
// Pure: the screen asks what is shown at `elapsed` ms, so a test can too.
import type { CastingTrace } from "@/domain";

/** When the first trace moment shows. */
export const CAST_START_MS = 400;
/** From the first trace moment to the last. */
export const CAST_TRACE_MS = 7000;
/** How long after `write_shortlist` shows the finalist cards fill. */
export const CARDS_LAG_MS = 250;

export interface CastSchedule {
  /** When each trace event shows, by index into `trace.events`. */
  events: number[];
  /** When each funnel row lands, by index into `funnel`. */
  rows: number[];
  /** When the finalist cards fill. */
  cards: number;
  /** When everything has shown. */
  end: number;
}

/**
 * The replay's timing. Events recorded at the same moment show together, and
 * each distinct moment gets an equal slot. Funnel row k (k ≥ 1) lands with
 * the k-th `search_inventory` call; the first row, the whole inventory, with
 * the first such call's task. A funnel with more rows than recorded searches
 * spreads the rest evenly up to the cards, so every row still lands in order.
 */
export function castSchedule(trace: Pick<CastingTrace, "events">, rowCount: number): CastSchedule {
  const moments = [...new Set(trace.events.map((e) => e.atMs))].sort((a, b) => a - b);
  const step = moments.length > 1 ? CAST_TRACE_MS / (moments.length - 1) : 0;
  const events = trace.events.map((e) => CAST_START_MS + moments.indexOf(e.atMs) * step);
  const last = CAST_START_MS + CAST_TRACE_MS;

  const shortlist = trace.events.findIndex((e) => e.kind === "tool" && e.label === "write_shortlist");
  const cards = (shortlist >= 0 ? events[shortlist] : last) + CARDS_LAG_MS;

  const searches = trace.events.flatMap((e, i) => (e.kind === "tool" && e.label === "search_inventory" ? [events[i]] : []));
  const firstSearch = trace.events.findIndex((e) => e.kind === "tool" && e.label === "search_inventory");
  const task = firstSearch >= 0 ? trace.events.findLastIndex((e, i) => i < firstSearch && e.kind === "subagent") : -1;
  const rows: number[] = [];
  for (let k = 0; k < rowCount; k++) {
    let at = k === 0 ? (task >= 0 ? events[task] : searches[0]) : searches[k - 1];
    if (at === undefined) {
      // No recorded search for this row: spread it between the last one placed and the cards.
      const from = rows[k - 1] ?? CAST_START_MS;
      const remaining = rowCount - k;
      at = from + (cards - CARDS_LAG_MS - from) / (remaining + 1);
    }
    rows.push(Math.max(at, rows[k - 1] ?? 0));
  }
  const end = Math.max(last, cards, ...rows, ...events);
  return { events, rows, cards, end };
}

/** How many funnel rows have landed at `elapsed`. */
export function rowsLanded(schedule: CastSchedule, elapsed: number): number {
  return schedule.rows.filter((at) => elapsed >= at).length;
}

export type PinState = "in" | "out";

/**
 * A pin is out once the row of the filter it fails has landed (`outAt`, 1 for
 * the first filter); a pin that passes every filter, or whose row has not
 * landed yet, is still in.
 */
export function pinState(outAt: number | null, landed: number): PinState {
  return outAt !== null && outAt < landed ? "out" : "in";
}

/** The count the funnel stands at once `landed` rows have shown; null before the first. */
export function countLeft(funnel: readonly { count: number }[], landed: number): number | null {
  return landed > 0 ? funnel[Math.min(landed, funnel.length) - 1].count : null;
}
