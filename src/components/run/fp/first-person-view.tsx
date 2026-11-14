"use client";

// The Run screen in first person (issue 115), on a fixture floor: the room
// the player is standing in, drawn by our own renderer, walked freely with
// the keys and the mouse. The engine is untouched and still decides
// everything: this view hands its actions to `onAct`, which is the Run
// screen's own `play`, and draws whatever run state comes back.
//
// Four parts, each replaceable (issue 118 swaps the floor for a scan's mesh):
//   controller.ts  keys and mouse → what the player asks for
//   walker.ts      free position → engine actions, over a `Ground`
//   scene.ts       the floor's static geometry, one three.js group
//   actors.ts      guards, cameras, sight, doors and markers, over a `Ground`
import { useEffect, useMemo, useRef, useState } from "react";
import { AmbientLight, DirectionalLight, Fog, PerspectiveCamera, PointLight, Scene, Vector3, WebGLRenderer } from "three";
import type { Action, RunState } from "@/engine";
import type { PlacedLevel } from "@/level/placer";
import { objectiveLabel, objectiveNoun } from "@/lib/objective-noun";
import { cn } from "@/lib/utils";
import { ALARM_STYLE } from "../alarm-banner";
import { cameraMount, choices, roomName } from "../board";
import { Actors, type Marks } from "./actors";
import { Controller } from "./controller";
import { readPalette } from "./palette";
import { buildFloorGroup, disposeGroup, type RoomTone } from "./scene";
import { FP } from "./tuning";
import { createWalker, nodeUnderfoot, promptFor, stepWalker, type Prompt } from "./walker";
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
}

interface Hud {
  locked: boolean;
  prompt: Prompt;
  /** The room the engine has the player in, when the body has walked on to a node it cannot move to. */
  astray: string | null;
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

export default function FirstPersonView({ placed, run, objective, onAct, onUnavailable }: FirstPersonViewProps) {
  const surface = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const labelLayer = useRef<HTMLDivElement>(null);
  const [hud, setHud] = useState<Hud>({ locked: false, prompt: null, astray: null });
  const [ready, setReady] = useState(false);

  const world = useMemo(() => buildWorld(placed.level.floor), [placed]);
  const ground = useMemo(() => groundOf(world), [world]);

  // The loop reads the latest run and the latest `play` without being rebuilt for each turn.
  const latest = useRef({ run, onAct, onUnavailable });
  useEffect(() => {
    latest.current = { run, onAct, onUnavailable };
  }, [run, onAct, onUnavailable]);

  useEffect(() => {
    const host = surface.current;
    const target = canvas.current;
    const labels = labelLayer.current;
    if (!host || !target || !labels) return;
    if (!hasWebGL()) {
      latest.current.onUnavailable();
      return;
    }
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas: target, antialias: true, powerPreference: "high-performance" });
    } catch {
      latest.current.onUnavailable();
      return;
    }
    const onLost = (event: Event) => {
      event.preventDefault();
      latest.current.onUnavailable();
    };
    target.addEventListener("webglcontextlost", onLost);

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const palette = readPalette(document.documentElement);
    const { level } = placed;
    const first = latest.current.run;

    const scene = new Scene();
    scene.background = palette.n950;
    scene.fog = new Fog(palette.n950, 4, 36);
    const camera = new PerspectiveCamera(72, 1, 0.05, 80);
    // An even night light, a slanted one so walls that meet at a corner differ in shade, and a
    // little carried by the player so what is near reads before what is far.
    scene.add(new AmbientLight(palette.n100, 2));
    const slant = new DirectionalLight(palette.n100, 1.5);
    slant.position.set(-0.55, 1, -0.3);
    scene.add(slant);
    // A slow falloff: a wall the player is pressed against must not burn out.
    const torch = new PointLight(palette.n100, 0.9, 14, 0.6);
    camera.add(torch);
    scene.add(camera);

    const tone = (roomId: string): RoomTone => {
      const zone = placed.zones.find((z) => z.roomIds.includes(roomId));
      return zone?.role === "crowded" ? "lit" : zone?.role === "quiet" ? "dark" : "plain";
    };
    const floorGroup = buildFloorGroup(world, palette, tone);
    scene.add(floorGroup);

