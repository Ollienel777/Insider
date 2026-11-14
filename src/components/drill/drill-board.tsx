"use client";

import { useMemo } from "react";
import { frameOf, LABEL_FONT, pointsAttr, project, projectRect, round, roomLabelTransform, TILE_DEPTH, type Point } from "@/components/run/iso";
import type { FloorGraph } from "@/domain";
import type { DrillReport } from "@/drill";
import { jitterOf, positionAt } from "./playback";

/**
 * The drill view (DESIGN.md, Drill): the run board's isometric floor in a
 * cooler treatment. Occupants are small `--n-200` dots that flow along their
 * routes to the open stairs; the blocked stair is struck through in
 * `--danger` and carries the report's own label; warden posts are numbered
 * diamonds; the bottleneck is a dashed ring.
 */
export function DrillBoard({ floor, report, simS }: { floor: FloorGraph; report: DrillReport; simS: number }) {
  const frame = useMemo(() => frameOf(floor), [floor]);
  const nodes = useMemo(() => new Map(floor.nodes.map((n) => [n.id, n])), [floor]);
  const at = (id: string): Point => {
    const n = nodes.get(id)!;
    return project(n.x, n.y);
  };
  const blocked = report.scenario.blockedStair;
  // Occupants with no route to an open stair: never walking, drawn where they stand for the whole drill.
  const cutOff = report.occupants.filter((o) => o.stair === null);
  const walking = report.occupants.length - cutOff.length;
  const cutOffNote = cutOff.length > 0 ? `, ${cutOff.length} cut off where they stand` : "";
  const stairNodes = floor.nodes.filter((n) => n.tags.includes("stair"));
  const stairRooms = new Set(stairNodes.map((n) => n.roomId));
  const blockedRoom = blocked ? nodes.get(blocked.nodeId)?.roomId : undefined;

  // Every leg someone walks, once: the flows to the open stairs.
  const legs = useMemo(() => {
    const seen = new Map<string, [string, string]>();
    for (const o of report.occupants) {
      for (let i = 1; i < o.path.length; i++) {
        const [a, b] = [o.path[i - 1], o.path[i]].sort();
        seen.set(`${a}|${b}`, [a, b]);
      }
    }
    return [...seen.values()];
  }, [report]);

  const inStair = new Map<string, number>();
  for (const o of report.occupants) {
    if (o.stair && o.clearedAtS !== null && o.clearedAtS <= simS) inStair.set(o.stair, (inStair.get(o.stair) ?? 0) + 1);
  }
  const headingFor = new Map<string, number>();
  for (const o of report.occupants) if (o.stair) headingFor.set(o.stair, (headingFor.get(o.stair) ?? 0) + 1);

  return (
    <svg
      data-testid="drill-board"
      data-sim-s={Math.floor(simS)}
      viewBox={`${round(frame.minX)} ${round(frame.minY)} ${round(frame.width)} ${round(frame.height)}`}
      preserveAspectRatio="xMidYMid meet"
      className="absolute inset-0 size-full select-none"
      role="img"
      aria-label={
        blocked
          ? `Floor plan: ${walking} occupants walking to the open stairs, ${blocked.label} blocked${cutOffNote}`
          : `Floor plan: ${walking} occupants walking to the stairs${cutOffNote}`
      }
    >
      {/* Rooms: low tiles, darker than the run board; stairs a step lighter. */}
      <g aria-hidden>
        {floor.rooms.map((room) => {
          const [back, right, front, left] = projectRect(room.rect);
          const down = (p: Point): Point => ({ x: p.x, y: p.y + TILE_DEPTH });
          const stair = stairRooms.has(room.id);
          const isBlocked = room.id === blockedRoom;
          return (
            <g key={room.id} data-room={room.id}>
              <polygon points={pointsAttr([left, front, down(front), down(left)])} style={{ fill: "var(--n-900)" }} />
              <polygon points={pointsAttr([front, right, down(right), down(front)])} style={{ fill: "var(--n-950)" }} />
              <polygon
                points={pointsAttr([back, right, front, left])}
                style={{
                  fill: stair ? "var(--n-800)" : "var(--n-900)",
                  stroke: isBlocked ? "var(--danger)" : stair ? "var(--n-500)" : "var(--n-700)",
                }}
                strokeWidth={isBlocked ? 2 : 1}
                strokeLinejoin="round"
              />
            </g>
          );
        })}
      </g>

      <g aria-hidden className="font-mono" style={{ fill: "var(--text-3)" }} fontSize={LABEL_FONT} letterSpacing="0.06em">
        {floor.rooms
          .filter((room) => !stairRooms.has(room.id))
          .map((room) => {
            const text = room.label.replace(/\s*\(.*\)$/, "").toUpperCase();
            return (
              <text key={room.id} transform={roomLabelTransform(room.rect, text.length)}>
                {text}
              </text>
            );
          })}
      </g>

      {/* The board's edges, faint, and the routes people take over them. */}
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
              style={{ stroke: "var(--n-700)" }}
              strokeWidth="1"
            />
          );
        })}
        {legs.map(([a, b]) => {
          const p = at(a);
          const q = at(b);
          return (
            <line
              key={`${a}|${b}`}
              data-testid="drill-route"
              x1={round(p.x)}
              y1={round(p.y)}
              x2={round(q.x)}
              y2={round(q.y)}
              style={{ stroke: "var(--n-400)" }}
              strokeOpacity="0.55"
              strokeWidth="2"
              strokeLinecap="round"
            />
          );
        })}
      </g>

      {/* The bottleneck: where the most time was spent queued. */}
      {report.bottleneck ? (
        <BottleneckMark at={at(report.bottleneck.nodeId)} nodeId={report.bottleneck.nodeId} />
      ) : null}

      {/* Warden posts, numbered as in the panel. */}
      {report.wardenPosts.map((post, i) => {
        const p = at(post.nodeId);
        return (
          <g
            key={`${post.roomId}>${post.nodeId}`}
            data-testid="warden-mark"
            data-node={post.nodeId}
            aria-hidden
            transform={`translate(${round(p.x)}, ${round(p.y)})`}
          >
            <path d="M 0 -9 L 9 0 L 0 9 L -9 0 Z" style={{ fill: "var(--n-950)", stroke: "var(--n-100)" }} strokeWidth="1.5" />
            <text
              x="13"
              y="-8"
              className="font-mono"
              fontSize="11"
              fontWeight="500"
              letterSpacing="0.06em"
              paintOrder="stroke"
              strokeWidth="4"
              strokeLinejoin="round"
              style={{ fill: "var(--text-1)", stroke: "var(--n-950)" }}
            >
              {`W${i + 1}`}
            </text>
          </g>
        );
      })}

      {/* Stairs: the open ones count people in; the blocked one is struck through. */}
      {stairNodes.map((node) => {
        const room = floor.rooms.find((r) => r.id === node.roomId);
        const p = project(node.x, node.y);
        if (blocked && node.id === blocked.nodeId) {
          return <BlockedStair key={node.id} at={p} label={blocked.label} nodeId={node.id} />;
        }
        const heading = headingFor.get(node.id) ?? 0;
        return (
          <OpenStair
            key={node.id}
            at={p}
            nodeId={node.id}
            label={room?.label ?? node.id}
            count={heading > 0 ? `${inStair.get(node.id) ?? 0}/${heading}` : null}
          />
        );
      })}

      {/* Occupants who cannot reach an open stair, at their start, in danger red. */}
      <g data-testid="cut-off" aria-hidden>
        {cutOff.map((o) => {
          const p = at(o.startNode);
          const j = jitterOf(o.id);
          return (
            <circle
              key={o.id}
              data-testid="cut-off-occupant"
              data-id={o.id}
              cx={round(p.x + j.dx)}
              cy={round(p.y + j.dy)}
              r="5"
              style={{ fill: "var(--danger)", stroke: "var(--n-950)" }}
              strokeWidth="1"
            />
          );
        })}
      </g>

      {/* The occupants. */}
      <g data-testid="occupants" aria-hidden>
        {report.occupants.map((o) => {
          const pos = positionAt(o, simS);
          if (!pos) return null;
          const p = project(pos.x, pos.y);
          const j = jitterOf(o.id);
          return (
            <circle
              key={o.id}
              data-testid="occupant"
              data-id={o.id}
              cx={round(p.x + j.dx)}
              cy={round(p.y + j.dy)}
              r="5"
              style={{ fill: "var(--n-200)", stroke: "var(--n-950)" }}
              strokeWidth="1"
            />
          );
        })}
      </g>
    </svg>
  );
}

