"use client";

// The Inside view (SPEC §4.5): on a board built from a live scan, a Showcase
// player in the side panel that moves to the player's sweep on every hop. The
// board's node ids are the scan's sweep ids, so the player's node is where
// the view goes. It only moves the camera: nothing is read from it, and
// nothing leaves the page.
//
// The Run screen renders this only on a live scan; on fixtures (the demo path
// and the smoke) there is no panel at all.
import { useEffect, useRef, useState } from "react";
import type { InsideView } from "@/adapters/matterport";
import { LayerDot } from "@/components/shell/layer-dot";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Hands focus back to the board when it sits in the panel (a click in the
 * player focuses its frame, and keys typed there never reach the page), so
 * the number keys keep moving the player.
 */
function returnFocus(panel: HTMLElement | null) {
  const active = document.activeElement;
  if (!panel || !(active instanceof HTMLElement) || !panel.contains(active)) return;
  active.blur();
  const board = document.querySelector('[data-testid="run-board"]')?.parentElement;
  if (board instanceof HTMLElement) board.focus({ preventScroll: true });
}

/** What the panel shows: the player opening, open, or not opened. */
export type InsideStatus = "connecting" | "ready" | "failed";

/** One opening of the Inside view's player, as the panel drives it. */
export interface InsideSession {
  /** Sends the view to `sweepId`; before it is open, it goes there once it is. */
  moveTo(sweepId: string): void;
  /** Lets the player go, now or, if it is still opening, the moment it opens. */
  close(): void;
}

/**
 * Opens the player in `parent` and reports its status. The panel's React
 * effects only create, steer and close this, so its lifecycle is tested
 * without a DOM.
 */
export function openInsideSession(
  open: (parent: HTMLElement) => Promise<InsideView>,
  parent: HTMLElement,
  onStatus: (status: InsideStatus) => void,
): InsideSession {
  let view: InsideView | null = null;
  let closed = false;
  let target: string | null = null;
  open(parent).then(
    (opened) => {
      if (closed) return opened.disconnect();
      view = opened;
      onStatus("ready");
      if (target !== null) void opened.moveTo(target);
    },
    (error: unknown) => {
      if (closed) return;
      console.warn(`Matterport: the Inside view did not open (${error instanceof Error ? error.message : String(error)})`);
      onStatus("failed");
    },
  );
  return {
    moveTo(sweepId) {
      target = sweepId;
      if (view) void view.moveTo(sweepId);
    },
    close() {
      closed = true;
      view?.disconnect();
      view = null;
    },
  };
}

export function InsideViewPanel({
  open,
  sweepId,
}: {
  /** Opens the player in the element given; from `insideViewFor`. */
  open: (parent: HTMLElement) => Promise<InsideView>;
  /** The player's node on the board: a sweep id of the scan. */
  sweepId: string;
}) {
  const panel = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const session = useRef<InsideSession | null>(null);
  const [status, setStatus] = useState<InsideStatus>("connecting");

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const opened = openInsideSession(open, parent, setStatus);
    session.current = opened;
    return () => {
      opened.close();
      if (session.current === opened) session.current = null;
    };
  }, [open]);

  // Declared after the opening effect, so on mount the session exists when this runs.
  useEffect(() => {
    session.current?.moveTo(sweepId);
  }, [sweepId, open]);

  return (
    <section
      ref={panel}
      aria-labelledby="inside-view-label"
      data-testid="inside-view"
      data-status={status}
      className="flex flex-col gap-2"
      onPointerLeave={() => returnFocus(panel.current)}
    >
      <h2 id="inside-view-label" className="flex items-center gap-2 label-caps text-text-3">
        <LayerDot layer="matterport" decorative />
        Inside view
      </h2>
      <div className="relative aspect-video overflow-hidden rounded-md border border-border bg-surface-1">
        <div ref={host} className="absolute inset-0" />
        {status === "connecting" ? <Skeleton className="absolute inset-0 rounded-none bg-surface-1" /> : null}
        {status === "failed" ? (
          <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-text-2">
            The scan&apos;s player didn&apos;t open. The board still plays on the scan.
          </p>
        ) : null}
      </div>
      <p className="text-sm text-text-2">The scan at your spot. It follows each hop.</p>
    </section>
  );
}
