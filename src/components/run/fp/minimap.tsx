"use client";

// The corner map in first person (issue 115): the floor from above, north up,
// with the player and the way they face, the objective, the exits, the guards
// and cameras, the doors still locked, and the route the plan sends the player
// on next (waypoint.ts). The rooms, the pieces and the route change with the
// run, a turn at a time; the player's arrow moves every frame, read from
// `pose`, which the view writes and this map's own animation frame reads.
// On a fixture floor it draws world.ts's rooms; on a scan, which has no room
// walls of ours, it draws the engine's walkable edges through each doorway.
import { useEffect, useMemo, useRef } from "react";
import type { RunState } from "@/engine";
import { cn } from "@/lib/utils";
import { roomName } from "../board";
import type { Ground, Vec } from "./ground";
import type { Waypoint } from "./waypoint";
import type { World } from "./world";

/** Where the player stands, in metres, and the way they face (the view's yaw). */
export interface Pose {
  x: number;
  y: number;
  yaw: number;
}

/** The map's width in pixels; its height follows the floor's shape, up to `MAX_H`. */
const MAX_W = 216;
const MAX_H = 176;

/** The floor's extent in metres: the world's own, or round the ground's nodes. */
function boundsOf(world: World | null, ground: Ground): { x: number; y: number; w: number; h: number } {
  if (world) return world.bounds;
  const xs = [...ground.nodes.values()].map((n) => n.x);
  const ys = [...ground.nodes.values()].map((n) => n.y);
  if (xs.length === 0) return { x: 0, y: 0, w: 1, h: 1 };
  const pad = 1.5;
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return { x, y, w: Math.max(1, Math.max(...xs) + pad - x), h: Math.max(1, Math.max(...ys) + pad - y) };
}

/** The route's points in metres: through each edge's doorway, from the player's node to the goal. */
export function routePoints(ground: Ground, route: readonly string[]): Vec[] {
  if (route.length === 0) return [];
  const first = ground.nodes.get(route[0]);
  const out: Vec[] = first ? [{ x: first.x, y: first.y }] : [];
  for (let i = 1; i < route.length; i++) out.push(...ground.path(route[i - 1], route[i]).slice(1));
  return out;
}

