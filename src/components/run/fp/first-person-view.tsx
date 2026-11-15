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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AmbientLight, DirectionalLight, Fog, PerspectiveCamera, PointLight, Scene, Vector3, WebGLRenderer } from "three";
import type { Action, RunState } from "@/engine";
import type { PlacedLevel } from "@/level/placer";
import { objectiveLabel, objectiveNoun } from "@/lib/objective-noun";
import { cn } from "@/lib/utils";
import { cameraMount, choices, roomName } from "../board";
import type { HeldAction } from "./run-view";
import { Actors, type Marks } from "./actors";
import { aimedAt, whyKeyOf, type DrawnLabel } from "./aim";
import { Minimap, type Pose } from "./minimap";
import { nextWaypoint } from "./waypoint";
import { WhyOverlay } from "./why-overlay";
import { Controller } from "./controller";
import { readPalette } from "./palette";
import { buildFloorGroup, disposeGroup, type RoomTone } from "./scene";
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
  /** The plan briefed on the Plan screen, which the corner map routes by; the level's own without one. */
  crewPlan?: { steps: readonly { zoneId: string; action: string }[] } | null;
  /** What the end of the run offers in the view: the Debrief. */
  endAction?: ReactNode;
}

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
const LABEL_BASE =
  "absolute left-0 top-0 rounded-sm border px-1.5 py-0.5 font-mono text-xs whitespace-nowrap uppercase tracking-[0.06em] will-change-transform data-[aimed=true]:border-text-1 data-[aimed=true]:bg-surface-3 data-[aimed=true]:text-text-1";

/** The labels a click opens the Why card on. */
const WATCHER = new Set<string>(["guard", "cleaner", "camera"]);

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

