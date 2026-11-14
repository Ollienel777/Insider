"use client";

// The Run screen in first person (issue 115): the room the player is
// standing in, on a fixture floor drawn by our own renderer, or on a live
// scan drawn by the scan view from its mesh (issue 118), walked freely with
// the keys and the mouse. The engine is untouched and still decides
// everything: this view hands its actions to `onAct`, which is the Run
// screen's own `play`, and draws whatever run state comes back.
//
// Five parts, each replaceable:
//   controller.ts  keys and mouse → what the player asks for
//   walker.ts      free position → engine actions, over a `Ground`
//   scene.ts       the floor's static geometry, one three.js group
//   actors.ts      guards, cameras, sight, doors and markers, over a `Ground`
//   stages.ts      the floor drawn and stood on: a fixture's, or a scan's
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Vector3 } from "three";
import type { Action, RunState } from "@/engine";
import type { PlacedLevel } from "@/level/placer";
import { objectiveLabel, objectiveNoun } from "@/lib/objective-noun";
import { cn } from "@/lib/utils";
import { choices, roomName } from "../board";
import type { HeldAction, ScanHandle } from "./run-view";
import { Actors, type Marks } from "./actors";
import { Controller } from "./controller";
import { readPalette } from "./palette";
import { fixtureStage, scanStage, type Stage } from "./stages";
import { FP } from "./tuning";
import { createWalker, heldAction, promptFor, stepWalker, type Prompt } from "./walker";
import { buildWorld, groundOf } from "./world";

export interface FirstPersonViewProps {
  placed: PlacedLevel;
  run: RunState;
  /** The mission's objective, as the panel words it. */
  objective: string;
  /** Plays an engine action: the Run screen's own `play`. */
  onAct: (action: Action) => void;
  /** WebGL is not there, or its context was lost: the Run screen goes back to the board. */
  onUnavailable: () => void;
  /** Hands the turn clock what to play when a turn runs out: the next pick while E is held, or a wait. */
  onHeld: (held: HeldAction | null) => void;
  /** The player paused the clock with P. */
  paused: boolean;
  /** On a live-scan floor: the scan, loading since the Run screen opened. Null while its module loads. */
  scan?: ScanHandle | null;
  /** The scan could not be walked (no mesh, or the board would not fit onto it): the Run screen goes back to the board. */
  onScanFailed?: (message: string) => void;
}

const SCAN_UNFITTED = "First person couldn't place this board in its scan. You're on the board.";

const SCAN_PHASE: Record<string, string> = {
  manifest: "Asking for the scan",
  mesh: "Downloading the scan's mesh",
  building: "Building the walls and floor",
  ready: "Stepping in",
};

interface Hud {
  locked: boolean;
  /** The browser refused to lock the mouse: the hint says to drag instead. */
  refused: boolean;
  prompt: Prompt;
  /** The room the engine has the player in, when the body has walked on to a node it cannot move to. */
  /** E is held. */
  using: boolean;
}

const LABEL_TONE: Record<string, string> = {
  guard: "border-border-strong bg-surface-1 text-text-1",
  cleaner: "border-border bg-surface-1 text-text-2",
  camera: "border-border bg-surface-1 text-text-2",
  objective: "border-n-100 bg-surface-1 text-text-1",
  exit: "border-border-strong bg-surface-1 text-text-2",
};
const LABEL_BASE = "absolute left-0 top-0 rounded-sm border px-1.5 py-0.5 font-mono text-xs whitespace-nowrap uppercase tracking-[0.06em] will-change-transform";

/** A label's height and the gap under it, in pixels: how far one is lifted clear of another. */
const LABEL_PITCH = 26;

/** Whether this browser will give a canvas a WebGL 2 context, asked of a spare canvas. */
function hasWebGL(): boolean {
  try {
    return document.createElement("canvas").getContext("webgl2") !== null;
  } catch {
    return false;
  }
}

