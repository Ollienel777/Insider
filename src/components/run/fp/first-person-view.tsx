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
  Color,
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
import { MeshWorld } from "@/app/spike/mesh/collider";
import { act, type Action, type RunState } from "@/engine";
import type { LockKind } from "@/domain/manifest";
import type { PlacedLevel } from "@/level/placer";
import { objectiveLabel, objectiveNoun } from "@/lib/objective-noun";
import { cn } from "@/lib/utils";
import { cameraMount, choices, roomName } from "../board";
import { scanStageOf, type HeldAction, type ScanHandle, type ScanPreload } from "./run-view";
import { primeScan } from "./scan-preload";
import { actionLabel, announcement, lockOf, lockWords } from "./action";
import { ActionAnnouncer, ActionLabelView, PickupToast } from "./action-hud";
import { Actors, type Marks } from "./actors";
import { Controller } from "./controller";
import { endState } from "./end-state";
import type { Ground, Vec } from "./ground";
import { distanceTo } from "./motion";
import { hintDone, hintPhase, hintTicks, NO_PROGRESS, type HintPhase, type HintProgress } from "./hint";
import { ControlsHint } from "./hint-card";
import { noticeOf } from "./notice";
import { readPalette } from "./palette";
import { joinRefusal, joinScan } from "./scan-join";
import { fillScan } from "./scan-fill";
import { nodeFloors, scanGround } from "./scan-ground";
import { addFurniture, applyOverrides, clearDoorways, tidyFurniture, windowsFromSight, derivePlan, FURNITURE, glassFromSight, mismatches, oneDoorPerRoom, reconcile, regularise, type PlanOverrides, PLAN, planSolid, roomLabels, type ScanPlan } from "./scan-plan";
import { buildDress, DRESS } from "./scan-dress";
import { fetchPhotoPanos, PhotoSet } from "./scan-photo";
import { buildPlanGroup } from "./scan-plan-scene";
import { meshSolid } from "./scan-solid";
import { buildFloorGroup, disposeGroup, type RoomTone } from "./scene";
import { SuspicionMeter } from "./suspicion-meter";
import { FP } from "./tuning";
import { createWalker, heldAction, promptFor, stepWalker, type Prompt, type Walker } from "./walker";
import { buildWorld, groundOf, type World } from "./world";
import { useMoment } from "../moment";

export interface FirstPersonViewProps {
  /** On a scan: its photographed mesh ("photo", first person) or its rebuilt rooms ("set", the 3D model). */
  look?: "photo" | "set";
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
  /** What the end of the run offers next to its outcome (the Run screen's "See the debrief"). */
  endAction?: ReactNode;
  /** The floor's lock kind (the rules table's era), for the words E's label says. */
  lockKind?: LockKind | null;
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
  /** The door leaves' colour, where it is not the palette's. */
  doorColour?: Color;
  /** Puts the run's pieces (actors.ts) in the drawing. */
  add(object: Object3D): void;
  /** Whether the picture around `pos` has arrived: until it has, the view draws but the player waits. */
  settled(pos: Vec): boolean;
  /** How much of the building's picture is in, for the loading line; null when there is nothing to load. */
  counts(): { held: number; total: number } | null;
  resize(): void;
  /** Draws the frame from the walker's place, the bob's lift, and where the player looks; returns the camera it drew from. */
  draw(walker: { pos: Vec; vel: Vec }, lift: number, yaw: number, pitch: number, dt: number): Camera;
  /** Puts the stage's canvas on show, or hides it while the other stage of a scan shows: hidden, it is kept, not rebuilt. */
  show(on: boolean): void;
  /** A bounded piece of the stage's own building while it is hidden (the set's painting); true once there is none left. */
  idle?(): boolean;
  /** Draws one unseen frame from `pos`, so the shaders compile and the textures upload before the stage first shows. */
  warm?(pos: Vec, yaw: number): Promise<void>;
  /** What the stage holds on the GPU, roughly, in bytes. */
  memory?(): { geometry: number; textures: number };
  dispose(): void;
}

/** How a scan is drawn: what `scanLook` gives. */
type Look = "set" | "blockout" | "photo";

/** Where the player stood and looked in the stage left behind: the stage switched to carries it on. */
interface Carry {
  walker: Walker;
  yaw: number;
  pitch: number;
}

/** Hands the browser back a frame between pieces of a stage's building: an idle moment, or the next task. */
function slice(): Promise<void> {
  return new Promise((resolve) => {
    const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (idle) idle(() => resolve(), { timeout: 50 });
    else setTimeout(resolve, 0);
  });
}

