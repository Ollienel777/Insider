"use client";

// The Run stage on a live scan (issue 117): the board and the building's scan
// side by side, so every hop on the board moves a camera through the real
// floor. One switch shows both, the board alone or the scan alone, and the
// choice is kept per browser (stage-store.ts).
//
// On fixtures there is no stage: `RunStage` hands the board back as it was
// given, and the Run screen is the one the demo path and the smoke know.
import { useCallback, useState, type ReactNode } from "react";
import type { InsideView } from "@/adapters/matterport";
import { cn } from "@/lib/utils";
import type { InsideStatus } from "./inside-view";
import { FOLLOWS_LINE, ScanFailed, ScanHead, ScanPane, type ScanLook } from "./scan-pane";
import { loadStageMode, saveStageMode, STAGE_MODES, type StageMode } from "./stage-store";

export const STAGE_LABEL: Readonly<Record<StageMode, string>> = { split: "Split", board: "Board", scan: "Scan" };

/**
 * The stage's columns when both halves show, at `lg` and wider: the board,
 * then the scan. The scan takes the larger share; the board keeps enough
 * width at 1440 for a Why card.
 */
export const SPLIT_COLUMNS = "lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]";

/**
 * The class of the Run screen's visual. On fixtures it is the screen's own,
 * filling the area it is given. With a stage, below `lg` the two halves stack
 * and the visual grows to hold them, so the page scrolls down, never sideways.
 */
export function stageVisualClass(staged: boolean): string {
  return staged ? "flex min-h-full flex-col lg:absolute lg:inset-0" : "absolute inset-0 flex flex-col";
}

/** The stage switch: Split, Board or Scan, the one in use pressed. */
export function StageSwitch({ mode, onChoose }: { mode: StageMode; onChoose: (mode: StageMode) => void }) {
  return (
    <div role="group" aria-label="Stage" data-testid="stage-switch" className="flex items-center gap-1">
      {STAGE_MODES.map((option) => (
        <button
          key={option}
          type="button"
          data-mode={option}
          aria-pressed={mode === option}
          onClick={() => onChoose(option)}
          className={cn(
            "inline-flex h-10 items-center rounded-sm border px-3 text-sm font-medium select-none",
            "transition-colors duration-fast ease-out",
            mode === option
              ? "border-border-strong bg-surface-3 text-text-1"
              : "border-transparent text-text-2 hover:bg-surface-3 hover:text-text-1",
          )}
        >
          {STAGE_LABEL[option]}
        </button>
      ))}
    </div>
  );
}

/** What the stage shows: the mode chosen, or the board alone when the scan's player did not open. */
export function stageShown(mode: StageMode, status: InsideStatus): StageMode {
  return status === "failed" ? "board" : mode;
}

/**
 * Choosing `next` on the switch while `mode` shows: the choice is stored for
 * the next visit, and the answer is what the stage does now. With the board
 * alone there is no pane and no player, so the way back to the scan opens a
 * new one (`reopen`). Null when `next` is already showing.
 */
export function chooseStage(
  mode: StageMode,
  next: StageMode,
  storage?: Pick<Storage, "setItem">,
): { mode: StageMode; reopen: boolean } | null {
  if (next === mode) return null;
  saveStageMode(next, storage);
  return { mode: next, reopen: mode === "board" };
}

/**
 * The stage drawn for a mode and a player status. One frame holds a head row
 * (the switch, and the scan's head) over the halves, with a seam between
 * them, and under the scan a foot row with its caption. Below `lg`
 * everything stacks in reading order: switch, board, scan.
 *
 * The Run screen lays other controls over the corners of the board's area:
 * the Live timer and the Tactical / Live switch (live-controls.tsx), 24 px in
 * from its sides and 12 px from its bottom, or from its top for the switch on
 * a phone; and the mute button (run-sound.tsx) in its top right corner, or on
 * a phone under the switch. The frame stands 20 px in from the sides and a
 * few px short of the top and bottom, so each of them lands inside it, level
 * with the stage's own buttons: the timer and the play switch in the foot
 * row's ends, clear of the caption, and the mute button in the head row's
 * right end, which the scan's head leaves free. With the board alone they
 * sit over the board's corners, as they do on fixtures.
 */