export function Minimap({
  world,
  ground,
  run,
  cameras,
  waypoint,
  pose,
  className,
}: {
  /** The fixture floor's rooms; null on a scan. */
  world: World | null;
  ground: Ground;
  run: RunState;
  /** Each camera's mount, in metres. */
  cameras: readonly { id: string; mount: Vec }[];
  waypoint: Waypoint | null;
  pose: { readonly current: Pose | null };
  className?: string;
}) {
  const bounds = useMemo(() => boundsOf(world, ground), [world, ground]);
  const s = Math.min(MAX_W / bounds.w, MAX_H / bounds.h);
  const w = Math.round(bounds.w * s);
  const h = Math.round(bounds.h * s);
  const px = (p: Vec) => `${((p.x - bounds.x) * s).toFixed(1)},${((p.y - bounds.y) * s).toFixed(1)}`;
  const arrow = useRef<SVGGElement>(null);

  useEffect(() => {
    let raf = 0;
    let last = "";
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const at = pose.current;
      const el = arrow.current;
      if (!at || !el) return;
      const t = `translate(${px(at)}) rotate(${((at.yaw * 180) / Math.PI).toFixed(1)})`;
      if (t === last) return;
      last = t;
      el.setAttribute("transform", t);
      el.removeAttribute("visibility");
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // `px` only changes with the world, which `s` and `bounds` stand for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pose, s, bounds.x, bounds.y]);

  const here = ground.nodes.get(run.playerNode);
  const hereRoom = here ? world?.nodes.get(run.playerNode)?.roomId : undefined;
  const route = useMemo(() => (waypoint ? routePoints(ground, waypoint.route) : []), [ground, waypoint]);
  const objective = ground.nodes.get(run.board.level.objective);
  const hunting = run.alarm === "alert" || run.alarm === "lockdown";
  const doors = ground.doors.filter((d) => run.locked.includes(d.doorId));
  // Without rooms of ours (a scan), the floor is drawn as its walkable edges, each once.
  const halls = useMemo(() => {
    if (world) return [];
    const out: { key: string; points: Vec[] }[] = [];
    for (const [from, exits] of run.board.adjacency) {
      for (const e of exits) if (from < e.to) out.push({ key: `${from}-${e.to}`, points: ground.path(from, e.to) });
    }
    return out;
  }, [world, ground, run.board]);

  return (
    <div
      data-testid="fp-minimap"
      data-room={hereRoom}
      data-waypoint={waypoint ? waypoint.route[waypoint.route.length - 1] : undefined}
      aria-label={`Map: you're in the ${roomName(run.board.level.floor, run.playerNode)}`}
      role="img"
      className={cn("pointer-events-none flex flex-col gap-1 rounded-sm bg-surface-1/90 p-2 shadow-e-1", className)}
    >
      <p className="flex items-center justify-between gap-3 font-mono text-xs uppercase tracking-[0.06em] text-text-2">
        <span data-testid="fp-minimap-room" className="truncate text-text-1">
          {roomName(run.board.level.floor, run.playerNode)}
        </span>
        <span aria-hidden className="text-text-3">N ↑</span>
      </p>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="block">
        {halls.map((hall) => (
          <polyline key={hall.key} points={hall.points.map(px).join(" ")} fill="none" stroke="var(--surface-3)" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {(world?.rooms ?? []).map((room) => (
          <rect
            key={room.id}
            x={(room.outer.x - bounds.x) * s}
            y={(room.outer.y - bounds.y) * s}
            width={room.outer.w * s}
            height={room.outer.h * s}
            fill={room.id === hereRoom ? "var(--surface-3)" : "var(--surface-2)"}
            stroke="var(--border-strong)"
            strokeWidth={1}
          />
        ))}
        {doors.map((o) => (
          <line
            key={o.doorId}
            data-door={o.doorId}
            x1={(o.bar.a.x - bounds.x) * s}
            y1={(o.bar.a.y - bounds.y) * s}
            x2={(o.bar.b.x - bounds.x) * s}
            y2={(o.bar.b.y - bounds.y) * s}
            stroke="var(--warning)"
            strokeWidth={3}
          />
        ))}
        {route.length > 1 ? (
          <polyline
            data-testid="fp-minimap-route"
            points={route.map(px).join(" ")}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
            strokeDasharray="4 3"
            strokeLinejoin="round"
          />
        ) : null}
        {run.board.level.exits.map((id) => {
          const n = ground.nodes.get(id);
          return n ? (
            <g key={id} data-exit={id} transform={`translate(${px(n)})`}>
              <rect x={-5} y={-5} width={10} height={10} fill="none" stroke="var(--success)" strokeWidth={1.5} />
              <path d="M-2 -2.5 L2.5 0 L-2 2.5" fill="none" stroke="var(--success)" strokeWidth={1.5} />
            </g>
          ) : null;
        })}
        {objective && !run.carrying ? (
          <path data-testid="fp-minimap-objective" transform={`translate(${px(objective)})`} d="M0 -6 L6 0 L0 6 L-6 0 Z" fill="var(--n-100)" stroke="var(--surface-0)" />
        ) : null}
        {cameras.map((c) => (
          <rect key={c.id} data-camera={c.id} x={(c.mount.x - bounds.x) * s - 2.5} y={(c.mount.y - bounds.y) * s - 2.5} width={5} height={5} fill="var(--text-2)" />
        ))}
        {[...run.cleaners, ...run.guards].map((g) => {
          const n = ground.nodes.get(g.nodeId);
          const guard = run.guards.includes(g);
          const chasing = guard && (g.target !== null || hunting);
          return n ? (
            <circle
              key={g.id}
              data-guard={g.id}
              data-chasing={chasing ? "true" : undefined}
              cx={(n.x - bounds.x) * s}
              cy={(n.y - bounds.y) * s}
              r={guard ? 4 : 3}
              fill={chasing ? "var(--danger)" : guard ? "var(--text-1)" : "var(--text-3)"}
              stroke="var(--surface-0)"
            />
          ) : null;
        })}
        {/* Hidden until the view has said where the player stands. */}
        <g ref={arrow} data-testid="fp-minimap-player" visibility="hidden" transform={here ? `translate(${px(here)})` : undefined}>
          <path d="M8 0 L-5 -5 L-2 0 L-5 5 Z" fill="var(--accent)" stroke="var(--surface-0)" strokeWidth={1} />
        </g>
      </svg>
      <p aria-hidden className="flex items-center gap-3 font-mono text-xs uppercase tracking-[0.06em] text-text-3">
        <span className="flex items-center gap-1"><span className="inline-block size-2 rotate-45 bg-n-100" />objective</span>
        <span className="flex items-center gap-1"><span className="inline-block size-2 border border-success" />exit</span>
        <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full bg-text-1" />guard</span>
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-3 bg-accent" />plan</span>
      </p>
    </div>
  );
}