function OpenStair({ at, nodeId, label, count }: { at: Point; nodeId: string; label: string; count: string | null }) {
  return (
    <g data-testid="open-stair" data-node={nodeId} aria-hidden transform={`translate(${round(at.x)}, ${round(at.y)})`}>
      <ellipse rx="15" ry="8.5" style={{ fill: "var(--n-700)", stroke: "var(--n-300)" }} strokeWidth="1.5" />
      <StairText y={-20} fill="var(--text-1)">
        {label.toUpperCase()}
      </StairText>
      {count ? (
        <StairText y={26} fill="var(--text-2)" testId="stair-count">
          {`${count} IN`}
        </StairText>
      ) : null}
    </g>
  );
}

function BlockedStair({ at, label, nodeId }: { at: Point; label: string; nodeId: string }) {
  const text = label.toUpperCase();
  const half = text.length * 3.6;
  return (
    <g data-testid="blocked-stair" data-node={nodeId} data-label={label} aria-hidden transform={`translate(${round(at.x)}, ${round(at.y)})`}>
      <ellipse rx="15" ry="8.5" style={{ fill: "var(--n-950)", stroke: "var(--danger)" }} strokeWidth="2" />
      <line x1="-11" y1="-6" x2="11" y2="6" style={{ stroke: "var(--danger)" }} strokeWidth="2.5" strokeLinecap="round" />
      <line x1="-11" y1="6" x2="11" y2="-6" style={{ stroke: "var(--danger)" }} strokeWidth="2.5" strokeLinecap="round" />
      <StairText y={-20} fill="var(--danger)">
        {text}
      </StairText>
      {/* The label itself struck through. */}
      <line x1={-half} y1={-23.5} x2={half} y2={-23.5} style={{ stroke: "var(--danger)" }} strokeWidth="1.5" />
      <StairText y={26} fill="var(--danger)">
        BLOCKED
      </StairText>
    </g>
  );
}