export default function FirstPersonView({ placed, run, onAct, onUnavailable, onHeld, paused, crewPlan = null, endAction = null }: FirstPersonViewProps) {
  const surface = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const labelLayer = useRef<HTMLDivElement>(null);
  const [hud, setHud] = useState<Hud>({ locked: false, refused: false, prompt: null, using: false });
  const [ready, setReady] = useState(false);

  const world = useMemo(() => buildWorld(placed.level.floor), [placed]);
  const ground = useMemo(() => groundOf(world), [world]);
  // Where the player stands for the corner map, the watcher under the crosshair, and the Why card open on one.
  const pose = useRef<Pose | null>(null);
  const aim = useRef<DrawnLabel | null>(null);
  const [aimed, setAimed] = useState<DrawnLabel | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const closeWhy = useCallback(() => setWhy(null), []);
  const waypoint = useMemo(() => nextWaypoint(placed, run, crewPlan), [placed, run, crewPlan]);
  const mounts = useMemo(
    () =>
      run.board.cameras.map((c) => {
        const m = cameraMount(placed.level.floor, c.parts.flat());
        return { id: c.id, mount: { x: m.x * ground.unitM, y: m.y * ground.unitM } };
      }),
    [run.board, placed, ground],
  );

  // The loop reads the latest run and the latest `play` without being rebuilt for each turn. Updated in a
  // layout effect, before the browser paints, so no animation frame reads the run before last.
  const latest = useRef({ run, onAct, onUnavailable, onHeld });
  useLayoutEffect(() => {
    latest.current = { run, onAct, onUnavailable, onHeld };
  }, [run, onAct, onUnavailable, onHeld]);

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
    const tempo = (id: string) => level.guardTempo?.[id] ?? level.patrolTempo;
    const actors = new Actors(ground, palette, marks, still, FP.turnMs, tempo);
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
    let areas = false;
    // The turn clock asks the view what a turn the player lets run out should be.
    // The Why card (issue 115): F on the watcher under the crosshair, a click on it with the mouse locked,
    // or a click on its label with the mouse free. The card frees the mouse so it can be read and closed.
    const openWhy = (label: Pick<DrawnLabel, "key" | "tone"> | null) => {
      const key = label ? whyKeyOf(label) : null;
      if (!key) return false;
      setWhy(key);
      if (document.pointerLockElement === host) document.exitPointerLock();
      return true;
    };
    const labelOf = (event: Event) => {
      const el = (event.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-label]");
      return el && WATCHER.has(el.dataset.tone ?? "") ? { key: el.dataset.label!, tone: el.dataset.tone! } : null;
    };
    // Kept off the view: a press on a label neither starts a drag nor locks the mouse.
    const onLabelDown = (event: PointerEvent) => {
      if (labelOf(event)) event.stopPropagation();
    };
    const onLabelClick = (event: MouseEvent) => {
      if (openWhy(labelOf(event))) event.stopPropagation();
    };
    const onAimClick = (event: MouseEvent) => {
      if (document.pointerLockElement === host && openWhy(aim.current)) event.stopPropagation();
    };
    const onWhyKey = (event: KeyboardEvent) => {
      if (event.code !== "KeyF" || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
      if ((event.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable=true]")) return;
      if (openWhy(aim.current)) event.preventDefault();
    };
    labels.addEventListener("pointerdown", onLabelDown);
    labels.addEventListener("click", onLabelClick);
    host.addEventListener("click", onAimClick, true);
    window.addEventListener("keydown", onWhyKey);
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
      camera.position.set(walker.pos.x, FP.eyeM + lift, walker.pos.y);
      const flat = Math.cos(controller.pitch);
      camera.lookAt(
        walker.pos.x + Math.cos(controller.yaw) * flat,
        FP.eyeM + lift + Math.sin(controller.pitch),
        walker.pos.y + Math.sin(controller.yaw) * flat,
      );
      actors.update(now);
      renderer.render(scene, camera);
      pose.current = { x: walker.pos.x, y: walker.pos.y, yaw: controller.yaw };
      const drawnLabels: DrawnLabel[] = [];

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
          el.dataset.tone = label.tone;
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
        drawnLabels.push({ key: label.key, tone: label.tone, x, y, inSight });
        // A watcher's label opens its Why card on a click while the mouse is free (issue 115).
        el.style.pointerEvents = WATCHER.has(label.tone) ? "auto" : "none";
        el.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
      }
      const looked = current.status === "playing" ? aimedAt(drawnLabels, w, h) : null;
      if (looked?.key !== aim.current?.key) {
        if (aim.current) labelEls.get(aim.current.key)?.removeAttribute("data-aimed");
        if (looked) labelEls.get(looked.key)?.setAttribute("data-aimed", "true");
        aim.current = looked;
        setAimed(looked);
      }
      for (const [key, el] of labelEls) {
        if (live.has(key)) continue;
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
      target.removeEventListener("webglcontextlost", onLost);
      latest.current.onHeld(null);
      labels.removeEventListener("pointerdown", onLabelDown);
      labels.removeEventListener("click", onLabelClick);
      host.removeEventListener("click", onAimClick, true);
      window.removeEventListener("keydown", onWhyKey);
      controller.dispose();
      for (const el of labelEls.values()) el.remove();
      actors.dispose();
      disposeGroup(floorGroup);
      renderer.dispose();
    };
  }, [world, ground, placed]);

  const noun = objectiveNoun(placed.level.missionId);
  const over = run.status !== "playing";
  // The run's end frees the mouse, so the Debrief is a click away.
  useEffect(() => {
    if (over && surface.current && document.pointerLockElement === surface.current) document.exitPointerLock();
  }, [over]);
  const tint = run.alarm === "calm" ? null : run.alarm === "suspicious" ? "var(--warning)" : "var(--danger)";

  return (
    <div
      ref={surface}
      data-testid="fp-view"
      data-ready={ready ? "true" : undefined}
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

      <div className="pointer-events-none absolute inset-0 flex flex-col justify-end px-6 py-3">
        <div className="flex flex-col items-center gap-2">
          {over ? (
            <div data-testid="fp-end" data-status={run.status} className="pointer-events-auto flex items-center gap-3">
              <p data-testid="fp-over" className={cn("rounded-sm bg-surface-1 px-3 py-2 text-base shadow-e-1", run.status === "won" ? "text-success" : "text-danger")}>
                {run.status === "won" ? `Out with the ${noun}.` : `Caught in the ${roomName(placed.level.floor, run.playerNode)}.`}
              </p>
              {endAction}
            </div>
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

      {/* Issue 115: the corner map, what F explains, and the Why card it opens. */}
      <Minimap world={world} ground={ground} run={run} cameras={mounts} waypoint={waypoint} pose={pose} className="absolute top-3 left-3" />
      {aimed && !why && !over ? (
        <p
          data-testid="fp-aim"
          data-why={whyKeyOf(aimed) ?? undefined}
          className="pointer-events-none absolute top-1/2 left-1/2 ml-8 flex -translate-y-1/2 items-center gap-2 rounded-sm bg-surface-1 px-2 py-1 text-sm text-text-1 shadow-e-1"
        >
          <Key>F</Key> Why {aimed.tone === "camera" ? "this camera" : aimed.tone === "cleaner" ? "this cleaner" : "this guard"}
        </p>
      ) : null}
      {why ? <WhyOverlay placed={placed} run={run} whyKey={why} onClose={closeWhy} /> : null}
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
