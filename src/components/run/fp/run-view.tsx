"use client";

// What the first-person view puts on the Run screen (issue 115): the Board /
// First person switch, and the view itself, loaded only when it is chosen so
// the board's page does not carry the renderer. The Run screen imports from
// here and nowhere else under fp/.
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Footprints, Grid3x3, type LucideIcon } from "lucide-react";
import type { FloorGraph } from "@/domain";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Pace } from "../play-hud";
import type { ScanHandle } from "./scan-preload";
import { FP } from "./tuning";
import { buildWorld, edgePath, type World } from "./world";
import type { RunView, RunViewState } from "./view-store";

export type { ScanHandle } from "./scan-preload";

export { useRunView } from "./view-store";

export { FullscreenToggle } from "./fullscreen-toggle";

/** The view, in its own bundle and never rendered on the server: it needs a canvas and WebGL. */
export const FirstPersonView = dynamic(() => import("./first-person-view"), {
  ssr: false,
  loading: () => <Skeleton data-testid="fp-loading" className="absolute inset-x-6 inset-y-0 rounded-md bg-surface-1" />,
});

/** The status line when first person cannot be drawn and the board comes back. */
/** First person's turn: short enough that the guards never seem to wait on the player (issue 115). */
export { FP_TURN_MS as FIRST_PERSON_TURN_MS } from "./tuning";

/** Each floor's walls, built once for the HUD's pace however often it asks. */
const worlds = new WeakMap<FloorGraph, World>();

/**
 * First person's pace on `floor`, for the HUD to speak in seconds rather than
 * hops and turns (`usePlayHud`): the controller's one speed, and each edge
 * walked through its doorway as the body walks it.
 */
export function firstPersonPace(floor: FloorGraph): Pace {
  const pace = { unitM: FP.unitM, mps: FP.runMps, turnMs: FP.turnMs };
  // A live scan's floor has no walls of ours to walk through: node to node in a straight line, and in
  // metres already, as its ground is (scan-ground.ts, `unitM` 1).
  if (floor.source !== "fixture") return { ...pace, unitM: 1 };
  let world = worlds.get(floor);
  if (!world) worlds.set(floor, (world = buildWorld(floor)));
  const built = world;
  return { ...pace, edge: (a, b) => edgePath(built, a, b) };
}

/** The turn the clock plays for first person, which the view supplies: the next pick while E is held, or a wait. */
export type HeldAction = (run: import("@/engine").RunState) => import("@/engine").Action;

/** A guard's bark on the radio line, in first person (issue 146). */
export { useBark, type Bark } from "./barks";

export const FP_UNAVAILABLE = "First person needs WebGL, which this browser isn't giving it. You're on the board.";

/**
 * Whether first person can stand on `floor`: a fixture floor (our own walls,
 * world.ts), or a floor from a live scan whose mesh is loading or in (`scan`,
 * issue 118). A scan with no mesh, or whose mesh doesn't load, sends the view
 * back to the board with a line saying why.
 */
export function firstPersonOffered(floor: FloorGraph, scan: ScanPreload | null = null): boolean {
  return floor.source === "fixture" || (floor.source === "matterport" && scan !== null && scan.failed === null);
}

/** Whether the Run screen shows first person: it was chosen, it can be drawn, and it is offered on this floor. */
export function firstPersonOn(state: RunViewState, floor: FloorGraph, scan: ScanPreload | null = null): boolean {
  return state.view === "first-person" && firstPersonOffered(floor, scan);
}

export const SCAN_FAILED = "First person couldn't load this scan's mesh. You're on the board.";

/** A live scan's mesh loading behind the Run screen, for first person (scan-preload.ts). */
export interface ScanPreload {
  handle: ScanHandle | null;
  /** A line for the status bar when the scan can't be walked; null while it loads or once it is in. */
  failed: string | null;
  ready: boolean;
}

const LOADING: ScanPreload = Object.freeze({ handle: null, failed: null, ready: false });

/** The line first person gives when a live scan's floor has no mesh to walk at all. */
export const SCAN_NO_MESH = "This scan has no mesh to walk, so first person isn't offered on it. You're on the board.";

/** What first person does on a live scan's floor with `scan` as it stands: wait for it, walk it, or give the board back. */
export type ScanStage =
  | { kind: "wait" }
  | { kind: "walk"; handle: ScanHandle }
  | { kind: "refuse"; line: string };

/**
 * First person's choice on a live scan, from the preload as it stands. While
 * the preload's own `import()` is still resolving it has neither a handle nor
 * a failure: that is a wait, never "no mesh" (the view can mount first, since
 * its chunk is the lighter one). Only a preload that failed, or none at all,
 * gives the board back.
 */
