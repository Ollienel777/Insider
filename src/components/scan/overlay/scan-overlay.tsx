"use client";

// The layer over the scan (issue 108): in first person, what the run board
// shows from above. It sits over the Inside view's player, in the player's
// own frame, and redraws from the camera pose: guards and cleaners on their
// nodes, cameras at their mounts, a ring at every watched node, a ring on each
// legal hop (the aimed one highlighted), and a beacon on the objective, or the
// exits once carrying. Only what the player could see (`seenFrom`). A click on
// a guard, a cleaner or a camera opens its Why card.
//
// Two mounts: the Inside view panel once its player is open (today's side
// panel), and issue 107's full-stage `ScanStage` through its `overlay` render
// prop. Nothing it reads leaves the page (SPEC §4.5).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { InsidePose, InsideView, ScanPoint } from "@/adapters/matterport";
import type { RunState } from "@/engine";
import type { PlacedLevel } from "@/level/placer";
import { markerLabel } from "@/components/run/board-view";
import { ProvenanceThread } from "@/components/run/provenance-thread";
import { CARD_WIDTH, liveSubtitle, placeCard, threadColour, whyTargets } from "@/components/run/why";
import { WhyCard } from "@/components/run/why-card";
import { useReducedMotion } from "@/components/drill/use-reduced-motion";
import { openOverlaySession } from "./overlay-session";
import { OverlayDrawing } from "./overlay-drawing";
import { layout, type Drawn, type FrameSize } from "./projection";
import { sceneOf } from "./scene";

/** How long a guard or cleaner takes to glide to its new node: the Inside view's own default flight. */
export const GLIDE_MS = 600;

/**
 * What the layer takes: exactly what issue 107's `ScanStage` passes its `overlay` render prop
 * (`view`, `sweepId`, `hops`, `aimed`), plus the run and the placed level.
 */
export interface ScanOverlayProps {
  /** The open Inside view: its pose, its floor points and `project`. */
  view: InsideView;
  /**
   * The node the camera stands on, and the legal hops from it. `ScanStage` mounts the layer only once
   * the camera stands on the player's node, so these agree with `run`; the layer draws from `run`.
   */
  sweepId?: string;
  hops?: readonly string[];
  /** The legal hop the player is aiming at (issue 107 works it out); with none, every hop ring is drawn plain. */
  aimed?: string | null;
  run: RunState;
  /** The level as placed, for the Why cards. */
  placed: PlacedLevel;
}

/** Where each guard and cleaner stands, by id. */
function standing(run: RunState): Map<string, string> {
  return new Map([...run.guards, ...run.cleaners].map((w) => [w.id, w.nodeId]));
}

/**
 * Everything the layer draws for one frame: the scene on these floor points,
 * laid out by the view's own `project` on its latest pose. Pure but for
 * `view.project`, which reads the frame's size.
 */
export function overlayFrame(
  view: Pick<InsideView, "project">,
  input: {
    run: RunState;
    points: ReadonlyMap<string, ScanPoint>;
    pose: InsidePose;
    frame: FrameSize;
    aimed?: string | null;
    glide?: { from: ReadonlyMap<string, string>; t: number };
  },
): Drawn[] {
  const marks = sceneOf({ run: input.run, points: input.points, aimed: input.aimed, glide: input.glide });
  return layout(marks, (p) => view.project(p), input.pose, input.frame);
}

interface Glide {
  from: ReadonlyMap<string, string>;
  /** Bumped per glide, so each one runs its own clock. */
  id: number;
}

