"use client";

// The free-walk sandbox's screen (issue 118): a full-window canvas, a small
// HUD and the control hints. The scene itself is engine.ts.
import { useEffect, useRef, useState } from "react";
import type { MeshResolution, PanoResolution } from "@/lib/scan-mesh/manifest";
import type { ScanWalk, WalkHud, WalkPhase } from "./engine";

interface Props {
  /** Null when the address has no usable `m`. */
  modelId: string | null;
  /** Whether the address had an `m` at all. */
  given: boolean;
  faces: PanoResolution;
  mesh: MeshResolution;
  debug: boolean;
}

const PHASE: Record<WalkPhase, string> = {
  manifest: "Asking for the scan",
  mesh: "Downloading the mesh",
  building: "Building the walkable mesh",
  ready: "Ready",
  "no-mesh": "No mesh",
  error: "Stopped",
};

const HINTS: [string, string][] = [
  ["W A S D", "run"],
  ["Shift", "walk"],
  ["Mouse", "look"],
  ["- =", "sensitivity"],
  ["T", "mesh / panoramas"],
  ["P", "nearest scan position"],
  ["N", "next scan position"],
  ["G", "mesh edges"],
  ["Esc", "release"],
];

const seconds = (value: number | null) => (value === null ? "…" : `${value.toFixed(2)} s`);

export function ScanWalkScreen({ modelId, given, faces, mesh, debug }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hud, setHud] = useState<WalkHud | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !modelId) return;
    let engine: ScanWalk | null = null;
    let gone = false;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // three.js is loaded only here, so no other page pays for it.
    import("./engine")
      .then(({ ScanWalk }) => {
        if (gone) return;
        engine = new ScanWalk(element, { modelId, faces, mesh, reducedMotion, debug, onHud: setHud });
      })
      .catch(() => setFailed("This browser couldn't start the 3D view (WebGL 2 is needed)."));
    return () => {
      gone = true;
      engine?.dispose();
    };
  }, [modelId, faces, mesh, debug]);

  if (!modelId) {
    return (
      <Shell>
        <Notice
          title={given ? "That isn't a model id" : "No scan chosen"}
          body={
            given
              ? "A model id is 6 to 20 letters and digits."
              : "Add a scan's model id to the address: /spike/mesh?m=MODEL_ID"
          }
        />
      </Shell>
    );
  }

  const phase = hud?.phase ?? "manifest";
  const stopped = failed ?? (phase === "error" || phase === "no-mesh" ? hud?.message : null);
  const loading = !failed && (phase === "manifest" || phase === "mesh" || phase === "building");
  const ready = phase === "ready";

  return (
    <Shell>
      <canvas
        ref={canvas}
        data-testid="scan-walk-canvas"
        aria-label="First-person view of the scan. Click to look around; W A S D to move."
        className={`absolute inset-0 size-full outline-none ${ready ? "cursor-crosshair" : ""}`}
      />

      {ready && hud?.locked && (
        <div aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 size-1 -translate-1/2 rounded-full bg-n-50 ring-1 ring-n-950" />
      )}

      <aside
        data-testid="scan-walk-hud"
        className="pointer-events-none absolute top-4 left-4 w-72 rounded-md border border-border bg-surface-1/85 p-4 shadow-e-2 backdrop-blur-sm"
      >
        <p className="font-mono text-xs tracking-wide text-text-3 uppercase">Scan free walk · sandbox</p>
        <p className="mt-1 flex items-center gap-2 text-sm text-text-1" role="status">
          <span
            aria-hidden
            className={`size-2 rounded-full ${ready ? "bg-success" : stopped ? "bg-danger" : "animate-pulse bg-accent"}`}
          />
          {failed ? "Stopped" : PHASE[phase]}
        </p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs tabular-nums">
          <Row label="Mesh">
            {hud && hud.triangles > 0 ? `${hud.triangles.toLocaleString("en-US")} triangles` : "…"}
          </Row>
          <Row label="Load">
            {hud
              ? `${seconds(hud.timings.manifest)} · ${seconds(hud.timings.download)}${
                  hud.timings.megabytes === null ? "" : ` (${hud.timings.megabytes.toFixed(1)} MB)`
                } · ${seconds(hud.timings.build)}`
              : "…"}
          </Row>
          <Row label="Position">
            {hud?.position ? hud.position.map((v) => v.toFixed(1)).join(", ") + (hud.grounded ? "" : " · no floor") : "…"}
          </Row>
          <Row label="Speed">{hud ? `${hud.speed.toFixed(1)} m/s · ${Math.round(hud.fps)} fps` : "…"}</Row>
          <Row label="Mouse">{hud ? `${hud.sensitivity.toFixed(2)}× sensitivity` : "…"}</Row>
          <Row label="View">{hud?.projection === false ? "Mesh only" : `Panoramas (${hud?.faces ?? faces})`}</Row>
          <Row label="In use">
            {hud && hud.panos.length > 0
              ? hud.panos.map((p) => `${p.index + 1}: ${Math.round(p.share * 100)}%`).join(" · ")
              : "none yet"}
          </Row>
          <Row label="Loaded">
            {hud ? `${hud.panosReady} of ${hud.panoCount}${hud.panosLoading > 0 ? ` · ${hud.panosLoading} loading` : ""}` : "…"}
          </Row>
        </dl>
      </aside>

      {loading && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <p className="rounded-md border border-border bg-surface-1/85 px-4 py-3 text-sm text-text-2 backdrop-blur-sm">
            {PHASE[phase]}…
          </p>
        </div>
      )}

      {stopped && (
        <div className="absolute inset-0 grid place-items-center">
          <Notice title={phase === "no-mesh" ? "No mesh for this scan" : "The scan didn't load"} body={stopped} />
        </div>
      )}

      {ready && !hud?.locked && (
        <div className={`pointer-events-none absolute inset-0 grid justify-items-center ${hud?.lockRefused ? "items-start pt-4" : "items-center"}`}>
          <p data-testid="scan-walk-look-hint" className="rounded-md border border-border-strong bg-surface-1/90 px-5 py-3 text-sm text-text-1 shadow-e-2 backdrop-blur-sm">
            {hud?.lockRefused ? "Hold the mouse button and drag to look around" : "Click to look around, or hold and drag"}
          </p>
        </div>
      )}

      {ready && (
        <ul
          aria-label="Controls"
          className="pointer-events-none absolute bottom-4 left-1/2 flex w-max max-w-[calc(100%-2rem)] -translate-x-1/2 flex-wrap justify-center gap-x-4 gap-y-2 rounded-md border border-border bg-surface-1/85 px-4 py-2 backdrop-blur-sm"
        >
          {HINTS.map(([key, does]) => (
            <li key={key} className="flex items-center gap-2 text-xs text-text-2">
              <kbd className="rounded-sm border border-border-strong bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-text-1">
                {key}
              </kbd>
              {does}
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="relative h-dvh w-full overflow-hidden bg-surface-0 text-text-1">{children}</main>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-text-3 uppercase">{label}</dt>
      <dd className="min-w-0 text-text-1">{children}</dd>
    </>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="max-w-md rounded-md border border-border bg-surface-1 p-6 shadow-e-2" role="alert">
        <h1 className="text-base font-medium text-text-1">{title}</h1>
        <p className="mt-2 text-sm text-text-2">{body}</p>
      </div>
    </div>
  );
}
