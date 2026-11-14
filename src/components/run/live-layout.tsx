"use client";

// The Run screen's layout in each play mode (issue 100).
//
// Tactical is the screen as it has always been: the board's bar, the board,
// the lens legend and the status line on the left, the panel on the right.
// `RunLayout` renders exactly that in Tactical, and adds nothing to it.
//
// Live answers three questions and puts the rest away: where am I going (the
// objective line), how much danger am I in (the danger meter), and what is
// happening right now (the radio line). They sit tight against the board, one
// row over it and one under it, so they never cover a piece. The side panel
// (the alarm banner, the Chief, the plan, the guards' orders), the board's bar
// with the Layer lens, the lens legend and the keys' legend are closed until
// the one Details control opens them. The board itself is not put away: its
// guards, cameras and locks still open their Why cards.
//
// The board is the same element in every mode, so its pieces, an open Why card
// and the play mode switch keep their state when the layout changes.
import { PanelRight, RotateCcw } from "lucide-react";
import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import { BuildingScreen } from "@/components/shell/building-screen";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { AlarmState } from "@/domain";
import { cn } from "@/lib/utils";
import { DangerMeter } from "./danger-meter";
import { ObjectiveLine } from "./objective-line";
import type { PlayHud } from "./play-hud";
import type { PlayMode } from "./play-mode";
import type { RadioKind, RadioMessage } from "./radio";
import { RadioLine, type RadioLineProps, type RadioTone } from "./radio-line";

/** Whether the panels show: always in Tactical, and in Live once Details has opened them. */
export function panelsOpen(mode: PlayMode, details: boolean): boolean {
  return mode !== "live" || details;
}

const TYPING = "input, textarea, select, [contenteditable=true], [contenteditable='']";

/**
 * Whether Details is open, and its toggle. In Live, `D` toggles it too,
 * except while typing; in Tactical there is no Details, and the key is left
 * alone. It starts closed, and stays as the player left it while they are on
 * the screen.
 */
export function useDetails(live: boolean): [boolean, () => void] {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((was) => !was), []);
  useEffect(() => {
    if (!live) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "d" && event.key !== "D") return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat || event.defaultPrevented) return;
      const target = event.target as Element | null;
      if (target?.closest?.(TYPING)) return;
      event.preventDefault();
      toggle();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [live, toggle]);
  return [open, toggle];
}

/**
 * Who says each kind of line, and how it reads. The crew is the voice in the
 * player's ear: the next step in the accent, a warning in the alarm's colours.
 * The Chief is the other side, overheard.
 */
const VOICE: Readonly<Record<RadioKind, { speaker: string; tone: RadioTone }>> = {
  step: { speaker: "Crew", tone: "next" },
  note: { speaker: "Crew", tone: "plain" },
  noise: { speaker: "Crew", tone: "warning" },
  sighting: { speaker: "Crew", tone: "danger" },
  chief: { speaker: "Chief", tone: "plain" },
};

/** A radio message as the radio line shows it: with its speaker, its tone and, for the Chief, where it came from. */
export function voiced(message: RadioMessage | null): RadioLineProps["line"] {
  return message ? { ...VOICE[message.kind], text: message.text, tag: message.tag ?? null } : null;
}

/** The rule under the HUD's top row: nothing at Calm, the alarm's colour above it. */
const HUD_RULE: Readonly<Record<AlarmState, string>> = {
  calm: "border-transparent",
  suspicious: "border-warning",
  alert: "border-danger",
  lockdown: "border-danger",
};

const OUTCOME_TONE = { won: "success", caught: "danger" } as const;

export interface RunLayoutProps {
  mode: PlayMode;
  /** Whether Details is open. Only Live reads it. */
  details: boolean;
  onDetails: () => void;
  /** What the HUD shows; null while there is no run on the board. */
  hud: PlayHud | null;
  /** The board is still being set up: the HUD shows its skeleton. */
  loading: boolean;
  /** Takes the objective, from the objective line's own button. */
  onTake: () => void;
  /** Starts the run over, from the objective line once the run has ended. */
  onRestart: () => void;
  /** The board's bar: the floor's source, the mission, the Layer lens and Restart. */
  bar: ReactNode;
  /** The board's area, with whatever sits over its corners. */
  board: ReactNode;
  /** The Layer lens's legend, when the lens is on. */
  legend: ReactNode;
  /** The status line and the keys' legend. */
  footer: ReactNode;
  /** The side panel. */
  panel: ReactNode;
  /** The screen's primary action, once the run is over. */
  action?: ReactNode;
}

