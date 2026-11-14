"use client";

import { useMemo } from "react";
import type { Detector } from "@/domain";
import type { OwnerSetup } from "@/domain/owner-setup";
import { createRun, type RunState } from "@/engine";
import { cameraMount } from "@/components/run/board";
import { BoardView, type GhostPlan } from "@/components/run/board-view";
import { frameOf, project, round, type Point } from "@/components/run/iso";
import type { PlacedLevel } from "@/level/placer";

/** What the editor has picked on the board. */
export type Selection =
  | { kind: "guard"; id: string }
  | { kind: "camera"; id: string }
  | { kind: "door"; id: string }
  | { kind: "desk"; id: string }
  | null;

export interface EditLayer {
  setup: OwnerSetup;
  selection: Selection;
  /** Nodes take a click (placing, moving or drawing a round): every node shows a faint ring. */
  picking: boolean;
  /** Element roles (`guard:G1`) with a problem: drawn with a `--danger` ring. */
  problems: ReadonlySet<string>;
  onNode: (nodeId: string) => void;
  onCamera: (id: string) => void;
  onDoor: (doorId: string) => void;
}

export interface ResultLayer {
  /** The commonest way the crew got out, from the entry. */
  route: readonly string[] | null;
  /** The element that noticed the crew first most often. */
  detector: Detector | null;
}

/** A node's tap target, in board units (wider than its disc). */
const HIT = { rx: 18, ry: 11 };

/**
 * The Owner screen's board: the run board itself (BoardView) showing the
 * setup as a fresh run would start, with a layer over it for editing (every
 * node, camera and door takes a click; the selected guard's round is drawn)
 * or for the batch's results (the commonest way out as the ghost path, the
 * element that noticed the crew most often ringed in `--danger`). The layer
 * takes every pointer event, so the board's own Why cards stay shut: an
 * owner's element has no data layer to explain.
 */
