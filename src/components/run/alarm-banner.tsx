import type { AlarmState } from "@/domain";
import { cn } from "@/lib/utils";

/**
 * The alarm's state in the colours DESIGN.md assigns: Calm in the neutral
 * secondary text, Suspicious in `--warning`, Alert and Lockdown in `--danger`.
 * The accent never marks an alarm.
 */
export const ALARM_STYLE: Readonly<Record<AlarmState, { label: string; text: string; bar: string; note: string }>> = {
  calm: { label: "Calm", text: "text-text-2", bar: "border-border-strong", note: "Nobody knows you're here." },
  suspicious: { label: "Suspicious", text: "text-warning", bar: "border-warning", note: "Something was heard. Guards are listening." },
  alert: { label: "Alert", text: "text-danger", bar: "border-danger", note: "You were seen. Guards are converging." },
  lockdown: { label: "Lockdown", text: "text-danger", bar: "border-danger", note: "The floor is locked down." },
};

/** `turn` is null in first person, played in real time: no turn count shows. */
export function AlarmBanner({ alarm, turn }: { alarm: AlarmState; turn: number | null }) {
  const style = ALARM_STYLE[alarm];
  return (
    <section
      data-testid="alarm-banner"
      data-state={alarm}
      aria-label="Alarm"
      // No transition: the trip shows on the next frame (DESIGN.md the wow beat: under 100 ms).
      className={cn("border-l-2 pl-4", style.bar)}
    >
      <div className="flex items-baseline justify-between">
        <p className="label-caps text-text-3">Alarm</p>
        {turn === null ? null : (
          <p className="label-caps text-text-3">
            Turn <span data-testid="turn" className="font-mono text-text-1">{turn}</span>
          </p>
        )}
      </div>
      <p
        role="status"
        aria-live="assertive"
        data-testid="alarm-state"
        className={cn("text-3xl font-semibold", style.text)}
      >
        {style.label}
      </p>
      <p className="mt-1 text-sm text-text-2">{style.note}</p>
    </section>
  );
}
