"use client";

// The scan's half of the Run stage (issue 117): the Inside view's player at
// the size of the board, under a head that says what it is and where the
// player stands. inside-view.tsx opens and steers the player; this file only
// draws around it. Nothing is drawn over the player, and nothing is read
// from it (SPEC §4.5).
import { Moon } from "lucide-react";
import { useEffect, useRef, type RefObject } from "react";
import type { InsideView } from "@/adapters/matterport";
import { LayerDot } from "@/components/shell/layer-dot";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { returnFocus, useInsideView, type InsideStatus } from "./inside-view";

/** How the scan is shown: dimmed and cooled to the board's night, or as it was scanned. */
export type ScanLook = "after-hours" | "as-scanned";

/** The pane's caption: the line the side panel's Inside view carried. */
export const FOLLOWS_LINE = "The scan at your spot. It follows each hop.";
/** What the stage says when the player does not open. */
export const FAILED_LINE = "The scan's player didn't open. The board still plays on the scan.";

/** The Matterport source chip, as the board's own header writes it. */
function SourceChip() {
  return (
    <span className="flex shrink-0 items-center gap-2 label-caps text-text-2">
      <LayerDot layer="matterport" decorative />
      Matterport
      <span className="max-xl:hidden"> · Inside view</span>
    </span>
  );
}

/**
 * The pane's head: the source chip, the room the player is in, and the
 * after-hours toggle. It sits in the stage's head row, level with the stage
 * switch, so the board and the scan start on one line.
 */
export function ScanHead({
  room,
  look,
  onLook,
  className,
}: {
  /** The room the player stands in, as the board names it. */
  room: string;
  look: ScanLook;
  onLook: (look: ScanLook) => void;
  className?: string;
}) {
  const afterHours = look === "after-hours";
  return (
    <div
      data-testid="inside-head"
      className={cn("flex h-12 min-w-0 items-center gap-3 border-b border-border bg-surface-1 pr-1 pl-4", className)}
    >
      <SourceChip />
      <span aria-hidden className="h-4 w-px shrink-0 bg-border" />
      <span data-testid="inside-room" className="min-w-0 truncate text-sm text-text-1">
        {room}
      </span>
      <button
        type="button"
        data-testid="scan-look"
        aria-pressed={afterHours}
        title={afterHours ? "Show the scan as scanned" : "Show the scan after hours"}
        onClick={() => onLook(afterHours ? "as-scanned" : "after-hours")}
        className={cn(
          "ml-auto inline-flex h-10 shrink-0 items-center gap-2 rounded-sm border px-3 text-sm font-medium select-none",
          "transition-colors duration-fast ease-out",
          "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.5]",
          afterHours
            ? "border-border-strong bg-surface-3 text-text-1"
            : "border-transparent text-text-2 hover:bg-surface-3 hover:text-text-1",
        )}
      >
        <Moon aria-hidden />
        {/* Where the pane is narrow the icon stays, and the name stays for screen readers. */}
        <span className="max-xl:sr-only">After hours</span>
      </button>
    </div>
  );
}

/**
 * The pane itself, drawn for a status: the player's frame and the caption
 * under it. The frame is a plain element the player is opened in; the
 * after-hours look is a filter on that element, never anything over it.
 */
export function ScanFrame({
  status,
  look,
  host,
  pane,
  className,
  frameClassName,
}: {
  status: InsideStatus;
  look: ScanLook;
  /** The element the player opens in. */
  host?: RefObject<HTMLDivElement | null>;
  pane?: RefObject<HTMLElement | null>;
  className?: string;
  /** The frame's shape where the stage stacks; beside the board it takes the board's height. */
  frameClassName?: string;
}) {
  return (
    <section
      ref={pane}
      aria-label="Inside view"
      data-testid="inside-view"
      data-status={status}
      className={cn("flex min-h-0 min-w-0 flex-col", className)}
      onPointerLeave={() => returnFocus(pane?.current ?? null)}
    >
      <div className={cn("relative min-h-0 flex-1 bg-surface-1", frameClassName)}>
        <div
          ref={host}
          data-testid="inside-frame"
          data-look={look}
          className={cn(
            "absolute inset-0 transition-[filter] duration-slow ease-out",
            look === "after-hours" ? "scan-after-hours" : null,
          )}
        />
        {status === "connecting" ? <Skeleton className="absolute inset-0 rounded-none bg-surface-2" /> : null}
        {status === "failed" ? (
          <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-text-2">{FAILED_LINE}</p>
        ) : null}
      </div>
      <p className="flex min-h-10 shrink-0 items-center border-t border-border bg-surface-1 px-4 py-2 text-sm text-text-2">
        {FOLLOWS_LINE}
      </p>
    </section>
  );
}

/**
 * The pane with its player: opened on mount, sent to `sweepId` on every hop,
 * let go on unmount. `onStatus` tells the stage how the opening went, so a
 * player that did not open gives its room back to the board.
 */
export function ScanPane({
  open,
  sweepId,
  look,
  onStatus,
  className,
  frameClassName,
}: {
  /** Opens the player in the element given; from `insideViewFor`. */
  open: (parent: HTMLElement, signal?: AbortSignal) => Promise<InsideView>;
  /** The player's node on the board: a sweep id of the scan. */
  sweepId: string;
  look: ScanLook;
  onStatus: (status: InsideStatus) => void;
  className?: string;
  frameClassName?: string;
}) {
  const pane = useRef<HTMLElement>(null);
  const { host, status } = useInsideView(open, sweepId);
  useEffect(() => {
    onStatus(status);
  }, [status, onStatus]);
  return (
    <ScanFrame status={status} look={look} host={host} pane={pane} className={className} frameClassName={frameClassName} />
  );
}

/**
 * The pane when the player did not open: one line in the stage's head saying
 * so, with the way to try again. The board has the whole stage under it.
 */
export function ScanFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="status"
      data-testid="inside-view"
      data-status="failed"
      className="flex min-h-12 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface-1 py-1 pr-1 pl-4"
    >
      <SourceChip />
      <p className="min-w-0 flex-1 basis-64 text-sm text-text-1">{FAILED_LINE}</p>
      <Button variant="ghost" data-testid="inside-retry" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