    const metres = (p: { x: number; y: number }) => ({ x: p.x * ground.unitM, y: p.y * ground.unitM });
    const marks: Marks = {
      objective: { nodeId: level.objective, label: objectiveLabel(level.missionId) },
      exits: level.exits.map((nodeId) => ({
        nodeId,
        label: `Exit · ${placed.entries.find((e) => e.nodeId === nodeId)?.label ?? roomName(level.floor, nodeId)}`,
      })),
      cameras: first.board.cameras.map((c) => {
        const cover = c.parts.flat();
        const seen = cover.map((id) => first.board.nodes.get(id)!);
        const middle = { x: seen.reduce((s, n) => s + n.x, 0) / seen.length, y: seen.reduce((s, n) => s + n.y, 0) / seen.length };
        return { id: c.id, mount: metres(cameraMount(level.floor, cover)), looksAt: metres(middle) };
      }),
    };
    const actors = new Actors(ground, palette, marks, still);
    scene.add(actors.group);

    // Facing the first way on from where the engine has the player.
    let walker = createWalker(ground, first);
    const wayOn = (state: RunState, from: { x: number; y: number }): number | null => {
      const ahead = choices(state)[0];
      const towards = ahead ? ground.path(state.playerNode, ahead.nodeId)[1] : null;
      return towards ? Math.atan2(towards.y - from.y, towards.x - from.x) : null;
    };
    const controller = new Controller(host, wayOn(first, walker.pos) ?? 0, (locked) =>
      setHud((h) => (h.locked === locked ? h : { ...h, locked })),
    );

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host;
      if (w === 0 || h === 0) return;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
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
      use ||= controls.interact;
      owed += dt;
      const stood = walker.pos;
      while (owed >= FP.stepS) {
        owed -= FP.stepS;
        const out = stepWalker(walker, ground, current, { ...controls, interact: use });
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
      if (controller.takeWait() && current.status === "playing" && !walker.pending) {
        walker = { ...walker, pending: { to: null, age: 0 } };
        act({ kind: "wait" });
      }

      // The view: at eye height, with a small bob tied to the ground covered.
      const speed = Math.hypot(walker.vel.x, walker.vel.y);
      bob += ((still ? 0 : Math.min(1, speed / FP.runMps)) - bob) * Math.min(1, dt * 12);
      const lift = Math.sin((walker.walked / FP.strideM) * Math.PI * 4) * FP.bobM * bob;
      camera.position.set(walker.pos.x, FP.eyeM + lift, walker.pos.y);
      const flat = Math.cos(controller.pitch);
      camera.lookAt(
        walker.pos.x + Math.cos(controller.yaw) * flat,
        FP.eyeM + lift + Math.sin(controller.pitch),
        walker.pos.y + Math.sin(controller.yaw) * flat,
      );
      actors.update(now);
      renderer.render(scene, camera);

      // Labels: each at its piece, hidden behind the view and behind walls (a beacon shows through).
      // Nearest first, and one that would cover another is drawn above it.
      const w = host.clientWidth;
      const h = host.clientHeight;
      const live = new Set<string>();
      const taken: { x: number; y: number; half: number }[] = [];
      const far = (at: { x: number; y: number }) => Math.hypot(at.x - walker.pos.x, at.y - walker.pos.y);
      for (const label of actors.labels(current).sort((p, q) => far(p.at) - far(q.at))) {
        point.set(label.x, label.y, label.z).project(camera);
        const away = far(label.at);
        const inSight = ground.clear(walker.pos, label.at, current.locked);
        if (point.z > 1 || point.z < -1 || (!label.beacon && (!inSight || away > 30))) continue;
        live.add(label.key);
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
        if (live.has(key)) continue;
        el.remove();
        labelEls.delete(key);
      }

      // The HUD's words change rarely: React hears of it only when they do.
      const prompt = promptFor(walker, ground, current, controller.yaw);
      const under = current.status === "playing" ? nodeUnderfoot(ground, current, walker.pos) : null;
      const lost = under !== null && under !== current.playerNode && !walker.pending && !choices(current).some((c) => c.nodeId === under);
      const astray = lost ? roomName(level.floor, current.playerNode) : null;
      const key = JSON.stringify([prompt, astray]);
      if (key !== hudKey) {
        hudKey = key;
        setHud((was) => ({ ...was, prompt, astray }));
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
      target.removeEventListener("webglcontextlost", onLost);
      controller.dispose();
      for (const el of labelEls.values()) el.remove();
      actors.dispose();
      disposeGroup(floorGroup);
      renderer.dispose();
    };
  }, [world, ground, placed]);

  const alarm = ALARM_STYLE[run.alarm];
  const noun = objectiveNoun(placed.level.missionId);
  const over = run.status !== "playing";
  const tint = run.alarm === "calm" ? null : run.alarm === "suspicious" ? "var(--warning)" : "var(--danger)";

  return (
    <div
      ref={surface}
      data-testid="fp-view"
      data-ready={ready ? "true" : undefined}
      data-node={run.playerNode}
      data-turn={run.turn}
      data-alarm={run.alarm}
      data-pointer={hud.locked ? "locked" : "free"}
      role="application"
      aria-label="First-person view of the floor. W, A, S and D move, the arrow keys turn, E uses, F waits."
      tabIndex={0}
      className={cn("absolute inset-0 overflow-hidden bg-surface-0 select-none", hud.locked ? "cursor-none" : "cursor-pointer")}
    >
      <canvas ref={canvas} data-testid="fp-canvas" className="absolute inset-0 block h-full w-full" />
      <div ref={labelLayer} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" />

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

      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between px-6 py-3">
        <div className="flex flex-col items-start gap-2">
          <div data-testid="fp-alarm" data-state={run.alarm} className={cn("rounded-sm border-l-2 bg-surface-1 px-3 py-2 shadow-e-1", alarm.bar)}>
            <p className="label-caps text-text-3">
              Alarm · turn <span className="font-mono text-text-1">{run.turn}</span>
            </p>
            <p className={cn("text-lg font-semibold", alarm.text)}>{alarm.label}</p>
          </div>
          <div className="max-w-md min-w-0 rounded-sm bg-surface-1 px-3 py-2 shadow-e-1">
            <p className="label-caps text-text-3">Objective</p>
            <p data-testid="fp-objective" className="truncate text-sm text-text-1">
              {run.carrying ? `You have the ${noun}. Get to an exit.` : objective}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-center gap-2">
          {over ? (
            <p data-testid="fp-over" className={cn("rounded-sm bg-surface-1 px-3 py-2 text-base shadow-e-1", run.status === "won" ? "text-success" : "text-danger")}>
              {run.status === "won" ? `Out with the ${noun}.` : `Caught in the ${roomName(placed.level.floor, run.playerNode)}.`}
            </p>
          ) : hud.prompt ? (
            <p data-testid="fp-prompt" data-kind={hud.prompt.kind} className="flex items-center gap-2 rounded-sm bg-surface-1 px-3 py-2 text-sm text-text-1 shadow-e-1">
              {hud.prompt.kind === "locked" ? (
                "Locked. Pick it from the ring beside this door."
              ) : (
                <>
                  <Key>E</Key>
                  {hud.prompt.kind === "take" ? `Take the ${noun}` : `Pick the lock, ${hud.prompt.done} of ${hud.prompt.of}. Leaning on the door picks it too.`}
                </>
              )}
            </p>
          ) : hud.astray ? (
            <p data-testid="fp-astray" className="rounded-sm bg-surface-1 px-3 py-2 text-sm text-text-2 shadow-e-1">
              The run still has you in the {hud.astray}. Walk to a lit ring to move on.
            </p>
          ) : null}
          <p data-testid="fp-hint" className="flex items-center gap-3 rounded-sm bg-surface-1 px-3 py-1.5 text-sm text-text-2 shadow-e-1">
            {hud.locked ? (
              <>
                <span className="flex items-center gap-1.5">
                  <Key>W</Key>
                  <Key>A</Key>
                  <Key>S</Key>
                  <Key>D</Key> move
                </span>
                <span className="flex items-center gap-1.5">
                  <Key>Shift</Key> walk
                </span>
                <span className="flex items-center gap-1.5">
                  <Key>E</Key> use
                </span>
                <span className="flex items-center gap-1.5">
                  <Key>F</Key> wait
                </span>
                <span className="flex items-center gap-1.5">
                  <Key>Esc</Key> free the mouse
                </span>
              </>
            ) : (
              <>
                <span className="text-text-1">Click to look</span>
                <span className="flex items-center gap-1.5">
                  <Key>W</Key>
                  <Key>A</Key>
                  <Key>S</Key>
                  <Key>D</Key> move
                </span>
                <span className="flex items-center gap-1.5">
                  <Key>←</Key>
                  <Key>→</Key> turn
                </span>
                <span className="flex items-center gap-1.5">
                  <Key>E</Key> use
                </span>
                <span className="flex items-center gap-1.5">
                  <Key>F</Key> wait
                </span>
              </>
            )}
          </p>
        </div>
      </div>

      {/* The middle of the view: what E and a lean act on. */}
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
