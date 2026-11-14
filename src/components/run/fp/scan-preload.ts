"use client";

// The scan behind first person on a live-scan floor (issue 118), opened when
// the Run screen opens so the mesh is in, or on its way, by the time the
// player switches to first person. The renderer draws to a canvas of its own,
// which the first-person view puts on the page while it shows and takes off
// again, so switching to the board and back loads nothing twice. All of the
// scan stays in this tab's memory.
//
// This module carries three.js: the Run screen loads it with `import()`, so
// the board's page does not.
import { ScanView, type ScanViewStatus } from "@/app/spike/mesh/scan-view";

export interface ScanHandle {
  view: ScanView;
  canvas: HTMLCanvasElement;
  /** True once the mesh is in and the scan can be walked; false if it can't be. */
  ready: Promise<boolean>;
  status(): ScanViewStatus;
  /** Calls `listener` whenever the status has news; returns the way to stop. */
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export function openScan(modelId: string): ScanHandle {
  const canvas = document.createElement("canvas");
  canvas.dataset.testid = "fp-scan-canvas";
  canvas.className = "absolute inset-0 block h-full w-full";
  const listeners = new Set<() => void>();
  // The first frame decides the drawing size; until it shows, a screen's worth.
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const view = new ScanView(canvas, { modelId, onChange: () => listeners.forEach((l) => l()) });
  return {
    view,
    canvas,
    ready: view.ready,
    status: () => view.status(),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      listeners.clear();
      canvas.remove();
      view.dispose();
    },
  };
}
