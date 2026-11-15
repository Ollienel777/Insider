"use client";

// Which view the Run screen shows (issue 115): the board, or first person.
// The choice is one per browser, kept in localStorage like the crew plan:
// storage can be blocked or full, so every read and write may quietly do
// nothing, and the choice then lasts as long as the page.
import { useCallback, useEffect, useState } from "react";

export type RunView = "board" | "first-person";

/** The view a browser that has never chosen sees, and the one every other smoke test walks. */
export const DEFAULT_RUN_VIEW: RunView = "board";

/** One key for the whole browser: the choice is the player's, not the building's. */
export const RUN_VIEW_KEY = "heist:run-view";

/** The browser's storage, read inside the caller's `try`: the getter itself throws when site data is blocked. */
const browserStorage = (): Storage | undefined => globalThis.localStorage;

/** The stored choice. The board when there is none, when it is not a view, or when storage cannot be read. */
export function loadRunView(storage?: Pick<Storage, "getItem">): RunView {
  try {
    return (storage ?? browserStorage())?.getItem(RUN_VIEW_KEY) === "first-person" ? "first-person" : DEFAULT_RUN_VIEW;
  } catch {
    return DEFAULT_RUN_VIEW;
  }
}

export function saveRunView(view: RunView, storage?: Pick<Storage, "setItem">): void {
  try {
    (storage ?? browserStorage())?.setItem(RUN_VIEW_KEY, view);
  } catch {
    // The switch still works for this visit; only the memory of it is lost.
  }
}

export interface RunViewState {
  view: RunView;
  choose: (view: RunView) => void;
  /** First person could not be drawn here (no WebGL, its context was lost, a scan's mesh didn't load): the board shows instead. */
  unavailable: boolean;
  /** Why, when it was said: the switch's tooltip. */
  reason: string | null;
  /** Falls back to the board for this visit. The stored choice is left alone: another browser tab may draw it. */
  fail: (reason?: string) => void;
}

/**
 * The view and its setter. The stored choice is read after mount, as the crew
 * plan is, so the server's render and the browser's first one agree on the
 * board; a browser that chose first person switches a moment later.
 */
export function useRunView(): RunViewState {
  const [view, setView] = useState<RunView>(DEFAULT_RUN_VIEW);
  const [unavailable, setUnavailable] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setView(loadRunView()), 0);
    return () => clearTimeout(timer);
  }, []);
  const choose = useCallback((next: RunView) => {
    setView(next);
    saveRunView(next);
  }, []);
  const fail = useCallback((why?: string) => {
    setUnavailable(true);
    setReason(why ?? null);
  }, []);
  return { view: unavailable ? "board" : view, choose, unavailable, reason, fail };
}