export function StageView({
  mode,
  status,
  look,
  room,
  board,
  pane,
  onMode,
  onLook,
  onRetry,
}: {
  mode: StageMode;
  /** How the scan's player stands; `failed` gives the whole stage to the board. */
  status: InsideStatus;
  look: ScanLook;
  /** The room the player stands in. */
  room: string;
  board: ReactNode;
  /** The scan's pane, for the modes that show it. */
  pane: ReactNode;
  onMode: (mode: StageMode) => void;
  onLook: (look: ScanLook) => void;
  onRetry: () => void;
}) {
  const failed = status === "failed";
  const shown = stageShown(mode, status);
  return (
    <div
      data-testid="run-stage"
      data-stage={shown}
      className={cn(
        "mx-5 mt-1 mb-2 grid overflow-hidden rounded-md border border-border bg-surface-0 max-md:mt-2",
        "lg:absolute lg:inset-x-5 lg:top-1 lg:bottom-2 lg:m-0 lg:grid-rows-[auto_minmax(0,1fr)_auto]",
        shown === "split" ? SPLIT_COLUMNS : null,
        shown === "scan" ? "lg:grid-cols-[auto_minmax(0,1fr)]" : null,
      )}
    >
      {failed ? (
        <ScanFailed onRetry={onRetry} />
      ) : (
        <div className="flex h-12 items-center border-b border-border bg-surface-1 px-1">
          <StageSwitch mode={mode} onChoose={onMode} />
        </div>
      )}
      {shown !== "scan" ? (
        <div
          data-testid="stage-board"
          className={cn(
            "relative min-h-0 min-w-0 lg:h-auto",
            // Beside the scan the board sits under the switch, in the first column.
            shown === "split" ? "max-lg:h-56 max-lg:border-b max-lg:border-border lg:col-start-1 lg:row-start-2" : "max-lg:h-72",
          )}
        >
          {board}
        </div>
      ) : null}
      {shown !== "board" ? (
        <ScanHead
          room={room}
          look={look}
          onLook={onLook}
          // Its right end is the mute button's: from `lg` the head is the stage's top right, and alone on a phone it is under the play switch.
          className={shown === "split" ? "lg:col-start-2 lg:row-start-1 lg:border-l lg:pr-24" : "max-md:pr-12 lg:pr-24"}
        />
      ) : null}
      {shown !== "board" ? pane : null}
      {shown !== "board" ? (
        <p
          data-testid="inside-caption"
          className={cn(
            "flex min-h-12 items-center border-t border-border bg-surface-1 py-1 text-sm text-text-2 lg:col-span-2 lg:row-start-3",
            // Room at the row's ends for the Live controls: the timer on the left, the play switch on the right from `md`.
            "text-balance max-md:pr-4 max-md:pl-14 md:justify-end md:pr-40 md:pl-60 md:text-right",
          )}
        >
          <span>{FOLLOWS_LINE}</span>
        </p>
      ) : null}
    </div>
  );
}

/** The classes the scan's pane takes in each mode: beside the board, or the whole stage. */
export function paneClasses(shown: StageMode): { className: string; frameClassName: string } {
  return shown === "scan"
    ? { className: "lg:col-span-2", frameClassName: "max-lg:aspect-[3/4]" }
    : { className: "lg:col-start-2 lg:row-start-2 lg:border-l lg:border-border", frameClassName: "max-lg:aspect-[3/2]" };
}

/** The stage with its state: the mode from storage, the look, and how the scan's player stands. */
function LiveStage({
  open,
  sweepId,
  room,
  board,
}: {
  open: (parent: HTMLElement, signal?: AbortSignal) => Promise<InsideView>;
  sweepId: string;
  room: string;
  board: ReactNode;
}) {
  // Read as the stage first draws. That is never on the server: a stage needs a run, and a run starts in the browser.
  const [mode, setMode] = useState<StageMode>(() => loadStageMode());
  const [look, setLook] = useState<ScanLook>("after-hours");
  // Each opening of the player is its own pane (`opening` is its key): Try again, and coming back from Board, open a new one.
  const [player, setPlayer] = useState<{ opening: number; status: InsideStatus }>({ opening: 0, status: "connecting" });
  const reopen = useCallback(() => setPlayer((was) => ({ opening: was.opening + 1, status: "connecting" })), []);
  const onStatus = useCallback(
    (status: InsideStatus) => setPlayer((was) => (was.status === status ? was : { ...was, status })),
    [],
  );
  const choose = (next: StageMode) => {
    const chosen = chooseStage(mode, next);
    if (!chosen) return;
    setMode(chosen.mode);
    if (chosen.reopen) reopen();
  };
  const shown = stageShown(mode, player.status);
  return (
    <StageView
      mode={mode}
      status={player.status}
      look={look}
      room={room}
      board={board}
      pane={
        <ScanPane key={player.opening} open={open} sweepId={sweepId} look={look} onStatus={onStatus} {...paneClasses(shown)} />
      }
      onMode={choose}
      onLook={setLook}
      onRetry={reopen}
    />
  );
}

/**
 * The Run screen's stage. With no Inside view to open (fixtures, fake mode, a
 * live board with no key) it is the board alone, exactly as given. On a live
 * scan it is the board and the scan under the stage switch.
 */
export function RunStage({
  open,
  sweepId,
  room,
  children,
}: {
  /** Opens the Inside view's player; null wherever there is none. From `insideViewFor`. */
  open: ((parent: HTMLElement, signal?: AbortSignal) => Promise<InsideView>) | null;
  /** The player's node on the board: on a scan, a sweep id. */
  sweepId: string;
  /** The room the player stands in. */
  room: string;
  /** The board. */
  children: ReactNode;
}) {
  if (!open) return children;
  return <LiveStage open={open} sweepId={sweepId} room={room} board={children} />;
}
