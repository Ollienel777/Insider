"use client";
// A first-person spike on a real Matterport scan (epic #98). Not part of the
// product: it exists to tune how looking and walking feel before the scan view
// is built into the Run screen. See README.md beside this file.
//
// Open /spike?m=<a Matterport model id from the kit>. Click to lock the mouse
// and look, hold W to walk toward the blue ring, S, A and D step back and to
// the sides, N toggles the night filter. The keys in TUNE_KEYS change the feel
// while it runs. One guard walks the scan on a one-second clock. Nothing is
// stored and nothing leaves the page.
import { useEffect, useRef } from "react";
import { attachScanControls, bearingOf, DEFAULT_TUNING, pickTarget, stepMs, TUNING, type Tuning, type Vec3, type WalkIntent } from "./controls";

/* eslint-disable @typescript-eslint/no-explicit-any */
const TURN_MS = 1000; // the guard's clock
const HOP_METRES = 8; // hops longer than this are pruned
const NIGHT = "brightness(.42) contrast(1.3) saturate(.45) hue-rotate(185deg)";
/** Keys that change the feel while the sandbox runs: [key down, key up, the value, the step]. The HUD shows the values. */
const TUNE_KEYS: readonly (readonly [string, string, keyof Tuning, number])[] = [
  ["[", "]", "walkMetresPerSecond", 0.5],
  ["-", "=", "lookDegreesPerPixel", 0.02],
  [",", ".", "steerShare", 0.1],
  [";", "'", "bobPixels", 1],
];
/** `?speed=`, `?look=`, `?steer=` and `?bob=` set the same four values from the address. */
const TUNE_PARAMS: Record<string, keyof Tuning> = { speed: "walkMetresPerSecond", look: "lookDegreesPerPixel", steer: "steerShare", bob: "bobPixels" };
const GUARD_SVG =
  "<svg viewBox='0 0 40 100' width='100%' height='100%' preserveAspectRatio='none'>" +
  "<circle cx='20' cy='9' r='8' fill='#0b0f14' stroke='#ff5a4d' stroke-width='1.5'/>" +
  "<path d='M6 24 Q20 16 34 24 L31 62 L27 62 L26 98 L21 98 L20 66 L19 98 L14 98 L13 62 L9 62 Z' fill='#0b0f14' stroke='#ff5a4d' stroke-width='1.5'/></svg>";

