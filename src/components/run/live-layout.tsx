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
// the one Details control opens them.
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

/** Who says each kind of line, and how it reads: the crew warns in the alarm's colours, the Chief is overheard. */
const VOICE: Readonly<Record<RadioKind, { speaker: string; tone: RadioTone }>> = {
  step: { speaker: "Crew", tone: "plain" },
  noise: { speaker: "Crew", tone: "warning" },
  sighting: { speaker: "Crew", tone: "danger" },
  chief: { speaker: "Chief", tone: "plain" },
};

/** A radio message as the radio line shows it: with its speaker and its tone. */
export function voiced(message: RadioMessage | null): RadioLineProps["line"] {
  return message ? { ...VOICE[message.kind], text: message.text } : null;
}

/** The rule under the HUD's top row: nothing at Calm, the alarm's colour above it. */
const HUD_RULE: Readonly<Record<AlarmState, string>> = {
  calm: "border-transparent",
  suspicious: "border-warning",
  alert: "border-danger",
  lockdown: "border-danger",
};

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
  /** The run's end, for Live with the panel closed: how it ended, and Restart. Null while the run is on. */
  end?: { outcome: ReactNode; onRestart: () => void } | null;
}

/**
 * The Run screen's layout. In Tactical: the bar, the board, the legend and
 * the status line, with the panel beside them, as before Live existed. In
 * Live: the HUD's two rows around the board, and the rest only while Details
 * is open.
 */
export function RunLayout({
  mode,
  details,
  onDetails,
  hud,
  loading,
  onTake,
  bar,
  board,
  legend,
  footer,
  panel,
  action,
  end = null,
}: RunLayoutProps) {
  const live = mode === "live";
  const open = panelsOpen(mode, details);
  return (
    <BuildingScreen
      visualLabel="Run board"
      panelClosed={!open}
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
              {hud ? (
                <ObjectiveLine
                  label={hud.objective.label}
                  goal={hud.objective.goal}
                  hops={hud.objective.hops}
                  locks={hud.objective.locks}
                  taken={hud.objective.taken}
                  action={hud.objective.take ? { label: hud.objective.take, onAct: onTake, keyHint: "Space" } : null}
                  className="flex-1 basis-72"
                />
              ) : loading ? (
                <div className="flex-1 basis-72">
                  <Skeleton data-testid="hud-skeleton" className="h-11 w-72 max-w-full" />
                </div>
              ) : (
                <div className="flex-1" />
              )}
              <div className="flex items-center gap-6 max-md:w-full max-md:justify-between">
                {hud ? (
                  <DangerMeter alarm={hud.danger.alarm} watchers={hud.danger.watchers} />
                ) : loading ? (
                  <Skeleton className="h-11 w-48" />
                ) : null}
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
          {live && end && !open ? (
            <div
              key="end"
              data-testid="live-end"
              className="mx-auto flex w-full max-w-3xl shrink-0 items-stretch gap-3 px-6 pt-2 pb-4 animate-in fade-in-0 duration-base max-md:flex-col max-md:px-4"
            >
              <div className="min-w-0 flex-1">{end.outcome}</div>
              <div className="flex shrink-0 flex-col justify-center gap-2 max-md:flex-row max-md:[&>*]:flex-1">
                {action}
                <Button variant="secondary" data-testid="live-restart" onClick={end.onRestart}>
                  <RotateCcw aria-hidden />
                  Restart
                </Button>
              </div>
            </div>
          ) : live && (hud || loading) ? (
            <div key="radio" className="shrink-0 px-6 pt-2 pb-4 max-md:px-4">
              {hud ? (
                <RadioLine line={voiced(hud.radio)} className="mx-auto max-w-3xl" />
              ) : (
                <Skeleton className="mx-auto h-14 max-w-3xl rounded-md" />
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
