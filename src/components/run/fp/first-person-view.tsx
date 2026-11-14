"use client";

// The Run screen in first person (issue 115): the room the player is standing
// in, drawn by our own renderer, walked freely with the keys and the mouse.
// The engine is untouched and still decides everything: this view hands its
// actions to `onAct`, which is the Run screen's own `play`, and draws whatever
// run state comes back.
//
// Two stages, one game (issue 118). On a fixture floor the stage is ours: the
// walls of world.ts, drawn by scene.ts. On a floor from a live scan it is the
// scan itself, drawn by the free-walk renderer (spike/mesh/engine.ts) from the
// scan's mesh and panoramas, and walked over the mesh (scan-ground.ts). On
// either, the same parts play:
//   controller.ts  keys and mouse → what the player asks for
//   walker.ts      free position → engine actions, over a `Ground`
//   actors.ts      guards, cameras, sight, doors and markers, over a `Ground`
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AmbientLight,
  DirectionalLight,
  Fog,
  Group,
  PerspectiveCamera,
  PointLight,
  Scene,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from "three";
import type { ScanWalk } from "@/app/spike/mesh/engine";
import { act, type Action, type RunState } from "@/engine";
import type { PlacedLevel } from "@/level/placer";
import { objectiveLabel, objectiveNoun } from "@/lib/objective-noun";
import { cn } from "@/lib/utils";
import { ALARM_STYLE } from "../alarm-banner";
import { cameraMount, choices, roomName } from "../board";
import { Actors, type Marks } from "./actors";
import { Controller } from "./controller";
import type { Ground } from "./ground";
import { readPalette } from "./palette";
import { joinRefusal, joinScan } from "./scan-join";
import { scanGround, type ScanGround } from "./scan-ground";
import { meshSolid } from "./scan-solid";
import { buildFloorGroup, disposeGroup, type RoomTone } from "./scene";
import { FP } from "./tuning";
import { createWalker, nodeUnderfoot, promptFor, stepWalker, type Prompt, type Walker } from "./walker";
import { buildWorld, groundOf, type World } from "./world";

export interface FirstPersonViewProps {
  placed: PlacedLevel;
  run: RunState;
  /** The mission's objective, as the panel words it. */
  objective: string;
  /** Plays an engine action: the Run screen's own `play`. */
  onAct: (action: Action) => void;
  /**
   * First person can't be drawn here (no WebGL, a lost context, a scan whose
   * mesh won't load): the Run screen goes back to the board, saying `why`.
   */
  onUnavailable: (why?: string) => void;
  /** On a floor from a live scan: the scan's model id, whose mesh and panoramas are the stage. Held in memory only. */
  scanModelId?: string | null;
}

interface Hud {
  locked: boolean;
  /** The browser refused to lock the mouse: the hint says to drag instead. */
  refused: boolean;
  prompt: Prompt;
  /** The room the engine has the player in, when the body has walked on to a node it cannot move to. */
  astray: string | null;
}

/** What a scan's stage says while it loads: null once the building is in. */
type ScanLoad = { line: string; held: number; total: number } | null;

/** The free-walk renderer's loading phases, as the player is told them. */
const SCAN_PHASE: Record<string, string> = {
  manifest: "Asking for the scan",
  mesh: "Downloading the building",
  building: "Building the walkable floor",
};

