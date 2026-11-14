// How the drill view plays a report back (SPEC §2 beat 7): the whole
// evacuation in under 10 seconds, at a whole-number speed the screen states,
// so "7× speed" is exactly true.
import type { DrillOccupant, DrillReport } from "@/drill";

/** The most real-time seconds the playback may take; the acceptance bar is 10. */
export const PLAYBACK_BUDGET_S = 8;

/** The whole-number speed that plays `timeToClearS` within the budget. */
export function speedFor(timeToClearS: number): number {
  return Math.max(1, Math.ceil(timeToClearS / PLAYBACK_BUDGET_S));
}

/** Real-time milliseconds the playback of `timeToClearS` takes at `speed`. */
export function playbackMs(timeToClearS: number, speed: number): number {
  return (timeToClearS / speed) * 1000;
}

/** Where an occupant is `simS` seconds after the alarm, between their ticks; null once in a stair (or stranded). */
export function positionAt(occupant: DrillOccupant, simS: number): { x: number; y: number } | null {
  const { track } = occupant;
  if (track.length === 0) return null;
  if (occupant.clearedAtS !== null && simS >= occupant.clearedAtS) return null;
  const i = Math.max(0, Math.min(track.length - 1, Math.floor(simS)));
  const j = Math.min(track.length - 1, i + 1);
  const t = Math.max(0, Math.min(1, simS - i));
  return { x: track[i].x + (track[j].x - track[i].x) * t, y: track[i].y + (track[j].y - track[i].y) * t };
}

/** Occupants in a stair by `simS`. */
export function clearedBy(report: DrillReport, simS: number): number {
  return report.occupants.filter((o) => o.clearedAtS !== null && o.clearedAtS <= simS).length;
}

/** "54 s"; "1,108 s" for big numbers. */
export function seconds(n: number): string {
  return `${Math.round(n).toLocaleString("en-US")} s`;
}

/**
 * When the board's suite numbers belong to another floor than the one drilled
 * (one typical-floor plan serves every floor), the floor they are numbered as.
 * Null when they match, or when the labels carry no suite numbers.
 */
export function planNumberedAs(roomLabels: readonly string[], floor: number): number | null {
  const floors = new Set<number>();
  for (const label of roomLabels) {
    for (const m of label.matchAll(/\b(\d{3,4})\b/g)) floors.add(Math.floor(Number(m[1]) / 100));
  }
  if (floors.size !== 1) return null;
  const [numbered] = [...floors];
  return numbered === floor ? null : numbered;
}

/** A small, stable offset for an occupant's dot, so a queue reads as a crowd rather than one dot. */
export function jitterOf(id: string): { dx: number; dy: number } {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const a = ((h >>> 0) % 360) * (Math.PI / 180);
  const r = 2 + ((h >>> 9) % 4);
  return { dx: Math.cos(a) * r, dy: Math.sin(a) * r * 0.6 };
}
