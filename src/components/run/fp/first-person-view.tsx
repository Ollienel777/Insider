"use client";

// The Run screen in first person (issue 115): the room the player is standing
// in, walked freely with the keys and the mouse. The engine is untouched and
// still decides everything: this view hands its actions to `onAct`, which is
// the Run screen's own `play`, and draws whatever run state comes back.
//
// Two stages, one game (issue 118). On a fixture floor the stage is ours: the
// walls of world.ts, drawn by scene.ts. On a floor from a live scan it is the
// scan itself, drawn by its own renderer (spike/mesh/scan-view.ts) from its
// mesh and panoramas, and walked over the mesh (scan-ground.ts). On either,
// the same parts play:
//   controller.ts  keys and mouse → what the player asks for
//   walker.ts      free position → engine actions, over a `Ground`
//   actors.ts      guards, cameras, sight, doors and markers, over a `Ground`
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  type Camera,
  type Object3D,
} from "three";
import { act, type Action, type RunState } from "@/engine";
import type { PlacedLevel } from "@/level/placer";
import { objectiveLabel, objectiveNoun } from "@/lib/objective-noun";
import { cn } from "@/lib/utils";
import { cameraMount, choices, roomName } from "../board";
import { scanStageOf, type HeldAction, type ScanHandle, type ScanPreload } from "./run-view";
import { Actors, type Marks } from "./actors";
import { Controller } from "./controller";
import { endState } from "./end-state";
import type { Ground, Vec } from "./ground";
import { hintDone, hintPhase, hintTicks, NO_PROGRESS, type HintPhase, type HintProgress } from "./hint";
import { ControlsHint } from "./hint-card";
import { noticeOf } from "./notice";
import { readPalette } from "./palette";
import { joinRefusal, joinScan } from "./scan-join";
import { nodeFloors, scanGround } from "./scan-ground";
import { derivePlan, PLAN, planSolid } from "./scan-plan";
import { buildPlanGroup } from "./scan-plan-scene";
import { meshSolid } from "./scan-solid";
import { buildFloorGroup, disposeGroup, type RoomTone } from "./scene";
import { SuspicionMeter } from "./suspicion-meter";
import { FP } from "./tuning";
import { createWalker, heldAction, promptFor, stepWalker, type Prompt } from "./walker";
import { buildWorld, groundOf, type World } from "./world";
import { useMoment } from "../moment";

export interface FirstPersonViewProps {
  placed: PlacedLevel;
  run: RunState;
  /** The mission's objective, as the panel words it. */
  objective: string;
  /** Plays an engine action: the Run screen's own `play`. */
  onAct: (action: Action) => void;
  /**
   * First person can't be drawn here (no WebGL, a lost context, a scan whose
   * board doesn't stand on its mesh): the Run screen goes back to the board,
   * saying `why`.
   */
  onUnavailable: (why?: string) => void;
  /** Hands the turn clock what to play when a turn runs out: the next pick while E is held, or a wait. */
  onHeld: (held: HeldAction | null) => void;
  /** The player paused the clock with P. */
  paused: boolean;
  /** On a floor from a live scan: the scan's preload, started when the Run screen opened (scan-preload.ts). */
  scan?: ScanPreload | null;
  /** The player is let loose (true), or the view is gone (false): on a scan the Run screen holds the clock until then. */
  onReady?: (ready: boolean) => void;
  /** Shift went down or up: the HUD's time left is then at a walk or a run. */
  onWalking?: (walking: boolean) => void;
  /** What the end of the run offers next to its outcome (the Run screen's "See the debrief"). */
  endAction?: ReactNode;
}

/** What a scan's stage says while it loads: null once the player is let loose. */
type ScanLoad = { line: string; held: number; total: number } | null;

/** The scan renderer's loading phases, as the player is told them. */
const SCAN_PHASE: Record<string, string> = {
  manifest: "Asking for the scan",
  mesh: "Downloading the building",
  building: "Building the walls and floor",
};