export default function FirstPersonView({ placed, run, onAct, onUnavailable, onHeld, paused, scan = null, onScanFailed }: FirstPersonViewProps) {
  const surface = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const labelLayer = useRef<HTMLDivElement>(null);
  const [hud, setHud] = useState<Hud>({ locked: false, refused: false, prompt: null, using: false });
  const [ready, setReady] = useState(false);
  const [scanPhase, setScanPhase] = useState<string | null>(null);
  const [fitRms, setFitRms] = useState<number | null>(null);

  // A live scan's floor is its mesh (stages.ts); a fixture's is built from its rooms.
  const live = placed.level.floor.source !== "fixture";
  const world = useMemo(() => (live ? null : buildWorld(placed.level.floor)), [placed, live]);
  const ground = useMemo(() => (world ? groundOf(world) : null), [world]);

  // The loop reads the latest run and the latest `play` without being rebuilt for each turn. Updated in a
  // layout effect, before the browser paints, so no animation frame reads the run before last.
  const latest = useRef({ run, onAct, onUnavailable, onHeld, onScanFailed });
  useLayoutEffect(() => {
    latest.current = { run, onAct, onUnavailable, onHeld, onScanFailed };
  }, [run, onAct, onUnavailable, onHeld, onScanFailed]);

  useEffect(() => {
    const host = surface.current;
    const target = canvas.current;
    const labels = labelLayer.current;
    if (!host || !target || !labels) return;
    // A live scan's handle comes once its module is in: until then, the loading line.
    if (live && !scan) return;
    if (!hasWebGL()) {
      latest.current.onUnavailable();
      return;
    }

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const palette = readPalette(document.documentElement);
    const { level } = placed;
    let gone = false;
    let stop: (() => void) | null = null;
    let unsubscribe: (() => void) | null = null;

    /** The loop, over whichever floor it stands on. */
    const play = (stage: Stage) => {
      const { scene, camera, ground } = stage;
      const first = latest.current.run;
      const marks: Marks = {
        objective: { nodeId: level.objective, label: objectiveLabel(level.missionId) },
        exits: level.exits.map((nodeId) => ({
          nodeId,
          label: `Exit · ${placed.entries.find((e) => e.nodeId === nodeId)?.label ?? roomName(level.floor, nodeId)}`,
        })),
        cameras: stage.cameras(first),
      };
      const tempo = (id: string) => level.guardTempo?.[id] ?? level.patrolTempo;
      const actors = new Actors(ground, palette, marks, still, FP.turnMs, tempo);
      actors.group.position.y = stage.baseY;
      scene.add(actors.group);

      // Facing the first way on from where the engine has the player.
      let walker = createWalker(ground, first);
      const wayOn = (state: RunState, from: { x: number; y: number }): number | null => {
        const ahead = choices(state)[0];
        const towards = ahead ? ground.path(state.playerNode, ahead.nodeId)[1] : null;
        return towards ? Math.atan2(towards.y - from.y, towards.x - from.x) : null;
      };
      const controller = new Controller(
        host,
        wayOn(first, walker.pos) ?? 0,
        (locked) => setHud((h) => (h.locked === locked ? h : { ...h, locked, refused: locked ? false : h.refused })),
        () => setHud((h) => (h.refused ? h : { ...h, refused: true })),
      );

      const resize = () => {
        const { clientWidth: w, clientHeight: h } = host;
        if (w === 0 || h === 0) return;
        stage.resize(w, h);
      };
      resize();
      const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
      observer?.observe(host);

      const labelEls = new Map<string, HTMLSpanElement>();
      const point = new Vector3();
      let seen: RunState | null = null;
      let last = performance.now();
      let owed = 0;
      let use = false;
      let bob = 0;
      let hudKey = "";
      let areas = false;
      // The turn clock asks the view what a turn the player lets run out should be.
      latest.current.onHeld((state) => heldAction(walker, ground, state, { use: controller.using, yaw: controller.yaw }));
      let raf = 0;
      let drawn = false;

      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
        last = now;
        const { run: current, onAct: act } = latest.current;
        if (current !== seen) {
          actors.sync(current, now);
          seen = current;
        }

        // The movement runs at a fixed step, however fast the screen draws.
        controller.frame(dt);
        const controls = controller.controls();
        use ||= controls.usePressed;
        owed += dt;
        const stood = walker.pos;
        while (owed >= FP.stepS) {
          owed -= FP.stepS;
          const out = stepWalker(walker, ground, current, { ...controls, usePressed: use });
          use = false;
          walker = out.walker;
          if (out.action) act(out.action);
        }
        // Put back on the engine's node (a restart, a number key): look the way that hop went, or,
        // at the start, the first way on. A frame of walking never covers this much ground.
        if (Math.hypot(walker.pos.x - stood.x, walker.pos.y - stood.y) > 0.5) {
          const hop = Math.atan2(walker.pos.y - stood.y, walker.pos.x - stood.x);
          controller.yaw = current.turn === 0 ? (wayOn(current, walker.pos) ?? hop) : hop;
          controller.pitch = 0;
        }
        if (controller.areas !== areas) {
          areas = controller.areas;
          actors.showAreas(areas, current.playerNode);
        }

        // The view: at eye height, with a small bob tied to the ground covered.
        const speed = Math.hypot(walker.vel.x, walker.vel.y);
        bob += ((still ? 0 : Math.min(1, speed / FP.runMps)) - bob) * Math.min(1, dt * 12);
        const lift = Math.sin((walker.walked / FP.strideM) * Math.PI * 4) * FP.bobM * bob;
        actors.update(now);
        stage.draw(walker, lift, controller.yaw, controller.pitch, dt);

        // Labels: each at its piece, hidden behind the view and behind walls (a beacon shows through).
        // Nearest first, and one that would cover another is drawn above it.
        const w = host.clientWidth;
        const h = host.clientHeight;
        const shown = new Set<string>();
        const taken: { x: number; y: number; half: number }[] = [];
        const far = (at: { x: number; y: number }) => Math.hypot(at.x - walker.pos.x, at.y - walker.pos.y);
        for (const label of actors.labels(current).sort((p, q) => far(p.at) - far(q.at))) {
          point.set(label.x, label.y + stage.baseY, label.z).project(camera);
          const away = far(label.at);
          const inSight = ground.clear(walker.pos, label.at, current.locked);
          if (point.z > 1 || point.z < -1 || (!label.beacon && (!inSight || away > 30))) continue;
          shown.add(label.key);
          let el = labelEls.get(label.key);
          if (!el) {
            el = document.createElement("span");
            el.className = `${LABEL_BASE} ${LABEL_TONE[label.tone]}`;
            el.dataset.label = label.key;
            labels.appendChild(el);
            labelEls.set(label.key, el);
          }
          const text = label.beacon ? `${label.text} · ${Math.max(1, Math.round(away))} m` : label.text;
          if (el.textContent !== text) el.textContent = text;
          const x = ((point.x + 1) / 2) * w;
          let y = ((1 - point.y) / 2) * h;
          const half = text.length * 4 + 10;
          while (taken.some((t) => Math.abs(t.x - x) < t.half + half && Math.abs(t.y - y) < LABEL_PITCH)) y -= LABEL_PITCH;
          taken.push({ x, y, half });
          el.style.opacity = inSight ? "1" : "0.55";
          el.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
        }
        for (const [key, el] of labelEls) {
          if (shown.has(key)) continue;
          el.remove();
          labelEls.delete(key);
        }

        // The HUD's words change rarely: React hears of it only when they do. The door being picked
        // carries the engine's own count on a ring on its face.
        const prompt = promptFor(walker, ground, current, controller.yaw);
        const using = controller.using;
        actors.showPick(prompt?.kind === "pick" && (using || prompt.done > 0) ? prompt : null);
        const key = JSON.stringify([prompt, using]);
        if (key !== hudKey) {
          hudKey = key;
          setHud((was) => ({ ...was, prompt, using }));
        }
        if (!drawn) {
          drawn = true;
          setReady(true);
        }
      };
      raf = requestAnimationFrame(frame);

      return () => {
        cancelAnimationFrame(raf);
        observer?.disconnect();
        latest.current.onHeld(null);
        controller.dispose();
        for (const el of labelEls.values()) el.remove();
        scene.remove(actors.group);
        actors.dispose();
        stage.dispose();
      };
    };

    if (!live) {
      const stage = fixtureStage(target, placed, world!, ground!, palette, () => latest.current.onUnavailable());
      if (!stage) {
        latest.current.onUnavailable();
        return;
      }
      stop = play(stage);
    } else if (scan) {
      // The scan's own canvas, loading since the Run screen opened, in place of ours while this shows.
      host.insertBefore(scan.canvas, target);
      target.hidden = true;
      const phase = () => setScanPhase(scan.status().phase);
      phase();
      unsubscribe = scan.subscribe(phase);
      void scan.ready.then((ok) => {
        if (gone) return;
        const stage = ok ? scanStage(scan.view, placed, latest.current.run) : null;
        if (!stage) {
          latest.current.onScanFailed?.(ok ? SCAN_UNFITTED : (scan.status().message ?? SCAN_UNFITTED));
          return;
        }
        setFitRms(stage.rms);
        stop = play(stage);
      });
    }

    return () => {
      gone = true;
      stop?.();
      unsubscribe?.();
      if (scan) {
        scan.canvas.remove();
        target.hidden = false;
      }
    };
  }, [world, ground, placed, live, scan]);

  const noun = objectiveNoun(placed.level.missionId);
  const over = run.status !== "playing";
  const tint = run.alarm === "calm" ? null : run.alarm === "suspicious" ? "var(--warning)" : "var(--danger)";

  return (
    <div
      ref={surface}
      data-testid="fp-view"
      data-ready={ready ? "true" : undefined}
      data-floor={live ? "scan" : "fixture"}
      data-fit-rms={fitRms === null ? undefined : fitRms.toFixed(2)}
      data-node={run.playerNode}
      data-turn={run.turn}
      data-locked={run.locked.join(" ")}
      data-alarm={run.alarm}
      data-pointer={hud.locked ? "locked" : "free"}
      role="application"
      aria-label="First-person view of the floor. W, A, S and D move, the arrow keys turn, hold E to use, P pauses."
      tabIndex={0}
      className={cn("absolute inset-0 overflow-hidden bg-surface-0 select-none", hud.locked ? "cursor-none" : "cursor-pointer")}
    >
      <canvas ref={canvas} data-testid="fp-canvas" className="absolute inset-0 block h-full w-full" />
      {/* After hours on a scan: its daylight panoramas dimmed and cooled, under the labels. */}
      {live ? <div aria-hidden data-testid="fp-after-hours" className="pointer-events-none absolute inset-0 bg-n-950/45 mix-blend-multiply" /> : null}
      <div ref={labelLayer} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" />
      {live && !ready ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <p data-testid="fp-scan-loading" role="status" className="flex items-center gap-2 rounded-sm bg-surface-1 px-4 py-3 text-sm text-text-2 shadow-e-1">
            <span aria-hidden className="size-2 animate-pulse rounded-full bg-accent" />
            {SCAN_PHASE[scanPhase ?? "manifest"] ?? SCAN_PHASE.manifest}…
          </p>
        </div>
      ) : null}

      {/* The alarm on the edges of the view, in the banner's colours. No transition: the trip shows on the next frame. */}
      {tint ? (
        <div
          aria-hidden
          data-testid="fp-alarm-tint"
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(ellipse at center, transparent 52%, color-mix(in srgb, ${tint} ${run.alarm === "suspicious" ? 22 : 38}%, transparent) 100%)`,
          }}
        />
      ) : null}

      <div className="pointer-events-none absolute inset-0 flex flex-col justify-end px-6 py-3">
        <div className="flex flex-col items-center gap-2">
          {over ? (
            <p data-testid="fp-over" className={cn("rounded-sm bg-surface-1 px-3 py-2 text-base shadow-e-1", run.status === "won" ? "text-success" : "text-danger")}>
              {run.status === "won" ? `Out with the ${noun}.` : `Caught in the ${roomName(placed.level.floor, run.playerNode)}.`}
            </p>
          ) : null}
          {!over && paused ? (
            <p data-testid="fp-paused" className="flex items-center gap-2 rounded-sm bg-surface-1 px-3 py-2 text-sm text-text-1 shadow-e-1">
              Paused. <Key>P</Key> to go on
            </p>
          ) : null}
          {over ? null : hud.prompt ? (
            <p
              data-testid="fp-prompt"
              data-kind={hud.prompt.kind}
              data-using={hud.using ? "true" : undefined}
              className="flex items-center gap-2 rounded-sm bg-surface-1 px-3 py-2 text-sm text-text-1 shadow-e-1"
            >
              {hud.prompt.kind === "far" ? (
                "A locked door. Step up to it and hold E to pick it."
              ) : hud.prompt.kind === "take" ? (
                <>
                  Hold <Key>E</Key> to take the {noun}
                </>
              ) : hud.using ? (
                <>
                  Picking… hold <Key>E</Key>
                  <span className="font-mono text-text-2">
                    {hud.prompt.done} of {hud.prompt.of}
                  </span>
                </>
              ) : hud.prompt.done > 0 ? (
                <>
                  Hold <Key>E</Key> to go on picking. Let go and the lock starts over.
                </>
              ) : (
                <>
                  Hold <Key>E</Key> to pick the lock
                </>
              )}
            </p>
          ) : null}
          <p data-testid="fp-hint" className="flex items-center gap-3 rounded-sm bg-surface-1 px-3 py-1.5 text-sm text-text-2 shadow-e-1">
            {hud.locked ? null : (
              <span data-testid="fp-look-hint" className="text-text-1">
                {hud.refused ? "Hold the mouse button and drag to look" : "Click to look, or hold and drag"}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <Key>W</Key>
              <Key>A</Key>
              <Key>S</Key>
              <Key>D</Key> move
            </span>
            <span className="flex items-center gap-1.5">
              <Key>Shift</Key> walk
            </span>
            {hud.locked ? null : (
              <span className="flex items-center gap-1.5">
                <Key>←</Key>
                <Key>→</Key> turn
              </span>
            )}
            <span className="flex items-center gap-1.5">
              hold <Key>E</Key> use
            </span>
            <span className="flex items-center gap-1.5">
              <Key>P</Key> pause
            </span>
            {hud.locked ? (
              <span className="flex items-center gap-1.5">
                <Key>Esc</Key> free the mouse
              </span>
            ) : null}
          </p>
        </div>
      </div>

      {/* The middle of the view: what E acts on. */}
      <div aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-text-2" />
    </div>
  );
}

function Key({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-sm border border-border bg-surface-2 px-1.5 font-mono text-xs text-text-1">
      {children}
    </kbd>
  );
}