function StairText({ y, fill, testId, children }: { y: number; fill: string; testId?: string; children: string }) {
  return (
    <text
      data-testid={testId}
      y={y}
      textAnchor="middle"
      className="font-mono"
      fontSize="11"
      fontWeight="500"
      letterSpacing="0.06em"
      paintOrder="stroke"
      strokeWidth="4"
      strokeLinejoin="round"
      style={{ fill, stroke: "var(--n-950)" }}
    >
      {children}
    </text>
  );
}

function BottleneckMark({ at, nodeId }: { at: Point; nodeId: string }) {
  return (
    <g data-testid="bottleneck-mark" data-node={nodeId} aria-hidden transform={`translate(${round(at.x)}, ${round(at.y)})`}>
      <ellipse rx="22" ry="12.5" fill="none" style={{ stroke: "var(--n-100)" }} strokeOpacity="0.8" strokeWidth="1.5" strokeDasharray="4 3" />
      <text
        x="26"
        y="14"
        className="font-mono"
        fontSize="11"
        fontWeight="500"
        letterSpacing="0.06em"
        paintOrder="stroke"
        strokeWidth="4"
        strokeLinejoin="round"
        style={{ fill: "var(--text-1)", stroke: "var(--n-950)" }}
      >
        QUEUE
      </text>
    </g>
  );
}