/** The longest the player waits for a scan's picture around them before being let loose on what has arrived, ms. */
const SCAN_WAIT_MS = 12_000;

/** What the view stands on and draws with: our own walls, or a scan. */
interface Stage {
  ground: Ground & { feetAt?: (p: Vec) => number };
  /** The height the run's pieces stand at, in the drawing's frame. */
  liftY: number;
  /**
   * Where a camera covering `cover` hangs, in metres, when the floor plan's
   * own mount (a room rectangle's wall) is no place for it. A scan's rooms
   * are boxes round its sweeps, so there a camera hangs at the start of its
   * run, looking along it.
   */
  cameraMount?: (cover: readonly string[]) => Vec;
  /** Puts the run's pieces (actors.ts) in the drawing. */
  add(object: Object3D): void;
  /** Whether the picture around `pos` has arrived: until it has, the view draws but the player waits. */
  settled(pos: Vec): boolean;
  /** How much of the building's picture is in, for the loading line; null when there is nothing to load. */
  counts(): { held: number; total: number } | null;
  resize(): void;
  /** Draws the frame from the walker's place, the bob's lift, and where the player looks; returns the camera it drew from. */
  draw(walker: { pos: Vec; vel: Vec }, lift: number, yaw: number, pitch: number, dt: number): Camera;
  dispose(): void;
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
const LABEL_BASE = "absolute left-0 top-0 rounded-sm border px-1.5 py-0.5 font-mono text-xs whitespace-nowrap uppercase tracking-[0.06em] will-change-transform";

/** A label's height and the gap under it, in pixels: how far one is lifted clear of another. */
const LABEL_PITCH = 26;

/**
 * How a live scan is drawn in first person: as one of our floors, its plan
 * worked out from its mesh (the default), or its own photographed picture,
 * kept to compare (`?scanlook=photo`).
 */
function scanLook(): "plan" | "photo" {
  try {
    return new URLSearchParams(window.location.search).get("scanlook") === "photo" ? "photo" : "plan";
  } catch {
    return "plan";
  }
}

/** Whether this browser will give a canvas a WebGL 2 context, asked of a spare canvas. */
function hasWebGL(): boolean {
  try {
    return document.createElement("canvas").getContext("webgl2") !== null;
  } catch {
    return false;
  }
}

export default function FirstPersonView({ placed, run, onAct, onUnavailable, onHeld, paused, scan = null, onReady, onWalking, endAction = null }: FirstPersonViewProps) {
  const surface = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const labelLayer = useRef<HTMLDivElement>(null);
  const [hud, setHud] = useState<Hud>({ locked: false, refused: false, prompt: null, using: false });
  const [ready, setReady] = useState(false);
  const [scanLoad, setScanLoad] = useState<ScanLoad>(null);
  // The first-time controls hint, and being noticed: read from the run as it renders, so never a frame behind it (issue 146).
  const [hint, setHint] = useState<{ phase: HintPhase; progress: HintProgress }>({ phase: "shown", progress: NO_PROGRESS });
  const notice = useMemo(() => noticeOf(run), [run]);

  const onScan = placed.level.floor.source !== "fixture";
  const world = useMemo(() => (onScan ? null : buildWorld(placed.level.floor)), [placed, onScan]);
  // The preload's parts the view acts on: its object changes when it turns ready, which must not rebuild the stage.
  const scanGiven = scan !== null;
  const scanHandle = scan?.handle ?? null;
  const scanFailed = scan?.failed ?? null;

  // The loop reads the latest run and the latest `play` without being rebuilt for each turn. Updated in a
  // layout effect, before the browser paints, so no animation frame reads the run before last.
  const latest = useRef({ run, onAct, onUnavailable, onHeld, onReady, onWalking });
  useLayoutEffect(() => {
    latest.current = { run, onAct, onUnavailable, onHeld, onReady, onWalking };
  }, [run, onAct, onUnavailable, onHeld, onReady, onWalking]);

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
    const onLost = (event: Event) => {
      event.preventDefault();
      unavailable();
    };
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const palette = readPalette(document.documentElement);
    let stage: Stage | null = null;
    let stopSession: (() => void) | null = null;
    let loadKey = "";
    const loading = (next: ScanLoad) => {
      const key = JSON.stringify(next);
      if (key === loadKey) return;
      loadKey = key;
      setScanLoad(next);
    };

    /** The walker, the controller, the actors and the labels on `on`, and the frame loop that draws it. */
    const runSession = (on: Stage): (() => void) => {
      const { ground } = on;
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
          return { id: c.id, mount: on.cameraMount?.(cover) ?? metres(cameraMount(level.floor, cover)), looksAt: metres(middle) };
        }),
      };
      const tempo = (id: string) => level.guardTempo?.[id] ?? level.patrolTempo;
      const actors = new Actors(ground, palette, marks, still, FP.turnMs, tempo);
      on.add(actors.group);

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

      on.resize();
      const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => on.resize());
      observer?.observe(host);

      const labelEls = new Map<string, HTMLSpanElement>();
      const point = new Vector3();
      let seen: RunState | null = null;
      // What the player has tried, for the hint; when it was done, for its fade.
      const progress: HintProgress = { ...NO_PROGRESS };
      let doneAt: number | null = null;
      let hintKey = "";
      let looked = { yaw: controller.yaw, pitch: controller.pitch };
      let last = performance.now();
      let owed = 0;
      let use = false;
      let bob = 0;
      let hudKey = "";
      let areas = false;
      // Each mount starts at a run, whatever the Run screen last heard.
      let walking = false;
      latest.current.onWalking?.(false);
      // The turn clock asks the view what a turn the player lets run out should be.
      latest.current.onHeld((state) => heldAction(walker, ground, state, { use: controller.using, yaw: controller.yaw }));
      // For poking at from the console in development (a scripted walk): never in a production build.
      const debug = process.env.NODE_ENV !== "production" ? (window as unknown as { __fp?: unknown }) : null;
      if (debug) debug.__fp = { walker: () => walker, controller, ground, run: () => latest.current.run, act, choices };
      let raf = 0;
      let drawn = false;
      let ended = false;
      // A scan's picture arrives after its mesh: the player is let loose once it has around them, or after a while.
      const looseAt = performance.now() + SCAN_WAIT_MS;

      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
        last = now;
        const { run: current, onAct: play } = latest.current;
        if (current !== seen) {
          actors.sync(current, now);
          seen = current;
        }

        // The run is over: the view takes no more input, and frees the mouse for the end's buttons.
        if (current.status !== "playing" && !ended) {
          ended = true;
          controller.dispose();
        }

        // The movement runs at a fixed step, however fast the screen draws.
        controller.frame(dt);
        const waiting = !drawn && now < looseAt && !on.settled(walker.pos);
        if (waiting) owed = 0;
        const controls = controller.controls();
        if (controls.walk !== walking) {
          walking = controls.walk;
          latest.current.onWalking?.(walking);
        }
        use ||= controls.usePressed;
        owed += dt;
        const stood = walker.pos;
        const walkedBefore = walker.walked;
        if (controls.usePressed) progress.used = true;
        while (!waiting && owed >= FP.stepS) {
          owed -= FP.stepS;
          const out = stepWalker(walker, ground, current, { ...controls, usePressed: use });
          use = false;
          walker = out.walker;
          if (out.action) play(out.action);
        }
        // Turned by the player since the last frame (the mouse, a drag, the arrow keys): before the view is put back on a hop below.
        progress.lookedRad += Math.abs(controller.yaw - looked.yaw) + Math.abs(controller.pitch - looked.pitch);
        // Put back on the engine's node (a restart, a number key): look the way that hop went, or,
        // at the start, the first way on. A frame of walking never covers this much ground.
        if (Math.hypot(walker.pos.x - stood.x, walker.pos.y - stood.y) > 0.5) {
          const hop = Math.atan2(walker.pos.y - stood.y, walker.pos.x - stood.x);
          controller.yaw = current.turn === 0 ? (wayOn(current, walker.pos) ?? hop) : hop;
          controller.pitch = 0;
        }
        looked = { yaw: controller.yaw, pitch: controller.pitch };
        progress.walkedM += walker.walked - walkedBefore;
        if (controls.walk && walker.walked - walkedBefore > 0) progress.sneaked = true;
        if (controller.areas !== areas) {
          areas = controller.areas;
          actors.showAreas(areas, current.playerNode, current.locked);
        }

        // The view: at eye height, with a small bob tied to the ground covered.
        const speed = Math.hypot(walker.vel.x, walker.vel.y);
        bob += ((still ? 0 : Math.min(1, speed / FP.runMps)) - bob) * Math.min(1, dt * 12);
        const lift = Math.sin((walker.walked / FP.strideM) * Math.PI * 4) * FP.bobM * bob;
        actors.update(now);
        const camera = on.draw(walker, lift, controller.yaw, controller.pitch, dt);

        // Labels: each at its piece, hidden behind the view and behind walls (a beacon shows through).
        // Nearest first, and one that would cover another is drawn above it.
        const w = host.clientWidth;
        const h = host.clientHeight;
        const live = new Set<string>();
        const taken: { x: number; y: number; half: number }[] = [];
        const far = (at: { x: number; y: number }) => Math.hypot(at.x - walker.pos.x, at.y - walker.pos.y);
        for (const label of actors.labels(current).sort((p, q) => far(p.at) - far(q.at))) {
          point.set(label.x, label.y + on.liftY, label.z).project(camera);
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
        if (doneAt === null && hintDone(progress)) doneAt = now;
        const phase = hintPhase(doneAt === null ? null : now - doneAt, still);
        const ticks = hintTicks(progress);
        const nextHint = `${phase}${ticks.move}${ticks.look}${ticks.sneak}${ticks.use}`;
        if (nextHint !== hintKey) {
          hintKey = nextHint;
          setHint({ phase, progress: { ...progress } });
        }
        if (waiting) {
          const counts = on.counts();
          loading({ line: "Loading the picture around you", held: counts?.held ?? 0, total: counts?.total ?? 0 });
        } else if (!drawn) {
          drawn = true;
          loading(null);
          setReady(true);
          latest.current.onReady?.(true);
        }
      };
      raf = requestAnimationFrame(frame);

      return () => {
        cancelAnimationFrame(raf);
        observer?.disconnect();
        latest.current.onHeld(null);
        latest.current.onReady?.(false);
        if (debug) delete debug.__fp;
        controller.dispose();
        for (const el of labelEls.values()) el.remove();
        actors.group.removeFromParent();
        actors.dispose();
      };
    };

    /**
     * Our own scene, drawn by our own renderer on the view's canvas: the
     * fixture floor's light, fog and camera over `floorGroup`, with the
     * floor at `floorY`. A fixture floor and a scan's plan both draw this way.
     */
    const ourStage = (floorGroup: Group, ground: Stage["ground"], floorY: number, extra: Pick<Stage, "cameraMount"> = {}): Stage | null => {
      if (!hasWebGL()) return null;
      let renderer: WebGLRenderer;
      try {
        renderer = new WebGLRenderer({ canvas: target, antialias: true, powerPreference: "high-performance" });
      } catch {
        return null;
      }
      target.addEventListener("webglcontextlost", onLost);
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
      scene.add(floorGroup);
      // The run's pieces stand on the floor.
      const pieces = new Group();
      pieces.name = "run-pieces";
      pieces.position.y = floorY;
      scene.add(pieces);
      return {
        ground,
        liftY: floorY,
        ...extra,
        add: (object) => pieces.add(object),
        settled: () => true,
        counts: () => null,
        resize() {
          const { clientWidth: w, clientHeight: h } = host;
          if (w === 0 || h === 0) return;
          renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
          renderer.setSize(w, h, false);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
        },
        draw(walker, lift, yaw, pitch) {
          // A fixed eye, for screenshots in development: never in a production build.
          const look = process.env.NODE_ENV !== "production" ? (window as unknown as { __fpLook?: { x: number; y: number; yaw: number; pitch: number } }).__fpLook : undefined;
          if (look) ({ yaw, pitch, lift } = { ...look, lift: 0 });
          const at = look ?? walker.pos;
          const eye = floorY + FP.eyeM + lift;
          camera.position.set(at.x, eye, at.y);
          const flat = Math.cos(pitch);
          camera.lookAt(at.x + Math.cos(yaw) * flat, eye + Math.sin(pitch), at.y + Math.sin(yaw) * flat);
          renderer.render(scene, camera);
          return camera;
        },
        dispose() {
          target.removeEventListener("webglcontextlost", onLost);
          disposeGroup(floorGroup);
          renderer.dispose();
        },
      };
    };

    const toneOfRoom = (roomId: string): RoomTone => {
      const zone = placed.zones.find((z) => z.roomIds.includes(roomId));
      return zone?.role === "crowded" ? "lit" : zone?.role === "quiet" ? "dark" : "plain";
    };

    /** A fixture floor: our own scene of world.ts's walls. */
    const fixtureStage = (floorWorld: World): Stage | null =>
      ourStage(buildFloorGroup(floorWorld, palette, toneOfRoom), groundOf(floorWorld), 0);

    /** Where a camera covering `cover` hangs on a scan: just behind the run's first node, facing along the run. */
    const scanCameraMount =
      (ground: Ground) =>
      (cover: readonly string[]): Vec => {
        const points = cover.map((id) => ground.nodes.get(id)).filter((n) => n !== undefined);
        const first = points[0] ?? { x: 0, y: 0 };
        const mid = { x: points.reduce((s, n) => s + n.x, 0) / Math.max(1, points.length), y: points.reduce((s, n) => s + n.y, 0) / Math.max(1, points.length) };
        const away = { x: first.x - mid.x, y: first.y - mid.y };
        const length = Math.hypot(away.x, away.y);
        return length < 1e-6 ? { x: first.x + 0.4, y: first.y } : { x: first.x + (away.x / length) * 0.4, y: first.y + (away.y / length) * 0.4 };
      };

    /**
     * A live scan, drawn as one of our floors (the default): its plan worked
     * out from its mesh in this tab (scan-plan.ts), drawn like a fixture
     * floor (scan-plan-scene.ts), and walked against the walls drawn. The
     * scan's own picture is not shown. Null, with the board back and a line
     * saying why, when the board doesn't stand on the scan.
     */
    const planStage = (handle: ScanHandle): Stage | null => {
      const { view } = handle;
      const tree = view.meshTree;
      if (!tree) return null;
      const floor = placed.level.floor;
      const join = joinScan(floor, view.scanPoints());
      // Counts only: no id or position of the scan is logged.
      console.info(`First person on the scan: ${join.matched} of ${join.total} board positions are panoramas, at most ${join.worstM.toFixed(3)} m apart`);
      const refusal = joinRefusal(join);
      if (refusal) {
        unavailable(`${refusal} You're on the board.`);
        return null;
      }
      const started = performance.now();
      const mesh = meshSolid(tree);
      const floors = [...nodeFloors(floor, mesh, join.heights).values()].sort((p, q) => p - q);
      const floorY = floors.length > 0 ? floors[Math.floor(floors.length / 2)] : 0;
      // The ceiling: straight up from each scan camera, the median.
      const ups: number[] = [];
      for (const node of floor.nodes) {
        const eyeY = join.heights.eye.get(node.id);
        if (eyeY === undefined) continue;
        const d = mesh.hit([node.x, eyeY, node.y], [0, 1, 0], 4);
        if (d !== null) ups.push(eyeY + d);
      }
      ups.sort((p, q) => p - q);
      const ceilingY = Math.min(floorY + 4, Math.max(floorY + 2.4, ups.length > 0 ? ups[Math.floor(ups.length / 2)] : floorY + FP.wallHeightM));
      const byId = new Map(floor.nodes.map((n) => [n.id, n]));
      const paths = floor.edges.flatMap((e) => {
        const a = byId.get(e.a);
        const b = byId.get(e.b);
        return a && b ? [{ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } }] : [];
      });
      const geometry = tree.bvh.geometry;
      const plan = derivePlan({
        positions: geometry.attributes.position.array,
        index: geometry.index?.array ?? null,
        floorY,
        ceilingY,
        nodes: floor.nodes.map((n) => ({ x: n.x, y: n.y })),
        paths,
        hasFloor: (x, z) => {
          const y = tree.floorBelow(x, floorY + 0.4, z, 0.8);
          return y !== null && Math.abs(y - floorY) < 0.3;
        },
      });
      // Counts only.
      console.info(
        `First person draws the scan's plan: ${plan.walls.length} walls (${plan.stats.boundary} at the floor's edge), ${plan.doorways.length} doorways, in ${Math.round(performance.now() - started)} ms`,
      );
      const ground = scanGround(floor, planSolid(plan), join.heights, { leashM: PLAN.leashM + 1 });
      const nodeRoom = new Map(floor.nodes.map((n) => [n.id, n.roomId]));
      const all = [...ground.nodes.values()];
      const tone = (p: Vec): RoomTone => {
        let best = all[0];
        let bestD = Infinity;
        for (const n of all) {
          const d = (n.x - p.x) ** 2 + (n.y - p.y) ** 2;
          if (d < bestD) {
            bestD = d;
            best = n;
          }
        }
        return best ? toneOfRoom(nodeRoom.get(best.id) ?? "") : "plain";
      };
      const made = ourStage(buildPlanGroup(plan, palette, tone), ground, floorY, { cameraMount: scanCameraMount(ground) });
      // For the debug overlay in development: never in a production build.
      if (process.env.NODE_ENV !== "production") (window as unknown as { __fpPlan?: unknown }).__fpPlan = { plan, mesh: tree, objective: placed.level.objective };
      return made;
    };

    /**
     * A live scan: the scan's own renderer (spike/mesh/scan-view.ts, opened
     * when the Run screen opened) draws its mesh and panoramas from the pose
     * the walker gives it each frame, with the run's pieces in its scene, on
     * its own canvas, put on the page while this view shows. Null, with the
     * board back and a line saying why, when the board doesn't stand on it.
     */
    const scanStage = (handle: ScanHandle): Stage | null => {
      const { view } = handle;
      const tree = view.meshTree;
      if (!tree) return null;
      const join = joinScan(placed.level.floor, view.scanPoints());
      // Counts only: no id or position of the scan is logged.
      console.info(`First person on the scan: ${join.matched} of ${join.total} board positions are panoramas, at most ${join.worstM.toFixed(3)} m apart`);
      const refusal = joinRefusal(join);
      if (refusal) {
        unavailable(`${refusal} You're on the board.`);
        return null;
      }
      const ground = scanGround(placed.level.floor, meshSolid(tree), join.heights);
      const pieces = new Group();
      pieces.name = "run-pieces";
      // The scan's picture needs no light; the guards, cameras and doors do.
      pieces.add(new AmbientLight(palette.n100, 2));
      const slant = new DirectionalLight(palette.n100, 1.5);
      slant.position.set(-0.55, 1, -0.3);
      pieces.add(slant);
      // Just off the scan's floor, so the areas and markings are not lost in its lumps.
      pieces.position.y = ground.floorY + 0.07;
      view.scene.add(pieces);
      let feet: number | null = null;
      const eye = (pos: Vec): [number, number, number] => [pos.x, ground.feetAt(pos) + FP.eyeM, pos.y];
      return {
        ground,
        liftY: pieces.position.y,
        cameraMount: scanCameraMount(ground),
        add: (object) => pieces.add(object),
        settled: (pos) => view.settled(eye(pos)),
        counts: () => view.counts(),
        resize() {
          const { clientWidth: w, clientHeight: h } = host;
          if (w > 0 && h > 0) view.resize(w, h);
        },
        draw(walker, lift, yaw, pitch, dt) {
          // The feet settle on the floor's height, as the sandbox's do; a jump (a restart) lands at once.
          const floor = ground.feetAt(walker.pos);
          feet = feet === null || Math.abs(floor - feet) > 0.5 ? floor : feet + (floor - feet) * (1 - Math.exp(-14 * dt));
          // The renderer's yaw is zero down -z and grows to the left; this view's is zero east (+x) and grows to the right.
          view.setPose({ x: walker.pos.x, y: feet + FP.eyeM + lift, z: walker.pos.y, yaw: -yaw - Math.PI / 2, pitch }, [walker.vel.x, walker.vel.y]);
          view.render(dt);
          return view.camera;
        },
        dispose() {
          pieces.removeFromParent();
        },
      };
    };

    const begin = (made: Stage | null) => {
      if (gone) return;
      if (!made) return unavailable();
      stage = made;
      stopSession = runSession(made);
    };

    let stopListening = () => {};
    const photo = scanLook() === "photo";
    if (world) {
      begin(fixtureStage(world));
    }
    const choice = world ? null : scanStageOf(scanGiven ? { handle: scanHandle, failed: scanFailed, ready: false } : null);
    const scan = choice?.kind === "walk" ? choice.handle : null;
    if (choice?.kind === "wait") {
      // The preload's own module is still on its way: the scan comes as a new handle, which runs this again.
      loading({ line: "Opening the scan", held: 0, total: 0 });
    } else if (choice?.kind === "refuse") {
      unavailable(choice.line);
    } else if (scan) {
      // The scan's own picture only when asked for (`?scanlook=photo`); by default its plan, drawn as ours.
      if (photo) {
        // The scan's canvas, under the labels and the HUD, while this view shows.
        host.insertBefore(scan.canvas, labels);
        scan.canvas.addEventListener("webglcontextlost", onLost);
      }
      const phase = () => {
        const status = scan.status().phase;
        if (status !== "ready") loading({ line: SCAN_PHASE[status] ?? "Loading the building", held: 0, total: 0 });
      };
      stopListening = scan.subscribe(phase);
      phase();
      void scan.ready.then((ok) => {
        if (gone || !ok) return;
        const made = photo ? scanStage(scan) : planStage(scan);
        if (made) begin(made);
      });
    }

    return () => {
      gone = true;
      stopListening();
      stopSession?.();
      stage?.dispose();
      if (scan) {
        scan.canvas.removeEventListener("webglcontextlost", onLost);
        scan.canvas.remove();
      }
    };
  }, [world, placed, scanGiven, scanHandle, scanFailed]);

  const noun = objectiveNoun(placed.level.missionId);
  const moment = useMoment(placed, run);
  const over = run.status !== "playing";
  const end = useMemo(() => endState(placed, run), [placed, run]);
  // The run's end frees the mouse, so the Debrief is a click away.
  useEffect(() => {
    if (over && surface.current && document.pointerLockElement === surface.current) document.exitPointerLock();
  }, [over]);
  const tint = run.alarm === "calm" ? null : run.alarm === "suspicious" ? "var(--warning)" : "var(--danger)";

  return (
    <div
      ref={surface}
      data-testid="fp-view"
      data-stage={onScan ? "scan" : "fixture"}
      data-ready={ready ? "true" : undefined}
      data-node={run.playerNode}
      data-turn={run.turn}
      data-locked={run.locked.join(" ")}
      data-alarm={run.alarm}
      data-carrying={run.carrying ? "true" : undefined}
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

      {onScan ? (
        <p data-testid="fp-fiction" className="pointer-events-none absolute top-3 left-6 rounded-sm bg-surface-1 px-3 py-1.5 text-xs text-text-2 shadow-e-1">
          The building is the real scan. Security shown is game fiction.
        </p>
      ) : null}

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

      {/* The controls hint and the meter are for a run being played: both go when the end card comes up (issue 146). */}
      {ready && !end ? <SuspicionMeter notice={notice} /> : null}
      {ready && !end ? <ControlsHint phase={hint.phase} ticks={hintTicks(hint.progress)} dragToLook={hud.refused} /> : null}

      <div className="pointer-events-none absolute inset-0 flex flex-col justify-end px-6 py-3">
        <div className="flex flex-col items-center gap-2">
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
              className={cn(PROMPT, hud.prompt.kind === "exit" && "border border-success")}
            >
              {hud.prompt.kind === "far" ? (
                "A locked door. Step up to it and hold E to pick it."
              ) : hud.prompt.kind === "take" ? (
                <>
                  Hold <Key>E</Key> to take the {noun}
                </>
              ) : hud.prompt.kind === "exit" ? (
                exitPrompt(placed, hud.prompt.nodeId, noun)
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
          ) : moment?.kind === "door" ? (
            // The picked door's prompt does not just vanish: it says the door is open, for the moment's turns (issue 188).
            <p data-testid="fp-prompt" data-kind="open" className={cn(PROMPT, "border border-success")}>
              Door open. Walk on through.
            </p>
          ) : null}
          {over ? null : (
          <p data-testid="fp-hint" className="flex max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-sm bg-surface-1 px-3 py-1.5 text-sm text-text-2 shadow-e-1">
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
          )}
        </div>
      </div>

      {/* The middle of the view: what E acts on. Gone with the run. */}
      {over ? null : (
        <div aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-text-2" />
      )}

      {/* The end of the run: what happened and why, and the way on. The view takes no more input. */}
      {end ? (
        <div data-testid="fp-end" data-status={run.status} className="absolute inset-0 grid place-items-center bg-n-50/55 p-6">
          <div role="status" className="flex max-w-lg flex-col items-center gap-3 rounded-md border border-border bg-surface-1 px-8 py-6 text-center shadow-e-2">
            <p className="label-caps text-text-3">{end.outcome === "won" ? "Run complete" : "Run over"}</p>
            <p data-testid="fp-over" className={cn("text-2xl font-semibold", end.outcome === "won" ? "text-success" : "text-danger")}>
              {end.headline}
            </p>
            {end.detail ? (
              <p data-testid="fp-end-why" className="text-sm text-text-2">
                {end.detail}
              </p>
            ) : null}
            {endAction ? <div className="mt-2 flex items-center gap-3">{endAction}</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const PROMPT = "flex items-center gap-2 rounded-sm bg-surface-1 px-3 py-2 text-sm text-text-1 shadow-e-1";

/** Carrying, at an exit: walking on to it is the win, with no key (issue 188). */
export function exitPrompt(placed: PlacedLevel, nodeId: string, noun: string): string {
  const name = placed.entries.find((e) => e.nodeId === nodeId)?.label ?? roomName(placed.level.floor, nodeId);
  return `The way out: the ${name.toLowerCase()}. Walk on to it with the ${noun} to end the run.`;
}

function Key({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-sm border border-border bg-surface-2 px-1.5 font-mono text-xs text-text-1">
      {children}
    </kbd>
  );
}