/** Roughly what `root` holds on the GPU: its geometry's buffers and its materials' textures, each counted once. */
function gpuBytes(root: Object3D): { geometry: number; textures: number } {
  const seen = new Set<unknown>();
  let geometry = 0;
  let textures = 0;
  const texture = (t: unknown) => {
    if (!t || typeof t !== "object" || seen.has(t) || !(t as { isTexture?: boolean }).isTexture) return;
    seen.add(t);
    const tex = t as { image?: unknown; images?: unknown[]; generateMipmaps?: boolean; isRenderTargetTexture?: boolean; isCubeTexture?: boolean };
    const faces = tex.isCubeTexture ? 6 : 1;
    const image = (tex.isCubeTexture ? (tex.image as unknown[] | undefined)?.[0] : tex.image) as { width?: number; height?: number } | undefined;
    const px = (image?.width ?? 0) * (image?.height ?? 0) * faces;
    textures += px * 4 * (tex.generateMipmaps || tex.isRenderTargetTexture ? 1.33 : 1);
  };
  root.traverse((o) => {
    const mesh = o as { geometry?: { attributes?: Record<string, { array?: ArrayBufferView }>; index?: { array?: ArrayBufferView } | null }; material?: unknown };
    if (mesh.geometry && !seen.has(mesh.geometry)) {
      seen.add(mesh.geometry);
      for (const a of Object.values(mesh.geometry.attributes ?? {})) geometry += a.array?.byteLength ?? 0;
      geometry += mesh.geometry.index?.array?.byteLength ?? 0;
    }
    for (const m of [mesh.material].flat()) {
      if (!m || typeof m !== "object") continue;
      for (const v of Object.values(m as Record<string, unknown>)) texture(v);
      const uniforms = (m as { uniforms?: Record<string, { value?: unknown }> }).uniforms;
      for (const u of Object.values(uniforms ?? {})) texture(u?.value);
    }
  });
  return { geometry, textures };
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
 * How a live scan is drawn in first person: as its own photographed mesh
 * (first person), or as a set built to its plan and coloured from its
 * photographs (the 3D model): the player's choice, `chosen`. In development,
 * `?scanlook=photo|set|blockout` overrides it (blockout: the plan in the
 * fixture floors' colours).
 */
function scanLook(chosen: "photo" | "set"): "set" | "blockout" | "photo" {
  if (process.env.NODE_ENV === "production") return chosen;
  try {
    const look = new URLSearchParams(window.location.search).get("scanlook");
    return look === "photo" || look === "blockout" || look === "set" ? look : chosen;
  } catch {
    return chosen;
  }
}

/** The view's height, degrees: a shooter's 72, narrower on a wide view so it never spans more than `MAX_ACROSS` across. */
const FOV_DEGREES = 72;
const MAX_ACROSS = 100;
/** The scan's set: the panoramas' own camera, a little narrower than a shooter's. */
const SET_FOV_DEGREES = 64;
function fovFor(aspect: number, upright = FOV_DEGREES): number {
  const across = (MAX_ACROSS * Math.PI) / 360;
  const capped = (2 * Math.atan(Math.tan(across) / Math.max(aspect, 1e-3)) * 180) / Math.PI;
  return Math.min(upright, capped);
}

/** A scan's hand-made plan corrections from this machine (`.local/scan-overrides.json`), asked by a hash of its id; null when none. */
async function loadOverrides(modelId: string): Promise<PlanOverrides | null> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(modelId));
    const h = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
    const response = await fetch("/api/scan-overrides", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ h }), cache: "no-store" });
    if (!response.ok) return null;
    const body = (await response.json()) as PlanOverrides;
    return Object.keys(body).length > 0 ? body : null;
  } catch {
    return null;
  }
}

/** The longest the set waits for the scan's detailed mesh (its furniture) before standing without it, ms. */
const DETAIL_WAIT_MS = 10_000;

/** Resolves once the scan's detailed mesh is in, has failed, or `ms` have passed. */
function detailIn(scan: ScanHandle, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const started = performance.now();
    const check = () => {
      const state = scan.view.status().detail.state;
      if (state !== "loading" || performance.now() - started > ms) resolve();
      else setTimeout(check, 100);
    };
    check();
  });
}

/** Whether this browser will give a canvas a WebGL 2 context, asked of a spare canvas. */
function hasWebGL(): boolean {
  try {
    return document.createElement("canvas").getContext("webgl2") !== null;
  } catch {
    return false;
  }
}

