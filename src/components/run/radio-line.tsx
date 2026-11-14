import { cn } from "@/lib/utils";

// The radio line (issue 100): what is happening right now, as one voice in
// the player's ear. One line at a time, each with its speaker. It takes plain
// words and knows nothing about the board, so the first-person scan view
// shows the same line. Which line is on the air is radio.ts's business.

/** How a line reads: an ordinary one, a noise heard (`--warning`), or a sighting (`--danger`). */
export type RadioTone = "plain" | "warning" | "danger";

export interface RadioLineProps {
  /** The line on the air; null when the radio is quiet. */
  line: { speaker: string; text: string; tone?: RadioTone } | null;
  className?: string;
}

/** What the line says when nobody is on the air. */
export const RADIO_QUIET = "Radio quiet.";

const RULE: Readonly<Record<RadioTone, string>> = {
  plain: "border-border-strong",
  warning: "border-warning",
  danger: "border-danger",
};

/**
 * The line. A new line is a new element, so it fades in over `--t-base` (and
 * appears at once under `prefers-reduced-motion`); the box keeps its height
 * for two lines of text, so a long line never moves the board.
 */
export function RadioLine({ line, className }: RadioLineProps) {
  const tone = line?.tone ?? "plain";
  return (
    <div
      data-testid="radio-line"
      data-speaker={line?.speaker}
      data-tone={line ? tone : undefined}
      className={cn(
        "flex min-h-14 items-center gap-3 rounded-md border border-border border-l-2 bg-surface-1 py-2 pr-4 pl-3 shadow-e-1",
        RULE[tone],
        className,
      )}
    >
      <p className="w-12 shrink-0 label-caps text-text-2" data-testid="radio-speaker">
        {line ? line.speaker : "Radio"}
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