/**
 * The Run screen's layout. In Tactical: the bar, the board, the legend and
 * the status line, with the panel beside them, as before Live existed. In
 * Live: the HUD's two rows around the board, and the rest only while Details
 * is open; while the board is set up, the HUD's skeleton. With no board coming
 * there is no run to show a HUD for, and Live looks as Tactical does.
 * Once a Live run is over with the panel closed, the objective line
 * says how it ended and carries the screen's action and Restart, which the
 * closed panel and bar would otherwise hold.
 */
export function RunLayout({
  mode,
  details,
  onDetails,
  hud,
  loading,
  onTake,
  onRestart,
  bar,
  board,
  legend,
  footer,
  panel,
  action,
}: RunLayoutProps) {
  // Live's layout is for a run: with no board coming (no floor, an error), the screen is Tactical's own.
  const live = mode === "live" && (hud !== null || loading);
  const open = !live || details;
  const objective = hud?.objective ?? null;
  return (
    <BuildingScreen
      visualLabel="Run board"
      panelClosed={!open}
      visualTall={live}
      visual={
        <div className="absolute inset-0 flex flex-col">
          {live ? (
            <div
              key="hud"
              data-testid="play-hud"
              className={cn(
                "flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3 border-b-2 px-6 pt-3 pb-2.5 max-md:px-4",
                HUD_RULE[hud?.danger.alarm ?? "calm"],
              )}
            >
              {objective ? (
                <ObjectiveLine
                  label={objective.label}
                  goal={objective.goal}
                  hops={objective.hops}
                  locks={objective.locks}
                  taken={objective.taken}
                  tone={objective.outcome ? OUTCOME_TONE[objective.outcome] : "plain"}
                  action={objective.take ? { label: objective.take, onAct: onTake, keyHint: "Space" } : null}
                  className="flex-1 basis-72"
                >
                  {objective.outcome && !open ? (
                    <div data-testid="live-end" className="flex shrink-0 items-center gap-2">
                      {action}
                      <Button variant="secondary" data-testid="live-restart" onClick={onRestart}>
                        <RotateCcw aria-hidden />
                        Restart
                      </Button>
                    </div>
                  ) : null}
                </ObjectiveLine>
              ) : (
                <div className="flex-1 basis-72">
                  <Skeleton data-testid="hud-skeleton" className="h-11 w-72 max-w-full" />
                </div>
              )}
              <div className="flex items-center gap-6 max-md:w-full max-md:justify-between">
                {hud ? <DangerMeter alarm={hud.danger.alarm} watchers={hud.danger.watchers} /> : <Skeleton className="h-11 w-48" />}
                <DetailsToggle open={details} onToggle={onDetails} />
              </div>
            </div>
          ) : null}
          {open ? <Fragment key="bar">{bar}</Fragment> : null}
          <Fragment key="board">{board}</Fragment>
          {open ? <Fragment key="legend">{legend}</Fragment> : null}
          {open ? (
            live ? (
              // On a phone the keys' legend is already hidden, and the radio says what the status line would.
              <div key="footer" className="shrink-0 max-md:hidden">
                {footer}
              </div>
            ) : (
              <Fragment key="footer">{footer}</Fragment>
            )
          ) : null}
          {live ? (
            <div key="radio" className="shrink-0 px-6 pt-2 pb-4 max-md:px-4">
              {hud ? (
                <RadioLine line={voiced(hud.radio)} className="mx-auto max-w-3xl" />
              ) : (
                <Skeleton className="mx-auto h-16 max-w-3xl rounded-md max-md:h-20" />
              )}
            </div>
          ) : null}
        </div>
      }
      panel={panel}
      action={action}
    />
  );
}

/**
 * The one control that opens what Live puts away: the side panel, the
 * board's bar with the Layer lens, and the legends. Its pressed state is
 * exposed, and it names its key.
 */
export function DetailsToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      data-testid="details-toggle"
      aria-pressed={open}
      aria-keyshortcuts="D"
      onClick={onToggle}
      className={cn(
        "inline-flex h-10 shrink-0 items-center gap-2 rounded-sm border px-3 text-sm font-medium select-none",
        "transition-colors duration-fast ease-out",
        "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.5]",
        open
          ? "border-border-strong bg-surface-3 text-text-1"
          : "border-border text-text-2 hover:bg-surface-3 hover:text-text-1",
      )}
    >
      <PanelRight aria-hidden />
      Details
      <kbd
        aria-hidden
        className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-surface-2 px-1 font-mono text-xs text-text-2 max-md:hidden"
      >
        D
      </kbd>
    </button>
  );
}