export function scanStageOf(scan: ScanPreload | null): ScanStage {
  if (!scan) return { kind: "refuse", line: SCAN_NO_MESH };
  if (scan.failed !== null) return { kind: "refuse", line: scan.failed };
  if (scan.handle) return { kind: "walk", handle: scan.handle };
  return { kind: "wait" };
}

/**
 * Starts loading the scan for first person as soon as there is a model id,
 * or takes the tab's scan of it if one is held already (scan-hold.ts): the
 * Plan screen starts it, and the Run screen finds it in or on its way.
 * Unmounting lets nothing go. Null with no model id. With `primeAt` (the
 * Plan screen gives the run's start node), the scan's picture around that
 * position is drawn, unseen, once it is in, so first person opens on it.
 * `open` is for tests.
 */
export function useScanPreload(
  modelId: string | null,
  open: () => Promise<(modelId: string) => ScanHandle> = () => import("./scan-preload").then((m) => m.openScan),
  primeAt: string | null = null,
): ScanPreload | null {
  const [state, setState] = useState<{ modelId: string; preload: ScanPreload } | null>(null);
  useEffect(() => {
    if (!modelId) return;
    let gone = false;
    const set = (preload: ScanPreload) => {
      if (!gone) setState({ modelId, preload });
    };
    Promise.all([open(), import("./scan-hold")])
      .then(([openScan, { holdScan }]) => {
        if (gone) return;
        const held = holdScan(modelId, openScan);
        set({ handle: held, failed: null, ready: false });
        void held.ready.then((ok) => {
          const message = held.status().message;
          set(ok ? { handle: held, failed: null, ready: true } : { handle: null, failed: message ? `${message} You're on the board.` : SCAN_FAILED, ready: false });
          if (ok && primeAt && !gone) {
            void import("./scan-preload").then(({ primeScan }) => {
              if (!gone) stopPrime = primeScan(held, primeAt);
            });
          }
        });
      })
      .catch(() => set({ handle: null, failed: FP_UNAVAILABLE, ready: false }));
    let stopPrime = () => {};
    return () => {
      gone = true;
      stopPrime();
    };
    // `open` is a test seam, not something the scan depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, primeAt]);
  if (!modelId) return null;
  return state?.modelId === modelId ? state.preload : LOADING;
}

const VIEWS: readonly { view: RunView; label: string; hint: string; icon: LucideIcon }[] = [
  { view: "board", label: "Board", hint: "Board: the floor from above, played by number keys", icon: Grid3x3 },
  { view: "first-person", label: "First person", hint: "First person: walk the floor with W, A, S, D and the mouse", icon: Footprints },
];

/**
 * The view switch: two buttons, one pressed. It sits over the top of the
 * board's area, towards the right, clear of the board's top bar, which is
 * full at 1280 px. The corners are spoken for: the mute button (PR 104) has
 * the top right one (`top-2 right-8`, about 70 px wide), the play mode switch
 * and the turn timer (PR 105) the bottom two, so this stands 192 px in from the
 * right edge, on the mute button's line, clear of it and the Fullscreen button. Nothing shows on a floor from a live
 * scan that first person can't stand on, or on a phone showing the board:
 * first person needs a keyboard.
 */
export function ViewSwitch({
  state,
  floor,
  scan = null,
  className,
}: {
  state: RunViewState;
  floor: FloorGraph;
  scan?: ScanPreload | null;
  className?: string;
}) {
  if (!firstPersonOffered(floor, scan)) return null;
  return (
    <div
      role="group"
      aria-label="View"
      data-testid="run-view"
      data-view={state.view}
      className={cn(
        "absolute top-2 z-10 flex rounded-sm bg-surface-1 shadow-e-1 max-md:left-3 md:right-48",
        // A phone is not offered first person, but one that remembers it keeps the way back to the board.
        state.view === "board" ? "max-md:hidden" : null,
        className,
      )}
    >
      {VIEWS.map(({ view, label, hint, icon: Icon }, i) => {
        const on = view === state.view;
        const off = view === "first-person" && state.unavailable;
        return (
          <button
            key={view}
            type="button"
            data-testid={`run-view-${view}`}
            aria-pressed={on}
            disabled={off}
            title={off ? (state.reason ?? "First person needs WebGL, which this browser isn't giving it") : hint}
            onClick={(event) => {
              state.choose(view);
              // The keys go to the view, not back to this button: Space would press it again.
              event.currentTarget.blur();
            }}
            className={cn(
              "relative inline-flex h-10 items-center justify-center gap-2 border px-3 text-sm font-medium select-none",
              "transition-colors duration-fast ease-out focus-visible:z-10 disabled:cursor-not-allowed disabled:text-text-3",
              "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.5]",
              i === 0 ? "rounded-l-sm" : "-ml-px rounded-r-sm",
              on
                ? "z-[1] border-border-strong bg-surface-3 text-text-1"
                : "border-border text-text-2 hover:bg-surface-3 hover:text-text-1",
            )}
          >
            <Icon aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}
