"use client";

// How the Run screen is played (issue 99). Tactical is the board as it has
// always been: nothing moves until the player acts. Live puts a clock on the
// turn (turn-clock.ts). The choice is one per browser, kept in localStorage
// like the crew plan: storage can be blocked or full, so every read and write
// may quietly do nothing, and the choice then lasts as long as the page.
import { useCallback, useEffect, useState } from "react";

export type PlayMode = "tactical" | "live";

/** The mode a browser that has never chosen plays in, and the one the smoke walks. */
export const DEFAULT_PLAY_MODE: PlayMode = "tactical";

/** One key for the whole browser, not one per building: the choice is the player's, not the level's. */
export const PLAY_MODE_KEY = "heist:play-mode";

/** The browser's storage, read inside the caller's `try`: the getter itself throws when site data is blocked. */
const browserStorage = (): Storage | undefined => globalThis.localStorage;

/** The stored choice. Tactical when there is none, when it is not a mode, or when storage cannot be read. */
export function loadPlayMode(storage?: Pick<Storage, "getItem">): PlayMode {
  try {
    return (storage ?? browserStorage())?.getItem(PLAY_MODE_KEY) === "live" ? "live" : DEFAULT_PLAY_MODE;
  } catch {
    return DEFAULT_PLAY_MODE;
  }
}

export function savePlayMode(mode: PlayMode, storage?: Pick<Storage, "setItem">): void {
  try {
    (storage ?? browserStorage())?.setItem(PLAY_MODE_KEY, mode);
  } catch {
    // The switch still works for this visit; only the memory of it is lost.
  }
}

/**
 * The play mode and its setter. The stored choice is read after mount, as the
 * crew plan is, so the server's render and the browser's first one agree on
 * Tactical; a browser that chose Live switches a moment later.
 */
export function usePlayMode(): [PlayMode, (mode: PlayMode) => void] {
  const [mode, setMode] = useState<PlayMode>(DEFAULT_PLAY_MODE);
  useEffect(() => {
    const timer = setTimeout(() => setMode(loadPlayMode()), 0);
    return () => clearTimeout(timer);
  }, []);
  const choose = useCallback((next: PlayMode) => {
    setMode(next);
    savePlayMode(next);
  }, []);
  return [mode, choose];
}
