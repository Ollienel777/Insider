"use client";

// The scan as the Run view (issue 107): what stands between the Inside view's
// player and the engine. It keeps the camera on the player's node, says what W
// would step to, plays a step as the engine's move, and says when the scan
// cannot be the view, so the board takes over.
//
// The engine is the authority. A step asks the Run screen to play `move`; the
// camera then follows the player's node, as the Inside view panel does. One
// hop is in flight at a time: from the move until the camera stands on the
// node, nothing else steps.
//
// Free of React, so it runs on a stubbed Inside view (scan-walk.test.ts). The
// pose and the floor points stay in this object's memory (SPEC §4.5).
import type { InsidePose, InsideView, ScanPoint } from "@/adapters/matterport";
import { pickTarget, stepMs } from "./controls";

/** How long the player has to open and stand on the player's node before the board takes over (the Inside view's bound). */
export const SCAN_OPEN_MS = 20_000;
/** A hop the camera has not finished this long after its travel time counts as not arrived. */
export const HOP_GRACE_MS = 4_000;
/** How long after a move settles the camera may take to report standing on the node. */
export const SETTLE_MS = 1_000;
/** While opening, a move the player refused is tried again after this long. */
export const OPEN_RETRY_MS = 500;
/** How near, across the floor, the camera must be to a position's floor point to stand on it. */
export const ARRIVE_METRES = 0.6;
/** How far above or below a position's floor point the camera may be and still stand on it (the scanner's height varies). */
export const ARRIVE_HEIGHT_METRES = 2.5;

/** Why the scan stopped being the view. */
export type ScanFailure = "timeout" | "error" | "lost";

/** `opening` until the camera first stands on the player's node; `failed` once the board has taken over. */
export type ScanPhase = "opening" | "ready" | "failed";

export interface ScanWalkState {
  phase: ScanPhase;
  /** Why it failed, once it has. */
  failure?: ScanFailure;
  /** The node the camera stands on; null until it first arrives. A hop is in flight while this is not the player's node. */
  at: string | null;
}

export interface ScanWalkOptions {
  /** Plays the engine's move to `sweepId`; true when the engine took it. */
  move: (sweepId: string) => boolean;
  /** The legal hops from the player's node now: the engine's move choices. */
  hops: () => readonly string[];
  /** The player's frame, in CSS pixels. */
  size: () => { w: number; h: number };
  onChange: (state: ScanWalkState) => void;
  /** The hop W would step to now, each time it changes. */
  onAim?: (sweepId: string | null) => void;
  /** W was pressed with no hop in view. */
  onNoAim?: () => void;
  openMs?: number;
}

export interface ScanWalk {
  /** The player opened: the walk reads its pose and floor points from here on. */
  opened(view: InsideView): void;
  /** The player did not open. */
  failed(): void;
  /** The player's node now, from the engine. The camera goes there. */
  follow(sweepId: string): void;
  /** What W steps to now: `pickTarget` on the latest pose. Null while opening, travelling or failed. */
  target(): string | null;
  /** Plays the move to `sweepId` and resolves when the camera has arrived, or at once when nothing is played. */
  step(sweepId: string): Promise<void>;
  /** The aimed hop, recomputed now: after the legal hops change without the camera moving. */
  aim(): void;
  state(): ScanWalkState;
  dispose(): void;
}

/**
 * Whether the scan is the Run screen's stage: in Live, on a board from a live
 * scan whose player can open, until the scan fails. Tactical, and every
 * fixture floor, keep the board as it is.
 */
export function scanIsStage({ live, scan, phase }: { live: boolean; scan: boolean; phase: ScanPhase }): boolean {
  return live && scan && phase !== "failed";
}

/** Whether a camera at `camera` stands on the position whose floor point is `floor`. */
export function standsOn(camera: ScanPoint, floor: ScanPoint): boolean {
  const across = Math.hypot(camera.x - floor.x, camera.z - floor.z);
  return across <= ARRIVE_METRES && Math.abs(camera.y - floor.y) <= ARRIVE_HEIGHT_METRES;
}