/** What the view does each frame on either stage: walk, then draw the labels and the HUD over the picture. */
interface Session {
  walker: () => Walker;
  controller: Controller;
  /** Moves the walker on by `dt` and plays what it hands back. */
  advance(now: number, dt: number): void;
  /** After a frame is drawn from `camera`: the labels and the HUD's words. */
  overlay(camera: PerspectiveCamera): void;
  dispose(): void;
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

export default function FirstPersonView({ placed, run, objective, onAct, onUnavailable, scanModelId }: FirstPersonViewProps) {
  const surface = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const labelLayer = useRef<HTMLDivElement>(null);
  const [hud, setHud] = useState<Hud>({ locked: false, refused: false, prompt: null, astray: null });
  const [ready, setReady] = useState(false);
  const [scanLoad, setScanLoad] = useState<ScanLoad>(null);

  const onScan = placed.level.floor.source !== "fixture";
  const world = useMemo(() => (onScan ? null : buildWorld(placed.level.floor)), [placed, onScan]);

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
    let gone = false;
    const unavailable = (why?: string) => {
      if (gone) return;
      gone = true;
      latest.current.onUnavailable(why);
    };
    if (!hasWebGL()) {
      unavailable();
      return;
    }
    const onLost = (event: Event) => {
      event.preventDefault();
      unavailable();
    };
    target.addEventListener("webglcontextlost", onLost);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const palette = readPalette(document.documentElement);

    /** The walker, the controller, the actors and the labels, standing on `ground`, with `add` putting the actors in the scene. */
    const startSession = (ground: Ground, add: (object: Object3D) => void, options: { liftY: number; canWalk: () => boolean }): Session => {
      const { level } = placed;
      const first = latest.current.run;
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
      add(actors.group);

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

      // For poking at from the console in development (a scripted walk): never in a production build.
      const debug = process.env.NODE_ENV !== "production" ? (window as unknown as { __fp?: unknown }) : null;
      if (debug) debug.__fp = { walker: () => walker, controller, ground, run: () => latest.current.run, act, choices };

      const labelEls = new Map<string, HTMLSpanElement>();
      const point = new Vector3();
      let seen: RunState | null = null;
      let owed = 0;
      let use = false;
      let hudKey = "";
      let drawn = false;

      return {
        walker: () => walker,
        controller,
        advance(now, dt) {
          const { run: current, onAct: act } = latest.current;
          if (current !== seen) {
            actors.sync(current, now);
            seen = current;
          }

          // The movement runs at a fixed step, however fast the screen draws.
          controller.frame(dt);
          const asked = controller.controls();
          // A scan holds the feet until the picture around the start is in; looking and E still work.
          const controls = options.canWalk() ? asked : { ...asked, forward: 0, strafe: 0 };
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
          actors.update(now);
        },
        overlay(camera) {
          const current = latest.current.run;
          // Labels: each at its piece, hidden behind the view and behind walls (a beacon shows through).
          // Nearest first, and one that would cover another is drawn above it.
          const w = host.clientWidth;
          const h = host.clientHeight;
          const live = new Set<string>();
          const taken: { x: number; y: number; half: number }[] = [];
          const far = (at: { x: number; y: number }) => Math.hypot(at.x - walker.pos.x, at.y - walker.pos.y);
          for (const label of actors.labels(current).sort((p, q) => far(p.at) - far(q.at))) {
            point.set(label.x, label.y + options.liftY, label.z).project(camera);
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
        },
        dispose() {
          if (debug) delete debug.__fp;
          controller.dispose();
          for (const el of labelEls.values()) el.remove();
          actors.dispose();
        },
      };
    };

    /** A fixture floor: our own scene of world.ts's walls, drawn by our own loop. */
    const fixtureStage = (floorWorld: World): (() => void) => {
      let renderer: WebGLRenderer;
      try {
        renderer = new WebGLRenderer({ canvas: target, antialias: true, powerPreference: "high-performance" });
      } catch {
        unavailable();
        return () => {};
      }
      const ground = groundOf(floorWorld);
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
      const floorGroup = buildFloorGroup(floorWorld, palette, tone);
      scene.add(floorGroup);
      const session = startSession(ground, (object) => scene.add(object), { liftY: 0, canWalk: () => true });

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

      let last = performance.now();
      let bob = 0;
      let raf = 0;
      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
        last = now;
        session.advance(now, dt);
        const walker = session.walker();
        const { controller } = session;

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
        renderer.render(scene, camera);
        session.overlay(camera);
      };
      raf = requestAnimationFrame(frame);

      return () => {
        cancelAnimationFrame(raf);
        observer?.disconnect();
        session.dispose();
        disposeGroup(floorGroup);
        renderer.dispose();
      };
    };

    /**
     * A live scan: the free-walk renderer draws the scan's mesh and panoramas,
     * walked by this view (its `drive` hook), with the actors in its scene. The
     * renderer fetches the scan's assets into this tab's memory only.
     */
    const scanStage = (modelId: string): (() => void) => {
      let stopped = false;
      let engine: ScanWalk | null = null;
      let session: Session | null = null;
      let ground: ScanGround | null = null;
      let canWalk = false;
      let feet: number | null = null;
      let loadKey = "";
      const pieces = new Group();
      pieces.name = "run-pieces";
      // The scan's picture needs no light; the guards, cameras and doors do.
      pieces.add(new AmbientLight(palette.n100, 2));
      const slant = new DirectionalLight(palette.n100, 1.5);
      slant.position.set(-0.55, 1, -0.3);
      pieces.add(slant);

      const begin = (on: ScanWalk) => {
        const walkable = on.walkable;
        if (session || !walkable) return;
        const join = joinScan(placed.level.floor, on.scanPanos());
        // Counts only: no id or position of the scan is logged.
        console.info(
          `First person on the scan: ${join.matched} of ${join.total} board positions are panoramas, at most ${join.worstM.toFixed(3)} m apart`,
        );
        const refusal = joinRefusal(join);
        if (refusal) {
          unavailable(refusal);
          return;
        }
        ground = scanGround(placed.level.floor, meshSolid(walkable), join.heights);
        // Just off the scan's floor, so the discs and rings are not lost in its lumps.
        pieces.position.y = ground.floorY + 0.07;
        session = startSession(ground, (object) => pieces.add(object), { liftY: pieces.position.y, canWalk: () => canWalk });
        on.addToScene(pieces);
      };

      import("@/app/spike/mesh/engine")
        .then(({ ScanWalk: Walk }) => {
          if (stopped) return;
          const made: ScanWalk = new Walk(target, {
            modelId,
            faces: "2k",
            mesh: "50k",
            detail: true,
            reducedMotion: still,
            debug: false,
            onHud(hud) {
              if (hud.phase === "error" || hud.phase === "no-mesh") {
                unavailable(`${hud.message ?? "The scan didn't load."} You're on the board.`);
                return;
              }
              if (hud.phase === "ready") begin(made);
              canWalk = hud.canMove;
              const { held, total } = hud.building;
              const next: ScanLoad =
                hud.phase !== "ready"
                  ? { line: SCAN_PHASE[hud.phase] ?? "Loading the building", held: 0, total: 0 }
                  : !hud.canMove
                    ? { line: "Loading the building around you", held, total }
                    : null;
              const key = JSON.stringify(next);
              if (key !== loadKey) {
                loadKey = key;
                setScanLoad(next);
              }
            },
            drive(dt) {
              if (!session || !ground) return null;
              session.advance(performance.now(), dt);
              const walker = session.walker();
              // The feet settle on the floor's height, as the sandbox's do; a jump (a restart) lands at once.
              const floor = ground.feetAt(walker.pos);
              feet = feet === null || Math.abs(floor - feet) > 0.5 ? floor : feet + (floor - feet) * (1 - Math.exp(-14 * dt));
              const { controller } = session;
              return {
                x: walker.pos.x,
                feetY: feet,
                z: walker.pos.y,
                vx: walker.vel.x,
                vz: walker.vel.y,
                walked: walker.walked,
                // The renderer's yaw is zero down -z and grows to the left; this view's is zero east (+x) and grows to the right.
                yaw: -controller.yaw - Math.PI / 2,
                pitch: controller.pitch,
              };
            },
            onFrame(camera) {
              session?.overlay(camera);
            },
          });
          engine = made;
        })
        .catch(() => unavailable("This browser couldn't start the scan's 3D view. You're on the board."));

      const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => engine?.resize());
      observer?.observe(host);
      return () => {
        stopped = true;
        observer?.disconnect();
        session?.dispose();
        engine?.dispose();
      };
    };

