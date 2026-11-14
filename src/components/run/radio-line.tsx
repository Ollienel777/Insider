import { cn } from "@/lib/utils";

// The radio line (issue 100): what is happening right now, as one voice in
// the player's ear. One line at a time, each with its speaker. It takes plain
// words and knows nothing about the board, so the first-person scan view
// shows the same line. Which line is on the air is radio.ts's business.

/**
 * How a line reads, by the rule down its left edge and its speaker's colour:
 * `next` for the step to take (the accent, as the plan's current step),
 * `warning` for a noise heard, `danger` for a sighting, `plain` otherwise.
 */
export type RadioTone = "plain" | "next" | "warning" | "danger";

export interface RadioLineProps {
  /**
   * The line on the air; null when the radio is quiet. `tag` is a word beside
   * the speaker for where the line came from: "Recorded" on a Chief's line no
   * model wrote.
   */
  line: { speaker: string; text: string; tone?: RadioTone; tag?: string | null } | null;
  className?: string;
}

/** What the line says when nobody is on the air. */
export const RADIO_QUIET = "Radio quiet.";

const RULE: Readonly<Record<RadioTone, string>> = {
  plain: "border-l-border-strong",
  next: "border-l-accent",
  warning: "border-l-warning",
  danger: "border-l-danger",
};

const SPEAKER: Readonly<Record<RadioTone, string>> = {
  plain: "text-text-2",
  next: "text-text-2",
  warning: "text-warning",
  danger: "text-danger",
};

/**
 * The line. A new line is a new element, so it fades in over `--t-base` (and
 * appears at once under `prefers-reduced-motion`). The box keeps room for two
 * lines of text, so a long line never moves what it sits against. On a phone
 * the speaker goes above the words, which then have the whole width.
 */
export function RadioLine({ line, className }: RadioLineProps) {
  const tone = line?.tone ?? "plain";
  return (
    <div
      data-testid="radio-line"
      data-speaker={line?.speaker}
      data-tone={line ? tone : undefined}
      className={cn(
        "flex gap-x-4 gap-y-1 rounded-md border border-l-2 border-border bg-surface-1 py-2 pr-4 pl-3 shadow-e-1",
        "max-md:min-h-20 max-md:flex-col md:min-h-16 md:items-center",
        RULE[tone],
        className,
      )}
    >
      <p className="flex shrink-0 gap-x-2 label-caps md:w-20 md:flex-col">
        <span data-testid="radio-speaker" className={SPEAKER[tone]}>
          {line ? line.speaker : "Radio"}
        </span>
        {line?.tag ? (
          <span data-testid="radio-tag" className="text-text-3">
            {line.tag}
          </span>
        ) : null}
      </p>
      <p aria-live="polite" className="min-w-0 flex-1 text-base text-text-1">
        {line ? (
          <span key={`${line.speaker}:${line.text}`} data-testid="radio-text" className="block animate-in fade-in-0 duration-base">
            {line.text}
          </span>
        ) : (
          <span data-testid="radio-quiet" className="text-text-2">
            {RADIO_QUIET}
          </span>
        )}
      </p>
    </div>
  );
}