export default function Spike() {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const w = window as any;
    if (w.__spikeStarted) return;
    w.__spikeStarted = true;
    const state: any = (w.__spike = { phase: "init", events: [], sweeps: null, pose: null, poseCount: 0, error: null, t0: performance.now() });
    const now = () => Math.round(performance.now() - state.t0);
    const modelId = new URLSearchParams(location.search).get("m");
    const key = process.env.NEXT_PUBLIC_MATTERPORT_SDK_KEY;
    const hud = hudRef.current!;
    if (!modelId || !key) {
      state.error = !modelId ? "Add ?m=<model id> to the address." : "NEXT_PUBLIC_MATTERPORT_SDK_KEY is not set in .env.local.";
      hud.textContent = state.error;
      return;
    }
    const iframe = frameRef.current!;
    const layer = layerRef.current!;
    const params = new URLSearchParams({ m: modelId, applicationKey: key, play: "1", qs: "1", title: "0" });
    const flat = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);
    const floorPoint = (sid: string): Vec3 => state.sweeps[sid].puckPosition ?? state.sweeps[sid].position;
    const hops = (sid: string): string[] =>
      (state.sweeps[sid]?.neighbors ?? []).filter((n: string) => state.sweeps[n] && flat(state.sweeps[sid].position, state.sweeps[n].position) <= HOP_METRES);
    const size = () => ({ w: innerWidth, h: innerHeight });

    (async () => {
      try {
        hud.textContent = "Loading the scan...";
        await new Promise<void>((res, rej) => {
          if (w.MP_SDK) return res();
          const s = document.createElement("script");
          s.src = "https://static.matterport.com/showcase-sdk/latest.js";
          s.onload = () => res();
          s.onerror = () => rej(new Error("The Matterport SDK script did not load."));
          document.head.appendChild(s);
        });
        const loaded = new Promise<void>((res) => iframe.addEventListener("load", () => res(), { once: true }));
        iframe.src = `https://my.matterport.com/show/?${params}`;
        await loaded;
        const sdk = await w.MP_SDK.connect(iframe, key, "3.10");
        state.sdk = sdk;
        state.phase = "connected";
        state.events.push({ t: now(), k: "connected" });
        sdk.App.state.subscribe((s: any) => {
          if (state.app !== s.phase) state.events.push({ t: now(), k: "app", v: s.phase });
          state.app = s.phase;
        });
        sdk.Sweep.data.subscribe({
          onCollectionUpdated(c: any) {
            state.sweeps = { ...c };
          },
        });
        sdk.Sweep.current.subscribe((s: any) => {
          const sid = s?.sid ?? s?.id ?? "";
          if (sid !== state.current) state.events.push({ t: now(), k: "sweep", v: sid });
          state.current = sid;
          if (sid) state.at = sid;
        });
        sdk.Camera.pose.subscribe((p: any) => {
          state.pose = p;
          state.poseCount++;
        });

        // ---- looking and walking: all of it is in controls.ts
        // With no intent this is the position W would walk to, which the blue ring marks.
        const target = (intent?: WalkIntent) => {
          if (!state.pose || !state.sweeps || !state.at) return null;
          const picked = pickTarget({
            pose: state.pose,
            hops: hops(state.at),
            floorPoint,
            heading: intent?.heading ?? 0,
            chained: intent?.chained ?? false,
            cameFrom: state.cameFrom ? floorPoint(state.cameFrom) : null,
            sticky: (intent?.heading ?? 0) === 0 ? state.aimed : null,
          });
          if ((intent?.heading ?? 0) === 0) state.aimed = picked;
          return picked;
        };
        const controls = attachScanControls({
          sdk,
          layer,
          target,
          // In the game this plays the engine's move and the camera follows. Here it flies the camera.
          step: async (sid) => {
            const metres = flat(state.sweeps[state.at].position, state.sweeps[sid].position);
            const ms = stepMs(metres);
            const started = performance.now();
            await sdk.Sweep.moveTo(sid, { transition: sdk.Sweep.Transition.FLY, transitionTime: ms });
            state.hopLog.push({ metres: +metres.toFixed(2), asked: ms, took: Math.round(performance.now() - started), t: now() });
            if (state.hopLog.length > 60) state.hopLog.shift();
            state.cameFrom = state.at;
            state.at = sid;
            state.aimed = null;
          },
          bearingTo: (sid) => (state.pose ? bearingOf(state.pose, floorPoint(sid)) : null),
          bob: layer.parentElement,
          onState: (s) => {
            state.controls = s;
            layer.style.cursor = s.locked ? "none" : "pointer";
          },
        });
        state.hopLog = [];
        for (const [name, key] of Object.entries(TUNE_PARAMS)) {
          const value = Number(new URLSearchParams(location.search).get(name));
          if (Number.isFinite(value) && value > 0) (TUNING[key] as number) = value;
        }
        window.addEventListener("keydown", (e) => {
          if (e.key === "n" || e.key === "N") iframe.style.filter = iframe.style.filter ? "" : NIGHT;
          if (e.key === "0") Object.assign(TUNING, DEFAULT_TUNING);
          for (const [less, more, key, by] of TUNE_KEYS) {
            if (e.key !== less && e.key !== more) continue;
            (TUNING[key] as number) = Math.max(0, +((TUNING[key] as number) + (e.key === more ? by : -by)).toFixed(2));
          }
        });

        // ---- one guard on a clock
        const guard: any = { from: null, to: null, t: 0 };
        setInterval(() => {
          if (!state.sweeps || !state.at) return;
          const ids = Object.keys(state.sweeps);
          if (!guard.to) guard.to = ids.find((id) => id !== state.at) ?? ids[0];
          const options = hops(guard.to).filter((n) => n !== guard.from);
          const next = options.length ? options[Math.floor(Math.random() * options.length)] : (guard.from ?? guard.to);
          guard.from = guard.to;
          guard.to = next;
          guard.t = performance.now();
        }, TURN_MS);

        // ---- the overlay, redrawn from the camera pose
        const ringEls = new Map<string, HTMLDivElement>();
        const guardEl = document.createElement("div");
        guardEl.innerHTML = GUARD_SVG;
        guardEl.style.cssText = "position:absolute;display:none";
        layer.appendChild(guardEl);
        const draw = () => {
          requestAnimationFrame(draw);
          const p = state.pose;
          if (!p || !state.sweeps || !state.at) return;
          const view = size();
          const legal = new Set(hops(state.at));
          const aimed = target();
          for (const id of Object.keys(state.sweeps)) {
            let el = ringEls.get(id);
            if (!el) {
              el = document.createElement("div");
              el.style.cssText = "position:absolute;border-radius:50%;box-sizing:border-box;display:none";
              layer.appendChild(el);
              ringEls.set(id, el);
            }
            if (!legal.has(id) || controls.moving) {
              el.style.display = "none";
              continue;
            }
            const puck = floorPoint(id);
            const r = sdk.Conversion.worldToScreen(puck, p, view);
            const d = Math.hypot(puck.x - p.position.x, puck.z - p.position.z);
            const inView = r.x >= 0 && r.x <= view.w && r.y >= 0 && r.y <= view.h && d > 0.3;
            if (!inView) {
              el.style.display = "none";
              continue;
            }
            const width = Math.min(160, 420 / d);
            const height = Math.max(6, width * Math.min(1, 1.5 / d));
            el.style.display = "block";
            el.style.width = `${width}px`;
            el.style.height = `${height}px`;
            el.style.left = `${r.x - width / 2}px`;
            el.style.top = `${r.y - height / 2}px`;
            el.style.border = id === aimed ? "3px solid #7fd4ff" : "2px solid rgba(255,255,255,.45)";
          }

          if (guard.from && guard.to) {
            const a = floorPoint(guard.from);
            const b = floorPoint(guard.to);
            const k = Math.min(1, (performance.now() - guard.t) / TURN_MS);
            const foot = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
            const lo = sdk.Conversion.worldToScreen(foot, p, view);
            const hi = sdk.Conversion.worldToScreen({ x: foot.x, y: foot.y + 1.8, z: foot.z }, p, view);
            const h = lo.y - hi.y;
            if (h > 6 && h < view.h * 2 && lo.x > -80 && lo.x < view.w + 80) {
              guardEl.style.display = "block";
              guardEl.style.height = `${h}px`;
              guardEl.style.width = `${h * 0.4}px`;
              guardEl.style.left = `${lo.x - h * 0.2}px`;
              guardEl.style.top = `${hi.y}px`;
            } else guardEl.style.display = "none";
          }
          const look = controls.locked ? "Mouse: look (Esc lets go)" : "Click: lock the mouse to look (or drag)";
          const hint = controls.blocked ? " | nothing that way: turn until a ring is blue" : aimed ? "" : " | turn until a ring is blue";
          const tune = TUNE_KEYS.map(([less, more, key]) => `${less}${more} ${key} ${TUNING[key]}`).join(" | ");
          hud.textContent = `${look} | W: walk to the blue ring | S A D: step back, left, right | Q E: turn | N: night${hint}\n${tune} | 0: reset | ${Object.keys(state.sweeps).length} positions, ${legal.size} hops from here | the guard is not hidden by walls yet`;
        };
        iframe.style.filter = NIGHT;
        requestAnimationFrame(draw);
      } catch (e: any) {
        state.error = String(e?.message ?? e);
        hud.textContent = state.error;
      }
    })();
  }, []);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "black" }}>
      {/* The player and the layer over it share one box, so the footstep dip moves both and the overlay stays on the scan. */}
      <div style={{ position: "absolute", inset: 0 }}>
        <iframe ref={frameRef} id="spike-frame" title="scan" allow="xr-spatial-tracking; fullscreen" tabIndex={-1} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }} />
        <div ref={layerRef} id="spike-overlay" style={{ position: "absolute", inset: 0, cursor: "pointer", userSelect: "none", touchAction: "none" }} />
      </div>
      <div ref={hudRef} style={{ position: "absolute", left: 16, top: 12, right: 16, font: "600 13px system-ui", color: "white", pointerEvents: "none", textShadow: "0 1px 3px black", whiteSpace: "pre-line" }} />
    </div>
  );
}
