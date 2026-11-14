import type { AlarmState } from "@/domain";
import { cn } from "@/lib/utils";
import { ALARM_STYLE } from "./alarm-banner";

// The danger meter (issue 100): how much danger the player is in, at a glance.
// The alarm level as a word and as four steps, and who sees or hears the
// player this turn. It takes plain data and knows nothing about the board, so
// the first-person scan view shows the same meter. The colours are the
// alarm's own (alarm-banner.tsx): quiet at Calm, `--warning` at Suspicious,
// `--danger` from Alert up.

/** Somebody who noticed the player this turn: a guard, camera or cleaner by its id, and how. */
export interface Watcher {
  id: string;
  sense: "sees" | "hears";
}

/** The alarm's levels, lowest first: the meter fills one step for each. */
const STEPS: readonly AlarmState[] = ["calm", "suspicious", "alert", "lockdown"];

/** The fill of a step that is reached, by level. Calm is lit in a neutral, so a quiet meter stays quiet. */
const FILL: Readonly<Record<AlarmState, string>> = {
  calm: "bg-n-400",
  suspicious: "bg-warning",
  alert: "bg-danger",
  lockdown: "bg-danger",
};

/** What the meter says when nobody noticed the player this turn. */
export const UNSEEN = "Out of sight";

function listOf(ids: readonly string[]): string {
  if (ids.length <= 1) return ids[0] ?? "";
  return `${ids.slice(0, -1).join(", ")} and ${ids[ids.length - 1]}`;
}

/**
 * Who noticed the player, in words: "C2 sees you", "G1 and G3 see you",
 * "G2 hears you", or both, the sightings first. One who sees and hears is
 * named once, as seeing. Empty for nobody.
 */
export function watcherPhrase(watchers: readonly Watcher[]): string {
  const seers = [...new Set(watchers.filter((w) => w.sense === "sees").map((w) => w.id))];
  const hearers = [...new Set(watchers.filter((w) => w.sense === "hears").map((w) => w.id))].filter((id) => !seers.includes(id));
  const parts: string[] = [];
  if (seers.length > 0) parts.push(`${listOf(seers)} ${seers.length === 1 ? "sees" : "see"} you`);
  if (hearers.length > 0) parts.push(`${listOf(hearers)} ${hearers.length === 1 ? "hears" : "hear"} you`);
  return parts.join(", ");
}

/**
 * The meter. The level word is an alert: a change of level is announced at
 * once, over whatever else is being read, since in Live the clock does not
 * wait for it. The block flashes once in the level's colour when it changes
 * (`.alarm-change`, globals.css), and not at all under
 * `prefers-reduced-motion`.
 */
export function DangerMeter({
  alarm,
  watchers,
  className,
}: {
  alarm: AlarmState;
  watchers: readonly Watcher[];
  className?: string;
}) {
  const style = ALARM_STYLE[alarm];
  const reached = STEPS.indexOf(alarm);
  const noticed = watchers.length > 0;
  return (
    <section
      aria-label="Danger"
      data-testid="danger-meter"
      data-alarm={alarm}
      className={cn("relative border-l-2 py-0.5 pl-3", style.bar, className)}
    >
      {/* A new level is a new element, so its flash plays from the start. Calm never flashes. */}
      {alarm === "calm" ? null : (
        <span key={alarm} aria-hidden className={cn("alarm-change pointer-events-none absolute inset-0", style.text)} />
      )}
      <div className="flex items-center gap-3">
        <p className="label-caps text-text-3">Alarm</p>
        <span aria-hidden data-testid="danger-steps" data-reached={reached + 1} className="flex gap-1">
          {STEPS.map((step, i) => (
            <span key={step} className={cn("h-1.5 w-5", i <= reached ? FILL[alarm] : "bg-surface-3")} />
          ))}
        </span>
      </div>
      <p className="flex flex-wrap items-baseline gap-x-2 text-base">
        <span role="alert" data-testid="danger-level" className={cn("text-lg font-semibold", style.text)}>
          {style.label}
        </span>
        <span data-testid="danger-watchers" data-noticed={noticed ? "true" : "false"} className={noticed ? "text-text-1" : "text-text-2"}>
          {noticed ? watcherPhrase(watchers) : UNSEEN}
        </span>
      </p>
    </section>
  );
}