export default function FirstPersonView({ placed, run, onAct, onUnavailable, onHeld, paused, scan = null, onReady, endAction = null, lockKind = null, look: chosenLook = "photo" }: FirstPersonViewProps) {
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
  const latest = useRef({ run, onAct, onUnavailable, onHeld, onReady });
  useLayoutEffect(() => {
    latest.current = { run, onAct, onUnavailable, onHeld, onReady };
  }, [run, onAct, onUnavailable, onHeld, onReady]);

  // The look chosen, read by the stage effect without rebuilding it: a switch between first person and the 3D model
  // swaps between the scan's two stages, each built once and kept while the view is up (issue 118).
  const lookChosen = useRef(chosenLook);
  const switchLook = useRef<((look: Look) => void) | null>(null);

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
    // The stages built, by look, kept until the view goes or the scan changes; the one showing, and its session.
    const stages = new Map<Look, Stage>();
    const builds = new Map<Look, Promise<Stage | null>>();
    let active: Look | "fixture" | null = null;
    let stopSession: (() => Carry) | null = null;
    // Where the player is in the session showing, for warming the stage built behind it.
    let pose: (() => Carry) | null = null;
    let stopPrime = () => {};
    let carry: Carry | null = null;
    // What the player has tried, for the hint, and when it was done, for its fade: across switches, so the hint does not come back.
    const progress: HintProgress = { ...NO_PROGRESS };
    let doneAt: number | null = null;
    let loadKey = "";
    const loading = (next: ScanLoad) => {
      const key = JSON.stringify(next);
      if (key === loadKey) return;
      loadKey = key;
      setScanLoad(next);
    };

    /** The walker, the controller, the actors and the labels on `on`, and the frame loop that draws it. */
    const runSession = (on: Stage, look: Look | "fixture", carried: Carry | null, onDrawn?: () => void): (() => Carry) => {
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
      const actors = new Actors(ground, palette, marks, still, FP.turnMs, tempo, on.doorColour ?? null);
      on.add(actors.group);

      // Facing the first way on from where the engine has the player.
      // Or, switched to from the scan's other stage, where the player stood there, when this stage's walls let them stand there.
      const fresh = createWalker(ground, first);
      const stoodAt = carried && carried.walker.node === first.playerNode && carried.walker.turn === first.turn ? carried.walker : null;
      const keep = stoodAt !== null && ground.clear(fresh.pos, stoodAt.pos, first.locked);
      let walker: Walker = keep && stoodAt ? { ...stoodAt, vel: { x: 0, y: 0 } } : fresh;
      const wayOn = (state: RunState, from: { x: number; y: number }): number | null => {
        const ahead = choices(state)[0];
        const towards = ahead ? ground.path(state.playerNode, ahead.nodeId)[1] : null;
        return towards ? Math.atan2(towards.y - from.y, towards.x - from.x) : null;
      };
      const controller = new Controller(
        host,
        carried ? carried.yaw : (wayOn(first, walker.pos) ?? 0),
        (locked) => setHud((h) => (h.locked === locked ? h : { ...h, locked, refused: locked ? false : h.refused })),
        () => setHud((h) => (h.refused ? h : { ...h, refused: true })),
      );
      if (carried) controller.pitch = carried.pitch;

      on.resize();
      const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => on.resize());
      observer?.observe(host);
      // Entering and leaving fullscreen, and a window resize, size the canvas again even where the observer is late or absent.
      window.addEventListener("resize", on.resize);
      document.addEventListener("fullscreenchange", on.resize);

      const labelEls = new Map<string, HTMLSpanElement>();
      const point = new Vector3();
      let seen: RunState | null = null;
      let hintKey = "";
      pose = () => ({ walker, yaw: controller.yaw, pitch: controller.pitch });
      let looked = { yaw: controller.yaw, pitch: controller.pitch };
      let last = performance.now();
      let owed = 0;
      let use = false;
      let bob = 0;
      let hudKey = "";
      let areas = false;
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

      // With `?debug=1`: where the player stands and looks, in a corner, and K to note the spot (and copy the list).
      const showWhere = debug !== null && new URLSearchParams(window.location.search).get("debug") === "1";
      const where = showWhere ? document.createElement("div") : null;
      const spots: string[] = [];
      const NL = String.fromCharCode(10);
      if (where) {
        where.dataset.testid = "fp-where";
        where.className = "pointer-events-none absolute bottom-2 left-2 z-20 whitespace-pre rounded-sm bg-surface-1 px-2 py-1 font-mono text-xs text-text-1";
        host.appendChild(where);
      }
      const noteSpot = (event: KeyboardEvent) => {
        if (event.key !== "k" && event.key !== "K") return;
        const yawDeg = ((((controller.yaw * 180) / Math.PI) % 360) + 360) % 360;
        spots.push(`${walker.pos.x.toFixed(2)}, ${walker.pos.y.toFixed(2)}, ${yawDeg.toFixed(0)}°`);
        void navigator.clipboard?.writeText(spots.join(NL)).catch(() => {});
      };
      if (where) window.addEventListener("keydown", noteSpot);
      let whereAt = 0;
      const frame = (now: number) => {
        if (where && now - whereAt > 100) {
          whereAt = now;
          const yawDeg = ((((controller.yaw * 180) / Math.PI) % 360) + 360) % 360;
          where.textContent = `x ${walker.pos.x.toFixed(2)}  z ${walker.pos.y.toFixed(2)}  heading ${yawDeg.toFixed(0)}°  (K notes it)${spots.length ? NL + spots.join(NL) : ""}`;
        }
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
        // Which stage drew the last frame, and when: for timing a switch in development.
        if (debug) (debug as { __fpFrame?: unknown }).__fpFrame = { look, at: now };

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
        const nextHint = `${phase}${ticks.move}${ticks.look}${ticks.use}`;
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
          onDrawn?.();
        }
      };
      raf = requestAnimationFrame(frame);

      return () => {
        cancelAnimationFrame(raf);
        observer?.disconnect();
        where?.remove();
        if (where) window.removeEventListener("keydown", noteSpot);
        window.removeEventListener("resize", on.resize);
        document.removeEventListener("fullscreenchange", on.resize);
        latest.current.onHeld(null);
        latest.current.onReady?.(false);
        if (debug) delete debug.__fp;
        controller.dispose();
        for (const el of labelEls.values()) el.remove();
        actors.group.removeFromParent();
        actors.dispose();
        pose = null;
        return { walker, yaw: controller.yaw, pitch: controller.pitch };
      };
    };

    /**
     * Our own scene, drawn by our own renderer on the view's canvas: the
     * fixture floor's light, fog and camera over `floorGroup`, with the
     * floor at `floorY`. A fixture floor and a scan's plan both draw this way.
     */
    const ourStage = (
      floorGroup: Group,
      ground: Stage["ground"],
      floorY: number,
      extra: Partial<Pick<Stage, "cameraMount" | "settled" | "counts" | "doorColour">> & {
        fov?: number; tick?: (renderer: WebGLRenderer) => void; idle?: (renderer: WebGLRenderer) => boolean; dispose?: () => void } = {},
    ): Stage | null => {
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
      const camera = new PerspectiveCamera(FOV_DEGREES, 1, 0.05, 80);
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
        cameraMount: extra.cameraMount,
        doorColour: extra.doorColour,
        add: (object) => pieces.add(object),
        settled: extra.settled ?? (() => true),
        counts: extra.counts ?? (() => null),
        resize() {
          const { clientWidth: w, clientHeight: h } = host;
          if (w === 0 || h === 0) return;
          renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
          renderer.setSize(w, h, false);
          camera.aspect = w / h;
          camera.fov = fovFor(w / h, extra.fov ?? FOV_DEGREES);
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
          extra.tick?.(renderer);
          renderer.render(scene, camera);
          return camera;
        },
        show(on) {
          target.style.visibility = on ? "" : "hidden";
        },
        idle: extra.idle ? () => extra.idle!(renderer) : undefined,
        async warm(at, yaw) {
          const eye = floorY + FP.eyeM;
          camera.position.set(at.x, eye, at.y);
          camera.lookAt(at.x + Math.cos(yaw), eye, at.y + Math.sin(yaw));
          // The shaders compiled off the main thread where the browser can (KHR_parallel_shader_compile), then one frame for the uploads.
          await renderer.compileAsync(scene, camera).catch(() => {});
          if (!gone) renderer.render(scene, camera);
        },
        memory: () => gpuBytes(scene),
        dispose() {
          target.style.visibility = "";
          target.removeEventListener("webglcontextlost", onLost);
          extra.dispose?.();
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
    const planStage = async (handle: ScanHandle, dressed: boolean, overrides: PlanOverrides | null = null): Promise<Stage | null> => {
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
      // Worked out a piece at a time, handing the browser a frame between pieces: built while first person shows, it must not stall it.
      let busy = 0;
      let longest = 0;
      let mark = performance.now();
      const pause = async (): Promise<boolean> => {
        const took = performance.now() - mark;
        busy += took;
        longest = Math.max(longest, took);
        await slice();
        mark = performance.now();
        return gone;
      };
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
      if (await pause()) return null;
      const byId = new Map(floor.nodes.map((n) => [n.id, n]));
      const paths = floor.edges.flatMap((e) => {
        const a = byId.get(e.a);
        const b = byId.get(e.b);
        return a && b ? [{ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } }] : [];
      });
      const geometry = tree.bvh.geometry;
      // Which scan positions stand in a corridor: a doorway's room is the side that is not one.
      const corridorRooms = new Set(floor.rooms.filter((r) => /corridor|hall|lobby/i.test(r.label)).map((r) => r.id));
      const circulation = floor.nodes.map((n) => ({ x: n.x, y: n.y, open: corridorRooms.has(n.roomId) }));
      const plan = derivePlan({
        positions: geometry.attributes.position.array,
        index: geometry.index?.array ?? null,
        floorY,
        ceilingY,
        nodes: circulation,
        paths,
        hasFloor: (x, z) => {
          const y = tree.floorBelow(x, floorY + 0.4, z, 0.8);
          return y !== null && Math.abs(y - floorY) < 0.3;
        },
      });
      if (await pause()) return null;
      // One door to a room: extra doorways no one went through become wall.
      // Glass the photographs saw through, from where they stood.
      const eyes = floor.nodes.flatMap((n) => {
        const y = join.heights.eye.get(n.id);
        return y === undefined ? [] : [{ x: n.x, y: n.y, eye: y }];
      });
      // Against the detailed mesh, where it is in: the walkable one smooths a glass wall's holes over.
      const detailed = handle.view.detailMesh;
      const detailWorld = dressed && detailed ? new MeshWorld(detailed, 0.45) : null;
      const seer = detailWorld ? meshSolid(detailWorld) : mesh;
      const glassWalls = glassFromSight(plan, eyes, paths, (from, dir, far) => seer.hit(from, dir, far));
      if (await pause()) return null;
      // The set against the scan, from every scan camera: doorways it lacks, walls it lacks. Fixed, then counted again.
      const scanSees = (from: readonly [number, number, number], dir: readonly [number, number, number], far: number) => mesh.hit(from, dir, far);
      // Asked a few scan cameras at a time: each camera's disagreements are its own.
      const disagreements = async (): Promise<ReturnType<typeof mismatches> | null> => {
        const found: ReturnType<typeof mismatches> = [];
        for (let i = 0; i < eyes.length; i += 8) {
          found.push(...mismatches(plan, eyes.slice(i, i + 8), scanSees));
          if (await pause()) return null;
        }
        return found;
      };
      const before = await disagreements();
      if (!before) return null;
      const reconciled = reconcile(plan, before, paths, eyes);
      if (await pause()) return null;
      const after = await disagreements();
      if (!after) return null;
      if (await pause()) return null;
      // The scan's hand-made corrections, where this machine has any; then walls as rooms have them.
      const overridden = overrides ? applyOverrides(plan, overrides) : 0;
      const tidied = regularise(plan, paths, eyes);
      const walledUp = oneDoorPerRoom(plan, circulation);
      if (await pause()) return null;
      // The furniture, on the set only: the blockout draws none, and none may stop the player unseen.
      if (dressed) {
        // The detailed mesh has the desks the walkable one smooths away; without it, the walkable one.
        const furnished = detailWorld ?? tree;
        addFurniture(
          plan,
          floor.nodes.map((n) => ({ x: n.x, y: n.y })),
          paths,
          (x, z) => furnished.floorBelow(x, floorY + FURNITURE.highM, z, FURNITURE.highM - 0.2),
          (x, z) => furnished.floorBelow(x, floorY + FURNITURE.standM, z, FURNITURE.standM + 0.3),
        );
        // No piece across a doorway: the way through stays clear.
        plan.furniture = plan.furniture.filter((box) =>
          plan.doorways.every((d) => {
            const mid = { x: (d.a.x + d.b.x) / 2, y: (d.a.y + d.b.y) / 2 };
            return box.corners.every((p, k) => distanceTo({ a: p, b: box.corners[(k + 1) % 4] }, mid) > 0.9);
          }),
        );
      }
      if (await pause()) return null;
      // Windows on the outside walls, where the scan cameras saw out.
      if (dressed) plan.windows = windowsFromSight(plan, eyes, scanSees);
      // Nothing in any doorway's way, either side; no fragment, nothing through a wall.
      const cleared = clearDoorways(plan) + tidyFurniture(plan);
      if (await pause()) return null;
      // Counts only.
      console.info(
        `First person draws the scan's plan: ${plan.walls.length} walls (${plan.stats.boundary} at the floor's edge), ${plan.doorways.length} doorways (${walledUp} more walled up, one door to a room), ${plan.glass.length} panes of glass (${glassWalls} walls seen through); the scan disagreed in ${before.length} places, ${reconciled} put right, ${after.length} left; ${overridden} corrections, ${tidied.extended} walls run on, ${tidied.removed} stubs gone, ${cleared} things out of doorways, ${plan.furniture.length} pieces of furniture, ${plan.windows?.length ?? 0} windows, in ${Math.round(busy)} ms of work, ${Math.round(longest)} ms at most at once`,
      );
      const ground = scanGround(floor, planSolid(plan), join.heights, { leashM: PLAN.leashM + 1 });
      if (await pause()) return null;
      const nodeRoom = new Map(floor.nodes.map((n) => [n.id, n.roomId]));
      const all = [...ground.nodes.values()];
      // The room a point is in: flooded from the scan positions, never through a wall.
      const roomOfPoint = roomLabels(
        plan,
        floor.nodes.map((n) => ({ x: n.x, y: n.y, room: n.roomId })),
      );
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
      if (await pause()) return null;
      const blockout = buildPlanGroup(plan, palette, tone);
      if (!dressed) {
        // The glass stops the player here too, so it is drawn here too.
        blockout.add(buildDress(plan, ground.doors.map((d) => d.centre)));
        return finishPlan(ourStage(blockout, ground, floorY, { cameraMount: scanCameraMount(ground) }), plan, tree);
      }
      // The set: the blockout until the photographs are in hand, then the photographs, painted as they arrive.
      const set = new Group();
      set.add(blockout);
      set.add(buildDress(plan, ground.doors.map((d) => d.centre)));
      let photos: PhotoSet | null = null;
      let photosFailed = false;
      const startNode = ground.nodes.get(latest.current.run.playerNode);
      void fetchPhotoPanos(handle.modelId, floorY)
        .then((panos) => {
          if (gone || panos.length === 0) {
            photosFailed = true;
            return;
          }
          const at = performance.now();
          photos = new PhotoSet(plan, panos, startNode ?? { x: 0, y: 0 }, roomOfPoint, undefined, handle.view.detailMesh ?? tree.bvh.geometry);
          // Counts only.
          console.info(`First person laid out the set's painting in ${Math.round(performance.now() - at)} ms`);
          blockout.visible = false;
          set.add(photos.group);
          // Counts only.
          console.info(`First person colours the set from ${panos.length} panoramas`);
        })
        .catch(() => {
          photosFailed = true;
        });
      let told = false;
      const paint = (renderer: WebGLRenderer, depthsAtMost?: number) => {
        photos?.step(renderer, depthsAtMost);
        if (photos && !told && photos.progress().done) {
          told = true;
          console.info(`First person painted the set in ${photos.seconds?.toFixed(1)} s`);
          if (process.env.NODE_ENV !== "production") (window as unknown as { __fpPainted?: boolean }).__fpPainted = true;
        }
      };
      return finishPlan(
        ourStage(set, ground, floorY, {
          cameraMount: scanCameraMount(ground),
          doorColour: DRESS.wood,
          fov: SET_FOV_DEGREES,
          tick: paint,
          // Hidden behind first person, the painting goes on a piece at a time: the "N of 75" is not started again on a switch.
          idle(renderer) {
            paint(renderer, 1);
            return photosFailed || (photos?.progress().done ?? false);
          },
          settled: () => photosFailed || (photos?.progress().done ?? false),
          counts: () => (photos ? { held: photos.progress().painted, total: photos.progress().total } : { held: 0, total: 0 }),
          dispose: () => photos?.dispose(),
        }),
        plan,
        tree,
      );
    };

    const finishPlan = (made: Stage | null, plan: ScanPlan, tree: MeshWorld): Stage | null => {
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
      // The blurred patch under each scan position is painted from a panorama that saw that floor from the side (scan-fill.ts).
      const unfill = fillScan(view);
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
        show(on) {
          // The scan's canvas, under the labels and the HUD, while this stage shows; off the page while the set does.
          if (on) {
            host.insertBefore(handle.canvas, labels);
            const { clientWidth: w, clientHeight: h } = host;
            if (w > 0 && h > 0) view.resize(w, h);
          } else handle.canvas.remove();
        },
        memory: () => gpuBytes(view.scene),
        dispose() {
          handle.canvas.remove();
          pieces.removeFromParent();
          unfill();
        },
      };
    };

    /** Shows `made`, built for `look`: the stage showing is hidden (kept, not disposed), and the player carries on where they stood. */
    const swap = (look: Look | "fixture", made: Stage) => {
      if (gone || active === look) return;
      stopPrime();
      if (stopSession) carry = stopSession();
      stopSession = null;
      const left = active !== null && active !== "fixture" ? active : null;
      const leftStage = left ? stages.get(left) : undefined;
      leftStage?.show(false);
      made.show(true);
      // A stage left before its painting was done goes on painting, hidden.
      if (left && leftStage?.idle && !warmed.has(left)) pump(left, leftStage);
      active = look;
      stopSession = runSession(made, look, carry, () => prebuild(look));
    };

    const begin = (made: Stage | null) => {
      if (gone) return;
      if (!made) return unavailable();
      stages.set("photo", made);
      swap("fixture", made);
    };

    let stopListening = () => {};
    let pumping = 0;
    // The stages built behind the other, painted and drawn once unseen.
    const warmed = new Set<Look>();
    const choice = world ? null : scanStageOf(scanGiven ? { handle: scanHandle, failed: scanFailed, ready: false } : null);
    const scan = choice?.kind === "walk" ? choice.handle : null;

    /** The stage for `look`, built once: a second ask while it is building waits on the same build. */
    const build = (look: Look): Promise<Stage | null> => {
      const known = builds.get(look);
      if (known) return known;
      const made = (async (): Promise<Stage | null> => {
        if (!scan) return null;
        const ok = await scan.ready;
        if (gone || !ok) return null;
        // The set's furniture is found in the scan's detailed mesh (fetched in a worker from the start): wait for it a while. Its corrections, meanwhile.
        const [, overrides] = await Promise.all([look === "set" ? detailIn(scan, DETAIL_WAIT_MS) : Promise.resolve(), loadOverrides(scan.modelId)]);
        if (gone) return null;
        const stage = look === "photo" ? scanStage(scan) : await planStage(scan, look === "set", overrides);
        if (!stage) return null;
        if (gone) {
          stage.dispose();
          return null;
        }
        stage.show(false);
        stage.resize();
        stages.set(look, stage);
        return stage;
      })();
      builds.set(look, made);
      return made;
    };

    /** While `stage` is hidden, its own building goes on in slices, and once done it draws one unseen frame so it shows at once. */
    const pump = (look: Look, stage: Stage) => {
      const id = ++pumping;
      const started = performance.now();
      // Each piece just after a frame of the stage showing, and the GPU given a rest three times the piece's own length
      // after it: the two stages share one GPU, and first person keeps its frame rate.
      const later = (rest: number) => setTimeout(() => requestAnimationFrame(() => setTimeout(() => void step(), 0)), Math.min(400, rest));
      const step = async () => {
        if (gone || id !== pumping || active === look || warmed.has(look)) return;
        const t = performance.now();
        const done = stage.idle ? stage.idle() : true;
        if (!done) return void later((performance.now() - t) * 3);
        warmed.add(look);
        const now = pose?.() ?? carry;
        await stage.warm?.(now?.walker.pos ?? { x: 0, y: 0 }, now?.yaw ?? 0);
        if (gone) return;
        // The photo view's panoramas round the player, fetched unseen (the Plan screen's warm-up).
        if (look === "photo" && scan) stopPrime = primeScan(scan, latest.current.run.playerNode);
        // Counts only.
        console.info(`First person built the ${look === "photo" ? "photo view" : "3D model"} behind the other in ${((performance.now() - started) / 1000).toFixed(1)} s`);
      };
      later(0);
    };

    // The looks a switch moves between; with `?scanlook=` in development, only the one asked for.
    const forced = scanLook("photo") !== "photo" || scanLook("set") !== "set";
    /** Once the stage showing has drawn, the scan's other stage is built behind it. */
    const prebuild = (shown: Look | "fixture") => {
      if (!scan || forced || shown === "fixture" || shown === "blockout") return;
      const other: Look = shown === "photo" ? "set" : "photo";
      if (builds.has(other)) return;
      void build(other).then((stage) => {
        if (stage && active !== other) pump(other, stage);
      });
    };

    /** Shows `look`: at once when its stage is built; else the build goes on (or starts), saying so, and shows it when done. */
    const choose = (look: Look) => {
      if (gone || !scan || active === look) return;
      wanted = look;
      const made = stages.get(look);
      if (made) return swap(look, made);
      // Off the stage showing, if any: the player waits for the one asked for.
      if (stopSession) carry = stopSession();
      stopSession = null;
      if (active !== null && active !== "fixture") stages.get(active)?.show(false);
      active = null;
      if (scan.status().phase === "ready") loading({ line: look === "photo" ? "Loading the building" : "Building the 3D model", held: 0, total: 0 });
      void build(look).then((stage) => {
        if (gone || wanted !== look) return;
        if (!stage) return unavailable();
        swap(look, stage);
      });
    };
    let wanted: Look = scanLook(lookChosen.current);

    // In development: what is built, and roughly what it holds on the GPU.
    const debug = process.env.NODE_ENV !== "production" ? (window as unknown as { __fpCache?: unknown; __fpMemory?: unknown }) : null;
    if (debug) {
      debug.__fpCache = () => ({ active, built: [...stages.keys()], building: [...builds.keys()].filter((k) => !stages.has(k)), set: warmed.has("set") ? "ready" : stages.has("set") ? "painting" : builds.has("set") ? "building" : "none", photo: stages.has("photo") ? "ready" : "none" });
      debug.__fpMemory = () => Object.fromEntries([...stages].map(([k, s]) => [k, s.memory?.()]));
    }

    if (world) {
      begin(fixtureStage(world));
    }
    if (choice?.kind === "wait") {
      // The preload's own module is still on its way: the scan comes as a new handle, which runs this again.
      loading({ line: "Opening the scan", held: 0, total: 0 });
    } else if (choice?.kind === "refuse") {
      unavailable(choice.line);
    } else if (scan) {
      scan.canvas.addEventListener("webglcontextlost", onLost);
      const phase = () => {
        const status = scan.status().phase;
        if (status !== "ready" && active === null) loading({ line: SCAN_PHASE[status] ?? "Loading the building", held: 0, total: 0 });
      };
      stopListening = scan.subscribe(phase);
      phase();
      switchLook.current = choose;
      choose(wanted);
    }

    return () => {
      gone = true;
      switchLook.current = null;
      stopPrime();
      stopListening();
      stopSession?.();
      for (const stage of stages.values()) stage.dispose();
      stages.clear();
      if (debug) {
        delete debug.__fpCache;
        delete debug.__fpMemory;
      }
      if (scan) {
        scan.canvas.removeEventListener("webglcontextlost", onLost);
        scan.canvas.remove();
      }
    };
  }, [world, placed, scanGiven, scanHandle, scanFailed]);

  // A switch between first person and the 3D model: the stage effect swaps stages, built once each, with no rebuild.
  useEffect(() => {
    lookChosen.current = chosenLook;
    switchLook.current?.(scanLook(chosenLook));
  }, [chosenLook]);

  const noun = objectiveNoun(placed.level.missionId);
  const moment = useMoment(placed, run);
  const over = run.status !== "playing";
  const end = useMemo(() => endState(placed, run), [placed, run]);
  // The run's end frees the mouse, so the Debrief is a click away.
  useEffect(() => {
    if (over && surface.current && document.pointerLockElement === surface.current) document.exitPointerLock();
  }, [over]);
  // What E does, in words (action.ts). Carrying is the objective line's chip (issue 192); the toast marks the take.
  const wordsFor = (doorId: string) => lockWords(lockOf(placed, doorId, lockKind));
  const action = over ? null : actionLabel(hud.prompt, hud.using, wordsFor, noun, moment?.kind === "door" ? moment : null);
  const said = over ? null : announcement(moment?.kind === "door" ? { kind: "door", doorId: moment.doorId } : moment ? { kind: "take" } : null, wordsFor, noun);
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
      {/* On a scan's set, a lens's soft vignette: the photographs' own falloff. */}
      {onScan ? <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.22)_100%)]" /> : null}
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
      {ready && action ? <ActionLabelView label={action} /> : null}
      {ready && !over && moment?.kind === "take" ? <PickupToast title={`${noun.charAt(0).toUpperCase()}${noun.slice(1)} collected`} line={moment.text.split(". ").slice(1).join(". ") || "Get to the exit."} /> : null}
      <ActionAnnouncer text={said} />
      {ready && !end ? <ControlsHint phase={hint.phase} ticks={hintTicks(hint.progress)} dragToLook={hud.refused} /> : null}

      <div className="pointer-events-none absolute inset-0 flex flex-col justify-end px-6 py-3">
        <div className="flex flex-col items-center gap-2">
          {!over && paused ? (
            <p data-testid="fp-paused" className="flex items-center gap-2 rounded-sm bg-surface-1 px-3 py-2 text-sm text-text-1 shadow-e-1">
              Paused. <Key>P</Key> to go on
            </p>
          ) : null}
          {over ? null : hud.prompt && hud.prompt.kind !== "pick" && hud.prompt.kind !== "take" ? (
            <p
              data-testid="fp-prompt"
              data-kind={hud.prompt.kind}
              data-using={hud.using ? "true" : undefined}
              className={cn(PROMPT, hud.prompt.kind === "exit" && "border border-success")}
            >
              {hud.prompt.kind === "far" ? "A locked door. Step up to it and hold E to open it." : exitPrompt(placed, hud.prompt.nodeId, noun)}
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