/** The distance across the floor between two floor points, in metres. */
export function across(a: ScanPoint, b: ScanPoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function createScanWalk({ move, hops, size, onChange, onAim, onNoAim, openMs = SCAN_OPEN_MS }: ScanWalkOptions): ScanWalk {
  let state: ScanWalkState = { phase: "opening", at: null };
  let view: InsideView | null = null;
  let points: ReadonlyMap<string, ScanPoint> | null = null;
  let pose: InsidePose | null = null;
  /** The node the camera is sent to: the player's node. */
  let want: string | null = null;
  /** The node of the flight under way, if one is. */
  let flight: string | null = null;
  let aimed: string | null = null;
  let disposed = false;
  let unsubscribe: (() => void) | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  /** Steps waiting for the camera to arrive. */
  let waiting: (() => void)[] = [];

  const later = (fn: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
    return timer;
  };
  const clearTimers = () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };
  const release = () => {
    const done = waiting;
    waiting = [];
    for (const resolve of done) resolve();
  };
  const set = (next: ScanWalkState) => {
    state = next;
    onChange(next);
  };

  const fail = (failure: ScanFailure) => {
    if (disposed || state.phase === "failed") return;
    clearTimers();
    clearTimeout(openTimer);
    unsubscribe?.();
    unsubscribe = null;
    flight = null;
    setAim(null);
    set({ phase: "failed", failure, at: state.at });
    release();
  };

  // Apart from the hop timers: it runs from creation until the camera first stands on the player's node.
  const openTimer = setTimeout(() => {
    if (state.phase === "opening") fail("timeout");
  }, openMs);

  function setAim(next: string | null) {
    if (next === aimed) return;
    aimed = next;
    onAim?.(next);
  }

  /** Ready for a step: the camera stands on the player's node, and no step is waiting on a move. */
  function idle(): boolean {
    return state.phase === "ready" && flight === null && want === state.at && waiting.length === 0;
  }

  /** `pickTarget` on the latest pose, over the legal hops the scan has a floor point for. */
  function pick(): string | null {
    if (!idle() || !view || !points || !pose) return null;
    const known = points;
    const legal = hops().filter((id) => known.has(id));
    const project = view.project.bind(view);
    return pickTarget({ project, size: size(), hops: legal, floorPoint: (id) => known.get(id)! });
  }

  function arrived(sweepId: string) {
    flight = null;
    clearTimers();
    if (state.phase === "opening") clearTimeout(openTimer);
    set({ phase: "ready", at: sweepId });
    setAim(pick());
    release();
  }

  /** Whether the latest pose stands on the flight's node; arrives there if it does. */
  function check(): boolean {
    if (flight === null || !pose || !points) return false;
    const floor = points.get(flight);
    if (!floor || !standsOn(pose.position, floor)) return false;
    arrived(flight);
    return true;
  }

  /** Sends the camera to the player's node, if it is not there or on its way. */
  function go() {
    if (disposed || state.phase === "failed" || !view || !points || want === null) return;
    if (flight === want) return;
    if (want === state.at && flight === null) return;
    const to = want;
    const floor = points.get(to);
    if (!floor) return fail("error");
    const from = state.at !== null ? points.get(state.at) : undefined;
    // The opening flight keeps the Inside view's own travel time; a hop takes its length's.
    const ms = from ? stepMs(across(from, floor)) : undefined;
    flight = to;
    setAim(null);
    clearTimers();
    if (check()) return;
    if (state.phase === "ready") later(() => flight === to && fail("lost"), (ms ?? 600) + HOP_GRACE_MS);
    const current = view;
    void (ms === undefined ? current.moveTo(to) : current.moveTo(to, ms)).then(() => {
      if (disposed || flight !== to || state.phase === "failed") return;
      if (check()) return;
      if (state.phase === "opening") {
        // The player may refuse moves while its own opening flight runs: try again until the open bound.
        later(() => {
          if (flight !== to || check()) return;
          flight = null;
          go();
        }, OPEN_RETRY_MS);
        return;
      }
      later(() => flight === to && !check() && fail("lost"), SETTLE_MS);
    });
  }

  return {
    opened(opened) {
      if (disposed || state.phase === "failed") return opened.disconnect();
      view = opened;
      unsubscribe = opened.onPose((next) => {
        pose = next;
        if (check()) return;
        setAim(pick());
      });
      opened.floorPoints().then(
        (map) => {
          if (disposed || state.phase === "failed") return;
          if (map.size === 0) return fail("error");
          points = map;
          go();
        },
        () => fail("error"),
      );
    },
    failed() {
      fail("error");
    },
    follow(sweepId) {
      if (want === sweepId) return;
      want = sweepId;
      go();
    },
    target() {
      const next = pick();
      setAim(next);
      if (next === null && idle()) onNoAim?.();
      return next;
    },
    step(sweepId) {
      if (!idle()) return Promise.resolve();
      const arrival = new Promise<void>((resolve) => waiting.push(resolve));
      if (!move(sweepId)) release();
      // The Run screen sends the player's new node with its next render; a move that never moves the player releases the step.
      else later(() => want !== sweepId && release(), SETTLE_MS);
      return arrival;
    },
    aim() {
      setAim(pick());
    },
    state: () => state,
    dispose() {
      disposed = true;
      clearTimers();
      clearTimeout(openTimer);
      unsubscribe?.();
      unsubscribe = null;
      release();
    },
  };
}