export function OwnerBoard({
  placed,
  edit,
  result,
  testId = "owner-board",
}: {
  placed: PlacedLevel;
  edit?: EditLayer;
  result?: ResultLayer;
  testId?: string;
}) {
  const run = useMemo<RunState>(() => createRun(placed.level), [placed]);
  const { floor } = placed.level;
  const frame = useMemo(() => frameOf(floor), [floor]);
  const at = (id: string): Point => {
    const n = floor.nodes.find((x) => x.id === id)!;
    return project(n.x, n.y);
  };
  const mountOf = (id: string): Point | null => {
    const camera = placed.level.cameras?.find((c) => c.id === id);
    if (!camera) return null;
    const m = cameraMount(floor, camera.cover);
    return project(m.x, m.y);
  };
  const doorMid = (doorId: string): Point | null => {
    const edge = floor.edges.find((e) => e.door?.id === doorId);
    if (!edge) return null;
    const a = at(edge.a);
    const b = at(edge.b);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  const ghost: GhostPlan | null = result?.route && result.route.length > 1 ? { path: result.route, marks: [] } : null;

  const detectorAt = ((): Point | null => {
    const d = result?.detector;
    if (!d?.id) return null;
    if (d.kind === "camera") return mountOf(d.id);
    const walker = [...run.guards, ...run.cleaners].find((g) => g.id === d.id);
    return walker ? at(walker.nodeId) : null;
  })();

  const setup = edit?.setup;
  const selectedGuard = edit?.selection?.kind === "guard" ? setup?.guards.find((g) => g.id === edit.selection!.id) : undefined;
  const selectedCamera = edit?.selection?.kind === "camera" ? placed.level.cameras?.find((c) => c.id === edit.selection!.id) : undefined;
  const lockable = floor.edges.filter((e) => e.door?.lockable).map((e) => e.door!.id);

  return (
    <div className="absolute inset-0" data-testid={testId}>
      <BoardView placed={placed} run={run} choices={[]} onChoose={() => {}} ghost={ghost} testId={`${testId}-run`} />
      <svg
        data-testid={`${testId}-layer`}
        viewBox={`${round(frame.minX)} ${round(frame.minY)} ${round(frame.width)} ${round(frame.height)}`}
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 size-full select-none"
        role="group"
        aria-label={edit ? "Edit the setup on the floor plan" : "The batch on the floor plan"}
      >
        {/* Takes every click the layer's own targets do not, so the board's Why cards stay shut. */}
        <rect x={frame.minX} y={frame.minY} width={frame.width} height={frame.height} fill="transparent" />

        {result && detectorAt ? (
          <g data-testid="owner-detector-ring" data-detector={`${result.detector!.kind}:${result.detector!.id}`} pointerEvents="none">
            <ellipse cx={detectorAt.x} cy={detectorAt.y - 10} rx={26} ry={18} fill="none" style={{ stroke: "var(--danger)" }} strokeWidth={2} />
          </g>
        ) : null}

        {edit && selectedCamera ? (
          <g pointerEvents="none" data-testid="owner-camera-cover">
            {selectedCamera.cover.map((id) => {
              const p = at(id);
              return <ellipse key={id} cx={p.x} cy={p.y} rx={16} ry={9} fill="none" style={{ stroke: "var(--accent)" }} strokeDasharray="3 3" strokeWidth={1.5} />;
            })}
          </g>
        ) : null}

        {edit && selectedGuard && selectedGuard.round.length > 0 ? (
          <g pointerEvents="none" data-testid="owner-round" data-nodes={selectedGuard.round.join(" ")}>
            <polyline
              points={[...selectedGuard.round, ...(selectedGuard.round.length > 2 ? [selectedGuard.round[0]] : [])]
                .map((id) => {
                  const p = at(id);
                  return `${round(p.x)},${round(p.y)}`;
                })
                .join(" ")}
              fill="none"
              style={{ stroke: "var(--accent)" }}
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={0.8}
            />
          </g>
        ) : null}

        {edit ? (
          <>
            {/* Desks: a small square on the node. */}
            {edit.setup.desks.map((nodeId) => {
              const p = at(nodeId);
              const selected = edit.selection?.kind === "desk" && edit.selection.id === nodeId;
              const bad = edit.problems.has(`desk:${nodeId}`);
              return (
                <g key={`desk-${nodeId}`} pointerEvents="none" data-testid="owner-desk" data-node={nodeId}>
                  <rect
                    x={p.x - 7}
                    y={p.y - 20}
                    width={14}
                    height={10}
                    rx={2}
                    style={{ fill: "var(--n-200)", stroke: bad ? "var(--danger)" : selected ? "var(--accent)" : "var(--n-950)" }}
                    strokeWidth={selected || bad ? 2 : 1}
                  />
                </g>
              );
            })}

            {/* Nodes: every one takes a click. */}
            {floor.nodes.map((node) => {
              const p = project(node.x, node.y);
              return (
                <ellipse
                  key={node.id}
                  data-owner-node={node.id}
                  role="button"
                  aria-label={`Node ${node.id}`}
                  tabIndex={-1}
                  cx={p.x}
                  cy={p.y}
                  rx={HIT.rx}
                  ry={HIT.ry}
                  className="cursor-pointer [&:hover]:[stroke:var(--text-2)]"
                  style={{ fill: "transparent", stroke: edit.picking ? "var(--n-500)" : "transparent" }}
                  strokeWidth={1}
                  strokeDasharray={edit.picking ? "2 3" : undefined}
                  onClick={() => edit.onNode(node.id)}
                />
              );
            })}

            {/* The guards on their posts, and each problem ringed. */}
            {edit.setup.guards.map((g) => {
              const selected = edit.selection?.kind === "guard" && edit.selection.id === g.id;
              const bad = edit.problems.has(`guard:${g.id}`);
              if (!selected && !bad) return null;
              const node = floor.nodes.find((n) => n.id === g.post);
              if (!node) return null;
              const p = project(node.x, node.y);
              return (
                <ellipse
                  key={`ring-${g.id}`}
                  data-testid={selected ? "owner-selected-ring" : "owner-problem-ring"}
                  cx={p.x}
                  cy={p.y - 8}
                  rx={22}
                  ry={16}
                  fill="none"
                  pointerEvents="none"
                  style={{ stroke: bad ? "var(--danger)" : "var(--accent)" }}
                  strokeWidth={2}
                />
              );
            })}

            {/* Cameras: their mount on the wall. */}
            {(placed.level.cameras ?? []).map((c) => {
              const p = mountOf(c.id)!;
              const selected = edit.selection?.kind === "camera" && edit.selection.id === c.id;
              return (
                <ellipse
                  key={`cam-${c.id}`}
                  data-owner-camera={c.id}
                  role="button"
                  aria-label={`Camera ${c.id}`}
                  tabIndex={-1}
                  cx={p.x}
                  cy={p.y - 10}
                  rx={16}
                  ry={14}
                  className="cursor-pointer"
                  style={{ fill: "transparent", stroke: selected ? "var(--accent)" : "transparent" }}
                  strokeWidth={2}
                  onClick={() => edit.onCamera(c.id)}
                />
              );
            })}

            {/* Lockable doors: a badge with what closes it. */}
            {lockable.map((doorId) => {
              const p = doorMid(doorId);
              if (!p) return null;
              const lock = edit.setup.doors[doorId] ?? "open";
              const selected = edit.selection?.kind === "door" && edit.selection.id === doorId;
              const bad = edit.problems.has(`door:${doorId}`);
              return (
                <g
                  key={`door-${doorId}`}
                  data-owner-door={doorId}
                  data-lock={lock}
                  role="button"
                  aria-label={`Door ${doorId}: ${lock}`}
                  tabIndex={-1}
                  className="cursor-pointer"
                  onClick={() => edit.onDoor(doorId)}
                >
                  <rect
                    x={p.x - 9}
                    y={p.y - 8}
                    width={18}
                    height={16}
                    rx={3}
                    style={{
                      fill: lock === "open" ? "var(--n-900)" : "var(--n-700)",
                      stroke: bad ? "var(--danger)" : selected ? "var(--accent)" : "var(--n-500)",
                    }}
                    strokeWidth={selected || bad ? 2 : 1}
                    strokeDasharray={lock === "open" ? "2 2" : undefined}
                  />
                  <text
                    x={p.x}
                    y={p.y + 3.5}
                    textAnchor="middle"
                    className="font-mono"
                    fontSize={10}
                    style={{ fill: lock === "open" ? "var(--text-3)" : "var(--text-1)" }}
                    pointerEvents="none"
                  >
                    {lock === "key" ? "K" : lock === "badge" ? "B" : "–"}
                  </text>
                </g>
              );
            })}
          </>
        ) : null}
      </svg>
    </div>
  );
}
