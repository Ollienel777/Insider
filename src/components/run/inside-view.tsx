"use client";

// The Inside view (SPEC §4.5): on a board built from a live scan, a Showcase
// player that moves to the player's sweep on every hop. The board's node ids
// are the scan's sweep ids, so the player's node is where the view goes. It
// only moves the camera: nothing is read from it, and nothing leaves the page.
//
// This file opens, steers and closes the player. The Run stage draws it
// (scan-pane.tsx, issue 117), only on a live scan; on fixtures (the demo path
// and the smoke) there is no Inside view at all.
import { useEffect, useRef, useState, type RefObject } from "react";
import type { InsideView } from "@/adapters/matterport";

/**
 * Hands focus back to the board when it sits in the panel (a click in the
 * player focuses its frame, and keys typed there never reach the page), so
 * the number keys keep moving the player.
 */
export function returnFocus(panel: HTMLElement | null) {
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
  open: (parent: HTMLElement, signal?: AbortSignal) => Promise<InsideView>,
  parent: HTMLElement,
  onStatus: (status: InsideStatus) => void,
): InsideSession {
  let view: InsideView | null = null;
  let closed = false;
  let target: string | null = null;
  // Closing while the player still opens takes it out of the page at once, so a
  // remount never leaves a stale player stacked over the live one.
  const stop = new AbortController();
  open(parent, stop.signal).then(
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
      stop.abort();
      view?.disconnect();
      view = null;
    },
  };
}

/**
 * The Inside view's player for the component that draws it: opened in the
 * element `host` is put on, sent to `sweepId` on every hop, and let go when
 * the component goes.
 */
export function useInsideView(
  /** Opens the player in the element given; from `insideViewFor`. */
  open: (parent: HTMLElement, signal?: AbortSignal) => Promise<InsideView>,
  /** The player's node on the board: a sweep id of the scan. */
  sweepId: string,
): { host: RefObject<HTMLDivElement | null>; status: InsideStatus } {
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

  return { host, status };
}
