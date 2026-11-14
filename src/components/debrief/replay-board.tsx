"use client";

import { useMemo } from "react";
import { cameraMount } from "@/components/run/board";
import { CameraPiece, DISC, Pawn, shortLabel } from "@/components/run/board-view";
import { frameOf, LABEL_FONT, pointsAttr, project, projectRect, roomLabelTransform, round, TILE_DEPTH, type Point } from "@/components/run/iso";
import type { PlacedLevel } from "@/level/placer";
import { objectiveLabel } from "@/lib/objective-noun";
import type { Frame } from "./debrief";

/** How far apart, in board units, pieces sharing a node stand (as on the run board). */
const SHARE_GAP = 36;

/**
 * The run replayed on the same isometric board (DESIGN.md, Debrief): the
 * player's path in the accent and every guard's path in a neutral line, each
 * drawn up to the frame being shown, with every piece standing where the log
 * puts it after that many turns. A camera's lens turns `--danger` on the
 * frame its sighting raised the alarm.
 */
export function ReplayBoard({
  placed,
  frames,
  frame,
  caught,
}: {
  placed: PlacedLevel;
  frames: readonly Frame[];
  /** The index into `frames` shown. */
  frame: number;
  /** The run ended caught: the last frame marks the player. */
  caught: boolean;
}) {
  const { floor } = placed.level;
  const view = useMemo(() => frameOf(floor), [floor]);
  const nodes = useMemo(() => new Map(floor.nodes.map((n) => [n.id, project(n.x, n.y)])), [floor]);
  const at = (id: string): Point => nodes.get(id)!;
  const now = frames[frame];
  const shown = frames.slice(0, frame + 1);
  const dedupe = (ids: string[]) => ids.filter((id, i) => i === 0 || id !== ids[i - 1]);
  const playerTrail = dedupe(shown.map((f) => f.player));
  const guardIds = frames[0].guards.map((g) => g.guardId);
  const guardTrails = guardIds.map((id) => ({
    id,
    nodes: dedupe(shown.map((f) => f.guards.find((g) => g.guardId === id)!.nodeId)),
  }));
  const exitNodes = new Set(placed.level.exits);
  const entryLabel = new Map(placed.entries.map((e) => [e.nodeId, e.label]));

  const pieces = [
    ...now.guards.map((g) => ({ kind: "guard" as const, id: g.guardId, nodeId: g.nodeId })),
    { kind: "player" as const, id: "player", nodeId: now.player },
  ]
    .map((piece, _, all) => {
      const here = all.filter((other) => other.nodeId === piece.nodeId);
      const shift = (here.indexOf(piece) - (here.length - 1) / 2) * SHARE_GAP;
      const p = at(piece.nodeId);
      return { ...piece, p: { x: p.x + shift, y: p.y } };
    })
    .sort((a, b) => a.p.y - b.p.y || a.id.localeCompare(b.id));

  return (
    <svg
      data-testid="replay-board"
      data-frame={now.turn}
      viewBox={`${round(view.minX)} ${round(view.minY)} ${round(view.width)} ${round(view.height)}`}
      preserveAspectRatio="xMidYMid meet"
      className="absolute inset-0 size-full select-none"
      role="img"
      aria-label={`Replay of the run, ${now.turn === 0 ? "at the start" : `after turn ${now.turn}`}`}
    >
      <g aria-hidden>
        {floor.rooms.map((room) => {
          const [back, right, front, left] = projectRect(room.rect);
          const down = (p: Point): Point => ({ x: p.x, y: p.y + TILE_DEPTH });
          return (
            <g key={room.id}>
              <polygon points={pointsAttr([left, front, down(front), down(left)])} style={{ fill: "var(--n-900)" }} />
              <polygon points={pointsAttr([front, right, down(right), down(front)])} style={{ fill: "var(--n-950)" }} />
              <polygon
                points={pointsAttr([back, right, front, left])}
                style={{ fill: "var(--n-850)", stroke: "var(--n-700)" }}
                strokeWidth="1"
                strokeLinejoin="round"
              />
            </g>
          );
        })}
      </g>

      <g aria-hidden className="font-mono" style={{ fill: "var(--text-3)" }} fontSize={LABEL_FONT} letterSpacing="0.06em">
        {floor.rooms.map((room) => {
          const text = shortLabel(room.label).toUpperCase();
          return (
            <text key={room.id} transform={roomLabelTransform(room.rect, text.length)}>
              {text}
            </text>
          );
        })}
      </g>

      <g aria-hidden>
        {floor.edges.map((edge) => {
          const a = at(edge.a);
          const b = at(edge.b);
          return (
            <line
              key={`${edge.a}-${edge.b}`}
              x1={round(a.x)}
              y1={round(a.y)}
              x2={round(b.x)}
              y2={round(b.y)}
              style={{ stroke: "var(--n-600)" }}
              strokeWidth="1.5"
            />
          );
        })}
      </g>

      <g aria-hidden>
        {floor.nodes.map((node) => {
          const p = at(node.id);
          const isObjective = node.id === placed.level.objective && !now.carrying;
          return (
            <g key={node.id}>
              <ellipse
                cx={round(p.x)}
                cy={round(p.y)}
                rx={DISC.rx}
                ry={DISC.ry}
                style={{ fill: "var(--n-700)", stroke: isObjective ? "var(--n-100)" : "var(--n-500)" }}
                strokeWidth={isObjective ? 2 : 1}
              />
              {isObjective || exitNodes.has(node.id) ? (
                <text
                  x={round(p.x)}
                  y={round(p.y + DISC.ry + 14)}
                  textAnchor="middle"
                  className="font-mono"
                  fontSize="11"
                  letterSpacing="0.06em"
                  style={{ fill: "var(--text-1)" }}
                >
                  {isObjective ? objectiveLabel(placed.level.missionId) : (entryLabel.get(node.id) ?? "EXIT").toUpperCase()}
                </text>
              ) : null}
            </g>
          );
        })}
      </g>

      {/* Every guard's path so far, then the player's on top. */}
      <g aria-hidden>
        {guardTrails
          .filter((t) => t.nodes.length > 1)
          .map((t) => (
            <polyline
              key={t.id}
              data-testid="guard-path"
              data-guard={t.id}
              data-nodes={t.nodes.join(" ")}
              points={pointsAttr(t.nodes.map(at))}
              fill="none"
              style={{ stroke: "var(--n-300)" }}
              strokeOpacity="0.55"
              strokeWidth="2"
              strokeDasharray="4 4"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
        {playerTrail.length > 1 ? (
          <polyline
            data-testid="player-path"
            data-nodes={playerTrail.join(" ")}
            points={pointsAttr(playerTrail.map(at))}
            fill="none"
            style={{ stroke: "var(--accent)" }}
            strokeOpacity="0.8"
            strokeWidth="3"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
      </g>

      {placed.cameras.map((camera) => {
        const mount = cameraMount(floor, camera.cover);
        return <CameraPiece key={camera.id} id={camera.id} at={project(mount.x, mount.y)} live={now.tripped === camera.id} />;
      })}

      {pieces.map((piece) =>
        piece.kind === "player" ? (
          <Pawn
            key="player"
            testId="player-piece"
            label="You"
            at={piece.p}
            nodeId={piece.nodeId}
            tone="player"
            carrying={now.carrying}
            caught={caught && frame === frames.length - 1}
          />
        ) : (
          <Pawn key={piece.id} testId="guard-piece" label={piece.id} at={piece.p} nodeId={piece.nodeId} tone="guard" />
        ),
      )}
    </svg>
  );
}
