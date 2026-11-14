"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";

/** How long a guard waits for the player to land before it hops (DESIGN.md, the hero screen). */
export const HOP_DELAY_MS = 200;

/**
 * A motion token's value in milliseconds, read from the page's CSS (`--t-base`, `--t-slow`). The
 * build may rewrite `300ms` as `.3s`, so both units are read.
 */
function token(name: "--t-base" | "--t-slow", fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const value = parseFloat(raw);
  if (!Number.isFinite(value)) return fallback;
  return raw.endsWith("ms") ? value : raw.endsWith("s") ? value * 1000 : value;
}

/**
 * Animates a board piece's hop from where it stood to `at`, each time `at`
 * changes. The piece's `style.transform` holds where it stands; this adds a
 * Web Animation from the old place to the new one.
 *
 * Not a CSS transition: the board draws its pieces back to front, so a hop
 * that changes which piece is nearer moves that piece's element in the DOM,
 * and a browser drops the transition of an element it re-inserts: the piece
 * jumped (#68). An animation started after React has placed the element runs
 * wherever it now stands. A hop that lands mid-hop starts from where the
 * piece is on screen. Under `prefers-reduced-motion` the piece just moves.
 */
export function useHop(
  ref: RefObject<Element | null>,
  at: { x: number; y: number },
  { speed, delayed }: { speed: "base" | "slow"; delayed: boolean },
): void {
  const last = useRef<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const from = last.current;
    last.current = { x: at.x, y: at.y };
    if (!el || !from || (from.x === at.x && from.y === at.y) || typeof el.animate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const running = el.getAnimations();
    const start = running.length > 0 ? getComputedStyle(el).transform : `translate(${from.x}px, ${from.y}px)`;
    for (const animation of running) animation.cancel();
    const ease = getComputedStyle(document.documentElement).getPropertyValue("--ease").trim();
    el.animate([{ transform: start }, { transform: `translate(${at.x}px, ${at.y}px)` }], {
      duration: speed === "slow" ? token("--t-slow", 300) : token("--t-base", 200),
      delay: delayed ? HOP_DELAY_MS : 0,
      easing: ease || "ease-out",
      fill: "backwards",
    });
  }, [ref, at.x, at.y, speed, delayed]);
}