    const stop = world
      ? fixtureStage(world)
      : scanModelId
        ? scanStage(scanModelId)
        : (unavailable("This scan has no mesh to walk, so first person isn't offered on it. You're on the board."), () => {});
    return () => {
      gone = true;
      target.removeEventListener("webglcontextlost", onLost);
      stop();
    };
  }, [world, placed, scanModelId]);

  const alarm = ALARM_STYLE[run.alarm];
  const noun = objectiveNoun(placed.level.missionId);
  const over = run.status !== "playing";
  const tint = run.alarm === "calm" ? null : run.alarm === "suspicious" ? "var(--warning)" : "var(--danger)";

  return (
    <div
      ref={surface}
      data-testid="fp-view"
      data-stage={onScan ? "scan" : "fixture"}
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
          {onScan ? (
            <p data-testid="fp-fiction" className="rounded-sm bg-surface-1 px-3 py-1.5 text-xs text-text-2 shadow-e-1">
              The building is the real scan. Security shown is game fiction.
            </p>
          ) : null}
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
                <span data-testid="fp-look-hint" className="text-text-1">
                  {hud.refused ? "Hold the mouse button and drag to look" : "Click to look, or hold and drag"}
                </span>
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

      {scanLoad ? (
        <div data-testid="fp-scan-loading" role="status" className="pointer-events-none absolute inset-0 grid place-items-center">
          <p className="rounded-sm bg-surface-1 px-4 py-3 text-sm text-text-1 shadow-e-1">
            {scanLoad.line}
            {scanLoad.total > 0 ? (
              <>
                : <span className="font-mono tabular-nums">{scanLoad.held}</span> of <span className="font-mono tabular-nums">{scanLoad.total}</span>
              </>
            ) : (
              "…"
            )}
          </p>
        </div>
      ) : null}

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
