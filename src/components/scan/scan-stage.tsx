"use client";

// The scan as the Run screen's stage (issue 107): the Inside view's player
// fills the board's area under the after-hours filter, and a layer over it
// takes the pointer and the keys (controls.ts). The walk (scan-walk.ts) keeps
// the camera on the player's node and plays a step as the engine's move.
//
// The Run screen mounts this only in Live, on a board built from a live scan
// whose player can open, and unmounts it once the scan has failed: the board
// then takes the stage. Nothing read from the scan leaves the page (SPEC §4.5).
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { InsideView } from "@/adapters/matterport";
import { openInsideSession } from "@/components/run/inside-view";
import { LayerDot } from "@/components/shell/layer-dot";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { attachScanControls } from "./controls";
import { createScanWalk, type ScanFailure, type ScanPhase, type ScanWalk, type ScanWalkState } from "./scan-walk";

/** What a layer drawn over the scan (issue 108) is given. */
export interface ScanOverlayProps {
  /** The open Inside view: its pose, its floor points and `project`. */
  view: InsideView;
  /** The player's node, where the camera stands or is going. */
  sweepId: string;
  /** The legal hops from there: the engine's move choices. */
  hops: readonly string[];
  /** The hop W would step to now, or null. */
  aimed: string | null;
}

export function ScanStage({
  open,
  sweepId,
  hops,
  onState,
  onStep,
  onNoAim,
  overlay,
}: {
  /** Opens the player in the element given; from `insideViewFor`. */
  open: (parent: HTMLElement, signal?: AbortSignal) => Promise<InsideView>;
  /** The player's node on the board: a sweep id of the scan. */
  sweepId: string;
  /** The legal hops from the player's node. */
  hops: readonly string[];
  /** The walk's state, each time it changes: opening, ready (and where the camera stands), or failed. */
  onState: (state: ScanWalkState) => void;
  /** Plays the engine's move to `sweepId` through the Run screen's `play`; true when the engine took it. */
  onStep: (sweepId: string) => boolean;
  /** W was pressed with no hop in view. */
  onNoAim: () => void;
  /** A layer drawn over the scan, under nothing but the Run screen's own controls (issue 108). */
  overlay?: (props: ScanOverlayProps) => ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const walk = useRef<ScanWalk | null>(null);
  const [view, setView] = useState<InsideView | null>(null);
  const [phase, setPhase] = useState<ScanPhase>("opening");
  const [aimed, setAimed] = useState<string | null>(null);

  // The latest props, for the walk and the controls, which are made once per player.
  const latest = useRef({ sweepId, hops, onState, onStep, onNoAim });
  useEffect(() => {
    latest.current = { sweepId, hops, onState, onStep, onNoAim };
  });

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const created = createScanWalk({
      move: (id) => latest.current.onStep(id),
      hops: () => latest.current.hops,
      size: () => ({ w: parent.clientWidth, h: parent.clientHeight }),
      onChange: (state) => {
        setPhase(state.phase);
        latest.current.onState(state);
      },
      onAim: setAimed,
      onNoAim: () => latest.current.onNoAim(),
    });
    walk.current = created;
    // A new player starts over: the Run screen hears that it is opening.
    latest.current.onState(created.state());
    created.follow(latest.current.sweepId);
    const session = openInsideSession(
      open,
      parent,
      (status) => {
        if (status === "failed") created.failed();
      },
      (opened) => {
        setView(opened);
        created.opened(opened);
      },
    );
    return () => {
      created.dispose();
      session.close();
      if (walk.current === created) walk.current = null;
      setView(null);
    };
  }, [open]);

  // Declared after the opening effect, so on mount the walk exists when this runs.
  useEffect(() => {
    walk.current?.follow(sweepId);
  }, [sweepId, open]);

  // A door the Chief's lock opened changes the hops without the camera moving.
  useEffect(() => {
    walk.current?.aim();
  }, [hops]);

  useEffect(() => {
    const el = layer.current;
    if (phase !== "ready" || !view || !el) return;
    const controls = attachScanControls({
      look: (dx, dy) => void view.rotate(dx, dy),
      layer: el,
      target: () => walk.current?.target() ?? null,
      step: (id) => walk.current?.step(id) ?? Promise.resolve(),
    });
    return () => controls.dispose();
  }, [phase, view]);

  return (
    <div data-testid="scan-stage" data-phase={phase} data-aimed={aimed ?? undefined} className="absolute inset-0 bg-surface-0">
      <div ref={host} className="scan-after-hours absolute inset-0" />
      {phase === "opening" ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <Skeleton className="absolute inset-0 rounded-none bg-surface-1" />
          <p className="relative text-sm text-text-2">Opening the scan…</p>
        </div>
      ) : null}
      {/* Takes the pointer: drag to look. The player under it never takes the focus, so the keys stay with the run. */}
      <div
        ref={layer}
        data-testid="scan-look"
        aria-hidden
        className={cn("absolute inset-0 touch-none select-none", phase === "ready" ? "cursor-grab active:cursor-grabbing" : null)}
      />
      {view && phase === "ready" && overlay ? overlay({ view, sweepId, hops, aimed }) : null}
      {phase === "ready" ? (
        <>
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute top-1/2 left-1/2 size-3 -translate-1/2 rounded-full border",
              aimed ? "border-accent" : "border-text-2",
            )}
          />
          <p
            data-testid="scan-aim"
            data-aimed={aimed ? "true" : "false"}
            className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-sm bg-surface-1 px-3 py-1.5 text-sm whitespace-nowrap text-text-1 shadow-e-1 max-md:hidden"
          >
            {aimed ? (
              <>
                <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-surface-2 px-1 font-mono text-xs">
                  W
                </kbd>
                Step ahead
              </>
            ) : (
              "Turn to face a way through"
            )}
          </p>
        </>
      ) : null}
    </div>
  );
}

const FAILED: Readonly<Record<ScanFailure, string>> = {
  timeout: "the scan took too long to open",
  error: "the scan's player didn't open",
  lost: "the scan lost your spot",
};

/**
 * Which view the stage shows in Live on a scan, and why the board took over
 * if it did; with the line that the security shown is game fiction, which
 * stays on screen over the scan. Sits in the board area's top left corner.
 */
export function ScanViewChip({ phase, failure }: { phase: ScanPhase; failure?: ScanFailure }) {
  const label = phase === "ready" ? "Scan view" : phase === "opening" ? "Opening the scan" : "Board view";
  return (
    <div className="pointer-events-none absolute top-3 left-6 flex max-w-[calc(100%-9rem)] flex-col items-start gap-1.5 md:max-w-[min(26rem,calc(100%-22rem))]">
      <p
        data-testid="scan-view-chip"
        data-phase={phase}
        role="status"
        className="flex items-center gap-2 rounded-sm border border-border bg-surface-1 px-2.5 py-1 label-caps text-text-2 shadow-e-1"
      >
        <LayerDot layer="matterport" decorative absent={phase === "failed"} />
        {label}
        {phase === "failed" && failure ? <span className="normal-case tracking-normal">· {FAILED[failure]}</span> : null}
      </p>
      {phase !== "failed" ? (
        <p data-testid="scan-fiction" className="rounded-sm bg-surface-1 px-2.5 py-1 text-xs text-text-2 shadow-e-1">
          Security shown is game fiction derived from building class and era.
        </p>
      ) : null}
    </div>
  );
}
