"use client";

// What the overlay reads from the Inside view (issue 108), and when: the
// scan's floor points once, and the camera's pose each time it changes, at
// most once a frame (the pose streams at about 55 a second while the camera
// moves). The layer's React effects only open and close this, so its
// lifecycle is tested on a stubbed view without a DOM.
//
// SPEC §4.5: the floor points and the pose go to the caller's memory only.
// Nothing is stored or sent.
import type { InsidePose, InsideView, ScanPoint } from "@/adapters/matterport";

/** Runs `fn` once, soon; returns the cancel. */
export type Schedule = (fn: () => void) => () => void;

/** The next animation frame. */
export const nextFrame: Schedule = (fn) => {
  const id = requestAnimationFrame(fn);
  return () => cancelAnimationFrame(id);
};

export interface OverlayListener {
  /** The scan's floor points, by node id: once, or an empty map when the view gave none. */
  onPoints(points: ReadonlyMap<string, ScanPoint>): void;
  /** The latest pose, at most once per `schedule`. */
  onPose(pose: InsidePose): void;
}

export interface OverlaySession {
  /** Stops listening: nothing reaches the listener after this. */
  close(): void;
}

export function openOverlaySession(view: InsideView, listener: OverlayListener, schedule: Schedule = nextFrame): OverlaySession {
  let closed = false;
  let latest: InsidePose | null = null;
  let cancel: (() => void) | null = null;

  view.floorPoints().then(
    (points) => {
      if (!closed) listener.onPoints(points);
    },
    (error: unknown) => {
      if (closed) return;
      console.warn(`Matterport: the overlay got no floor points (${error instanceof Error ? error.message : String(error)})`);
      listener.onPoints(new Map());
    },
  );

  const unsubscribe = view.onPose((pose) => {
    if (closed) return;
    latest = pose;
    if (cancel) return;
    cancel = schedule(() => {
      cancel = null;
      if (closed || !latest) return;
      const pose = latest;
      latest = null;
      listener.onPose(pose);
    });
  });

  return {
    close() {
      if (closed) return;
      closed = true;
      unsubscribe();
      cancel?.();
      cancel = null;
      latest = null;
    },
  };
}