export function ScanOverlay({ view, placed, run, aimed = null }: ScanOverlayProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const [points, setPoints] = useState<ReadonlyMap<string, ScanPoint> | null>(null);
  const [pose, setPose] = useState<InsidePose | null>(null);
  const [frame, setFrame] = useState<FrameSize | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const session = openOverlaySession(view, { onPoints: setPoints, onPose: setPose });
    return () => session.close();
  }, [view]);

  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setFrame({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // A turn moved the guards: each glides from where it stood. Worked out while rendering, as React
  // recommends for state that follows a prop, so the first frame of the turn already starts the glide.
  const [seen, setSeen] = useState(run);
  const [glide, setGlide] = useState<Glide | null>(null);
  const [t, setT] = useState(1);
  if (seen !== run) {
    setSeen(run);
    if (run.turn === seen.turn + 1 && run.board === seen.board) {
      setGlide((g) => ({ from: standing(seen), id: (g?.id ?? 0) + 1 }));
      setT(reduced ? 1 : 0);
    } else {
      setGlide(null);
      setT(1);
    }
  }
  useEffect(() => {
    if (!glide || reduced) return;
    let frameId = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const next = Math.min(1, (now - start) / GLIDE_MS);
      setT(next);
      if (next < 1) frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [glide, reduced]);

  const drawn =
    points && pose && frame && frame.width > 0 && frame.height > 0
      ? overlayFrame(view, { run, points, pose, frame, aimed, glide: glide && t < 1 ? { from: glide.from, t } : undefined })
      : [];

  // ---- the Why card -------------------------------------------------------------
  const targets = useMemo(() => whyTargets(placed), [placed]);
  const [why, setWhy] = useState<{
    key: string;
    origin: { x: number; y: number };
    anchor: { x: number; y: number };
    avoid: { x: number; y: number }[];
  } | null>(null);
  const target = why ? (targets.find((x) => x.key === why.key) ?? null) : null;
  const card = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(240);

  const inspect = useCallback((key: string, from: Element) => {
    const box = wrap.current?.getBoundingClientRect();
    const piece = from.getBoundingClientRect();
    if (!box) return;
    // The card leaves the board's player and numbered choices in view, as the board's own card does (R3-M3).
    const avoid = [...document.querySelectorAll('[data-testid="player-piece"], [data-testid="choice"]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    setWhy((open) =>
      open?.key === key
        ? null
        : {
            key,
            origin: { x: box.left, y: box.top },
            anchor: { x: piece.left + piece.width / 2, y: piece.top + piece.height * 0.3 },
            avoid,
          },
    );
  }, []);
  const close = useCallback(() => setWhy(null), []);

  useEffect(() => {
    const el = card.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setCardHeight(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height));
    observer.observe(el);
    return () => observer.disconnect();
  }, [why?.key]);

  // Esc and a click outside the card close it; a click on another piece switches to it.
  useEffect(() => {
    if (!why) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    const onDown = (event: PointerEvent) => {
      const el = event.target as Element | null;
      if (el?.closest?.("[data-scan-why-card], [data-overlay-why]")) return;
      close();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [why, close]);

  // The thread follows the piece while the camera turns; the card stays where it opened.
  const piece = why ? drawn.find((d) => d.key === why.key) : undefined;
  const threadFrom =
    why && piece && (piece.kind === "figure" || piece.kind === "camera")
      ? piece.kind === "figure"
        ? { x: why.origin.x + piece.x, y: why.origin.y + piece.top + (piece.bottom - piece.top) * 0.3 }
        : { x: why.origin.x + piece.x, y: why.origin.y + piece.y }
      : null;
  const viewport = typeof window === "undefined" ? null : { width: window.innerWidth, height: window.innerHeight };
  const placement = why && viewport ? placeCard(why.anchor, viewport, cardHeight, why.avoid) : null;

  // The board's own label for the node: the objective's noun, or the way out's name.
  const beaconLabel = useCallback((_role: "objective" | "exit", nodeId: string) => markerLabel(placed, nodeId), [placed]);

  return (
    <div
      ref={wrap}
      data-testid="scan-overlay"
      data-status={points === null ? "loading" : points.size === 0 ? "no-points" : "ready"}
      className="pointer-events-none absolute inset-0"
    >
      <OverlayDrawing drawn={drawn} selected={why?.key ?? null} beaconLabel={beaconLabel} onInspect={inspect} />
      {target && placement && viewport
        ? createPortal(
            <div data-scan-why-card className="pointer-events-none fixed inset-0 z-50">
              {threadFrom ? <ProvenanceThread from={threadFrom} to={placement.to} colour={threadColour(target)} drawKey={target.key} /> : null}
              <WhyCard
                ref={card}
                key={target.key}
                target={target}
                subtitle={liveSubtitle(placed, run, target)}
                onClose={close}
                className="pointer-events-auto"
                style={{
                  left: placement.left,
                  top: placement.top,
                  width: Math.min(CARD_WIDTH, viewport.width - 32),
                  maxHeight: Math.max(160, viewport.height - 32),
                }}
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
