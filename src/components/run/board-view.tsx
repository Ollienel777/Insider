"use client";

import { useMemo, type KeyboardEvent } from "react";
import type { RunState } from "@/engine";
import type { PlacedLevel } from "@/level/placer";
import { cn } from "@/lib/utils";
import { cones, coverage, guardOrders, roomName, type Choice, type Cone } from "./board";
import { frameOf, hull, LABEL_FONT, pointsAttr, project, projectRect, roomLabelTransform, round, TILE_DEPTH, type Point } from "./iso";

/** A node disc's radii on the board (a circle seen at the isometric angle). */
const DISC = { rx: 13, ry: 7.5 };
/** How far apart, in board units, pieces sharing a node stand. */
const SHARE_GAP = 36;

/** A plan drawn over the board (the Plan screen, #19): its path, and marks on nodes. */
export interface GhostPlan {
  /** Nodes in order, the start first: drawn in the accent at 50%. */
  path: readonly string[];
  /** Where the plan is seen (`--warning`), and where the advice waits (neutral). */
  marks: readonly { nodeId: string; kind: "sighting" | "wait"; label: string }[];
}

interface BoardViewProps {
  placed: PlacedLevel;
  run: RunState;
  choices: readonly Choice[];
  onChoose: (choice: Choice) => void;
  /** The plan to draw over the board, at full emphasis. */
  ghost?: GhostPlan | null;
  /** The board at reduced emphasis, under a plan (DESIGN.md, Plan). */
  reduced?: boolean;
  /** Guards whose dashed route is not drawn yet: the Chief's orders draw each one as its row lands. */
  hiddenRoutes?: ReadonlySet<string>;
  testId?: string;
}

/**
 * The isometric board (DESIGN.md, the hero screen), as SVG: rooms as low
 * tiles, nodes as discs, cones as translucent wedges over the nodes they
 * watch this turn, guards and the player as pawns, cameras on their walls,
 * the player's path in the accent, and a number on each neighbour the player
 * can move to. Pieces hop with a CSS transition: the player in `--t-base`,
 * the guards in `--t-slow` once the player has landed.
 */
export function BoardView({
  placed,
  run,
  choices,
  onChoose,
  ghost = null,
  reduced = false,
  hiddenRoutes,
  testId = "run-board",
}: BoardViewProps) {
  const { floor } = placed.level;
  const frame = useMemo(() => frameOf(floor), [floor]);
  const at = (id: string): Point => {
    const n = run.board.nodes.get(id)!;
    return project(n.x, n.y);
  };
  const allCones = cones(run);
  const watchedBy = coverage(run);
  const orders = guardOrders(placed, run);
  const tripped = trippedBy(run);
  const alarm = run.alarm;

  const trail = [placed.level.start, ...run.turns.map((t) => t.player.nodeId)].filter(
    (id, i, all) => i === 0 || id !== all[i - 1],
  );
  const exitNodes = new Set(placed.level.exits);
  const entryLabel = new Map(placed.entries.map((e) => [e.nodeId, e.label]));
  const lockedEdges = floor.edges.filter((e) => e.door && run.locked.includes(e.door.id));

  // Pieces are drawn back to front, so a nearer pawn overlaps a farther one.
  const pieces = [
    ...run.guards.map((g) => ({ kind: "guard" as const, id: g.id, nodeId: g.nodeId })),
    ...run.cleaners.map((c) => ({ kind: "cleaner" as const, id: c.id, nodeId: c.nodeId })),
  ];

  return (
    <svg
      data-testid={testId}
      data-alarm={alarm}
      data-turn={run.turn}
      viewBox={`${round(frame.minX)} ${round(frame.minY)} ${round(frame.width)} ${round(frame.height)}`}
      preserveAspectRatio="xMidYMid meet"
      className="absolute inset-0 size-full select-none"
      role="group"
      aria-label={`Floor plan, turn ${run.turn}`}
    >
      <g data-testid="board-base" opacity={reduced ? 0.55 : undefined}>
      {/* Rooms: a low tile each, its two front faces darker. */}
      <g aria-hidden>
        {floor.rooms.map((room) => {
          const [back, right, front, left] = projectRect(room.rect);
          const down = (p: Point): Point => ({ x: p.x, y: p.y + TILE_DEPTH });
          return (
            <g key={room.id} data-room={room.id}>
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

      {/* Room labels, painted flat on each tile along its back edge. */}
      <g aria-hidden className="font-mono" style={{ fill: "var(--text-3)" }} fontSize={LABEL_FONT} letterSpacing="0.06em">
        {floor.rooms.map((room) => {
          const text = shortLabel(room.label).toUpperCase();
          return (
            <text key={room.id} data-testid="room-label" transform={roomLabelTransform(room.rect, text.length)}>
              {text}
            </text>
          );
        })}
      </g>

      {/* Edges, with a tick on every door and a bar on each locked one. */}
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
        {lockedEdges.map((edge) => {
          const a = at(edge.a);
          const b = at(edge.b);
          const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          const n = { x: (-(b.y - a.y) / len) * 9, y: ((b.x - a.x) / len) * 9 };
          return (
            <g key={edge.door!.id} data-testid="locked-door" data-door={edge.door!.id}>
              <line
                x1={round(m.x - n.x)}
                y1={round(m.y - n.y)}
                x2={round(m.x + n.x)}
                y2={round(m.y + n.y)}
                style={{ stroke: "var(--n-200)" }}
                strokeWidth="3"
                strokeLinecap="round"
              />
            </g>
          );
        })}
      </g>

      {/* Cones: what each camera and guard sees this turn. */}
      <g aria-hidden>
        {allCones.map((cone) => (
          <ConeShape
            key={cone.id}
            cone={cone}
            at={at}
            sighting={cone.id === tripped ? at(run.playerNode) : null}
          />
        ))}
      </g>

      {/* The player's path so far. */}
      {trail.length > 1 ? (
        <polyline
          aria-hidden
          data-testid="player-path"
          points={pointsAttr(trail.map(at))}
          fill="none"
          style={{ stroke: "var(--accent)" }}
          strokeOpacity="0.7"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : null}

      {/* Where each guard is going: its next three hops, as the engine will move it. */}
      <g aria-hidden>
        {orders
          .filter((o) => o.path.length > 1 && !hiddenRoutes?.has(o.guardId))
          .map((o) => (
            <polyline
              key={o.guardId}
              data-testid="guard-route"
              data-guard={o.guardId}
              data-intent={o.intent}
              data-nodes={o.path.join(" ")}
              points={pointsAttr(o.path.map(at))}
              fill="none"
              style={{ stroke: "var(--danger)" }}
              strokeOpacity="0.6"
              strokeWidth="2"
              strokeDasharray="6 5"
              strokeLinecap="round"
            />
          ))}
      </g>

      {/* Nodes. */}
      <g>
        {floor.nodes.map((node) => {
          const p = project(node.x, node.y);
          const seenBy = watchedBy.get(node.id) ?? [];
          const isObjective = node.id === placed.level.objective && !run.carrying;
          return (
            <g
              key={node.id}
              data-testid="board-node"
              data-node={node.id}
              data-watched-by={seenBy.join(" ")}
              aria-hidden
            >
              <ellipse
                cx={round(p.x)}
                cy={round(p.y)}
                rx={DISC.rx}
                ry={DISC.ry}
                style={{
                  fill: seenBy.length > 0 ? "var(--n-600)" : "var(--n-700)",
                  stroke: isObjective ? "var(--n-100)" : seenBy.length > 0 ? "var(--n-300)" : "var(--n-500)",
                }}
                strokeWidth={isObjective ? 2 : 1}
              />
              {isObjective ? (
                <ellipse
                  cx={round(p.x)}
                  cy={round(p.y)}
                  rx={DISC.rx + 6}
                  ry={DISC.ry + 3.5}
                  fill="none"
                  style={{ stroke: "var(--n-100)" }}
                  strokeOpacity="0.5"
                  strokeDasharray="3 3"
                />
              ) : null}
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
                  {isObjective ? "FILES" : (entryLabel.get(node.id) ?? "EXIT").toUpperCase()}
                </text>
              ) : null}
            </g>
          );
        })}
      </g>

      {/* Cameras, on their walls. */}
      {placed.cameras.map((camera) => {
        const cone = allCones.find((c) => c.id === camera.id)!;
        const p = project(cone.origin.x, cone.origin.y);
        return <CameraPiece key={camera.id} id={camera.id} at={p} live={camera.id === tripped} />;
      })}

      {/* Guards, cleaners and the player, back to front by where they stand. */}
      {[...pieces, { kind: "player" as const, id: "player", nodeId: run.playerNode }]
        .map((piece, _, all) => {
          // Pieces sharing a node stand side by side, so each one and its id stay readable.
          const here = all.filter((other) => other.nodeId === piece.nodeId);
          const shift = (here.indexOf(piece) - (here.length - 1) / 2) * SHARE_GAP;
          const p = at(piece.nodeId);
          return { ...piece, p: { x: p.x + shift, y: p.y } };
        })
        .sort((a, b) => a.p.y - b.p.y || a.id.localeCompare(b.id))
        .map((piece) =>
          piece.kind === "player" ? (
            <Pawn
              key="player"
              testId="player-piece"
              label="You"
              at={piece.p}
              nodeId={piece.nodeId}
              tone="player"
              carrying={run.carrying}
              caught={run.status === "caught"}
            />
          ) : (
            <Pawn
              key={piece.id}
              testId={piece.kind === "guard" ? "guard-piece" : "cleaner-piece"}
              label={piece.id}
              at={piece.p}
              nodeId={piece.nodeId}
              tone={piece.kind}
            />
          ),
        )}
      </g>

      {ghost ? <GhostPath ghost={ghost} at={at} /> : null}

      {/* The numbered neighbours: click or press the number. */}
      <g>
        {choices.map((choice) => (
          <ChoiceHint
            key={choice.nodeId}
            choice={choice}
            at={at(choice.nodeId)}
            room={roomName(floor, choice.nodeId)}
            onChoose={onChoose}
          />
        ))}
      </g>
    </svg>
  );
}

/** The plan's ghost path in the accent at 50%, with a ring where it is seen and one where the advice waits. */
function GhostPath({ ghost, at }: { ghost: GhostPlan; at: (id: string) => Point }) {
  return (
    <g data-testid="ghost-plan" aria-hidden>
      {ghost.path.length > 1 ? (
        <polyline
          data-testid="ghost-path"
          data-nodes={ghost.path.join(" ")}
          points={pointsAttr(ghost.path.map(at))}
          fill="none"
          style={{ stroke: "var(--accent)" }}
          strokeOpacity="0.5"
          strokeWidth="4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : null}
      {ghost.marks.map((mark, i) => {
        const p = at(mark.nodeId);
        const sighting = mark.kind === "sighting";
        const colour = sighting ? "var(--warning)" : "var(--n-100)";
        return (
          <g
            key={`${mark.kind}-${mark.nodeId}-${i}`}
            data-testid={sighting ? "ghost-sighting" : "ghost-wait"}
            data-node={mark.nodeId}
          >
            <ellipse
              cx={round(p.x)}
              cy={round(p.y)}
              rx={DISC.rx + 7}
              ry={DISC.ry + 4}
              fill="none"
              style={{ stroke: colour }}
              strokeWidth="2"
              strokeDasharray={sighting ? undefined : "3 3"}
            />
            <text
              x={round(p.x + DISC.rx + 10)}
              y={round(p.y + (sighting ? -DISC.ry - 6 : DISC.ry + 16))}
              className="font-mono"
              fontSize="11"
              fontWeight="500"
              letterSpacing="0.06em"
              paintOrder="stroke"
              strokeWidth="4"
              strokeLinejoin="round"
              style={{ fill: colour, stroke: "var(--n-950)" }}
            >
              {mark.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** The camera or guard whose sighting raised the alarm on the last turn, if one did. */
function trippedBy(run: RunState): string | null {
  const last = run.alarmEvents[run.alarmEvents.length - 1];
  if (!last || last.turn !== run.turn - 1) return null;
  return last.cause.kind === "camera" || last.cause.kind === "guard" ? (last.cause.id ?? null) : null;
}

/** "West Stair (Stair B)" → "West Stair"; "Suites 2202–2205" stays. */
function shortLabel(label: string): string {
  return label.replace(/\s*\(.*\)$/, "");
}

/** How far above its mount a camera's lens sits, in board units (see `CameraPiece`). */
const LENS_RISE = 14;

/**
 * A watcher's cone: a translucent wedge from the guard's node, or the
 * camera's lens, over the nodes it sees this turn (DESIGN.md: `--n-500` at
 * 20%). On the turn a watcher raised the alarm, a `--danger` wedge also runs
 * from it to where it saw the player.
 */
function ConeShape({ cone, at, sighting }: { cone: Cone; at: (id: string) => Point; sighting: Point | null }) {
  const mount = project(cone.origin.x, cone.origin.y);
  const origin = cone.kind === "camera" ? { x: mount.x, y: mount.y - LENS_RISE } : mount;
  const seen = cone.nodes.filter((id) => cone.kind === "camera" || at(id).x !== origin.x || at(id).y !== origin.y);
  const ring = (p: Point) =>
    Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      return { x: p.x + Math.cos(a) * (DISC.rx + 4), y: p.y + Math.sin(a) * (DISC.ry + 3) };
    });
  const shape = hull([origin, ...seen.flatMap((id) => ring(at(id)))]);
  const camera = cone.kind === "camera";
  const after = cone.after;
  const afterOrigin = after ? project(after.origin.x, after.origin.y) : null;
  const afterSeen = after && afterOrigin ? after.nodes.filter((id) => at(id).x !== afterOrigin.x || at(id).y !== afterOrigin.y) : [];
  return (
    <g
      data-testid="cone"
      data-watcher={cone.id}
      data-kind={cone.kind}
      data-nodes={cone.nodes.join(" ")}
      data-after-nodes={after ? after.nodes.join(" ") : undefined}
    >
      {after && afterOrigin ? (
        // Where it looks once it has moved this turn: the engine checks the player's node again then.
        <polygon
          data-testid="cone-after"
          points={pointsAttr(hull([afterOrigin, ...ring(afterOrigin), ...afterSeen.flatMap((id) => ring(at(id)))]))}
          style={{ fill: "var(--n-500)", stroke: "var(--n-400)" }}
          fillOpacity="0.12"
          strokeOpacity="0.5"
          strokeDasharray="3 4"
          strokeLinejoin="round"
        />
      ) : null}
      {seen.length > 0 ? (
        <polygon
          points={pointsAttr(shape)}
          style={{ fill: camera ? "var(--n-400)" : "var(--n-500)", stroke: camera ? "var(--n-400)" : "none" }}
          fillOpacity={camera ? 0.24 : 0.2}
          strokeOpacity="0.5"
          strokeLinejoin="round"
        />
      ) : null}
      {sighting ? (
        <polygon
          data-testid="sighting"
          points={pointsAttr(hull([origin, ...ring(sighting)]))}
          style={{ fill: "var(--danger)", stroke: "var(--danger)" }}
          fillOpacity="0.4"
          strokeOpacity="0.8"
          strokeLinejoin="round"
        />
      ) : null}
      {cone.next.map((id) => {
        const p = at(id);
        return (
          <ellipse
            key={id}
            cx={round(p.x)}
            cy={round(p.y)}
            rx={DISC.rx + 4}
            ry={DISC.ry + 3}
            fill="none"
            style={{ stroke: "var(--n-400)" }}
            strokeOpacity="0.6"
            strokeDasharray="2 3"
          />
        );
      })}
    </g>
  );
}

/** A pawn: a base, a body and a head, 32 board units wide and 44 tall, standing on its node. */
function Pawn({
  testId,
  label,
  at,
  nodeId,
  tone,
  carrying = false,
  caught = false,
}: {
  testId: string;
  label: string;
  at: Point;
  nodeId: string;
  tone: "player" | "guard" | "cleaner";
  carrying?: boolean;
  caught?: boolean;
}) {
  const body = tone === "player" ? "var(--accent)" : tone === "guard" ? "var(--n-200)" : "var(--n-400)";
  const shade = tone === "player" ? "var(--accent-active)" : tone === "guard" ? "var(--n-400)" : "var(--n-500)";
  const scale = tone === "cleaner" ? 0.8 : 1;
  return (
    <g
      data-testid={testId}
      data-node={nodeId}
      data-id={label}
      className={cn(
        "ease-out motion-reduce:delay-0",
        tone === "player" ? "duration-base" : "delay-200 duration-slow",
      )}
      style={{ transform: `translate(${round(at.x)}px, ${round(at.y)}px)`, transitionProperty: "transform" }}
    >
      <g transform={scale === 1 ? undefined : `scale(${scale})`}>
        <ellipse cx="0" cy="0" rx="16" ry="8" style={{ fill: "var(--n-950)" }} fillOpacity="0.6" />
        <path
          d="M -11 -2 Q -11 2 0 2 Q 11 2 11 -2 L 7 -22 Q 0 -26 -7 -22 Z"
          style={{ fill: shade, stroke: caught ? "var(--danger)" : "var(--n-950)" }}
          strokeWidth={caught ? 2 : 1}
        />
        <path d="M -11 -2 Q -11 2 0 2 L -7 -22 Z" style={{ fill: body }} />
        <path d="M 0 2 L -7 -22 Q 0 -26 7 -22 L 4 -2 Q 2 1 0 2 Z" style={{ fill: body }} fillOpacity="0.85" />
        <circle
          cx="0"
          cy="-31"
          r="9"
          style={{ fill: body, stroke: caught ? "var(--danger)" : "var(--n-950)" }}
          strokeWidth={caught ? 2 : 1}
        />
        {carrying ? (
          <rect x="6" y="-20" width="12" height="9" rx="1.5" style={{ fill: "var(--n-50)", stroke: "var(--n-950)" }} />
        ) : null}
      </g>
      {tone !== "player" ? (
        <text
          x="14"
          y="-34"
          className="font-mono"
          fontSize="12"
          fontWeight="500"
          style={{ fill: tone === "guard" ? "var(--text-1)" : "var(--text-2)" }}
        >
          {label}
        </text>
      ) : null}
    </g>
  );
}

/** A wall camera: a housing with its lens toward the room, and its id. */
function CameraPiece({ id, at, live }: { id: string; at: Point; live: boolean }) {
  return (
    <g data-testid="camera-piece" data-id={id} transform={`translate(${round(at.x)}, ${round(at.y)})`}>
      <rect x="-2" y="-30" width="4" height="12" style={{ fill: "var(--n-500)" }} />
      <rect
        x="-16"
        y="-30"
        width="32"
        height="16"
        rx="3"
        style={{ fill: "var(--n-300)", stroke: "var(--n-950)" }}
        strokeWidth="1"
      />
      <circle
        cx="9"
        cy="-14"
        r="5"
        style={{ fill: live ? "var(--danger)" : "var(--n-800)", stroke: "var(--n-950)" }}
        strokeWidth="1"
      />
      <ellipse cx="0" cy="0" rx="5" ry="3" style={{ fill: "var(--n-500)" }} />
      <text x="20" y="-34" className="font-mono" fontSize="12" fontWeight="500" style={{ fill: "var(--text-1)" }}>
        {id}
      </text>
    </g>
  );
}

/** A neighbour's number, a 40-unit hit target, that moves the player there (or picks its door). */
function ChoiceHint({
  choice,
  at,
  room,
  onChoose,
}: {
  choice: Choice;
  at: Point;
  room: string;
  onChoose: (choice: Choice) => void;
}) {
  const label =
    choice.kind === "pick"
      ? `Pick the door to ${room}, ${choice.progress!.done} of ${choice.progress!.of} (${choice.key})`
      : `Move to ${room} (${choice.key})`;
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onChoose(choice);
    }
  };
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={label}
      data-testid="choice"
      data-key={choice.key}
      data-node={choice.nodeId}
      data-kind={choice.kind}
      className="group cursor-pointer outline-none"
      transform={`translate(${round(at.x)}, ${round(at.y)})`}
      onClick={() => onChoose(choice)}
      onKeyDown={onKey}
    >
      <rect x="-20" y="-20" width="40" height="40" fill="transparent" />
      <ellipse
        cx="0"
        cy="0"
        rx={DISC.rx + 5}
        ry={DISC.ry + 3}
        fill="none"
        className="stroke-accent transition-[stroke-opacity] [stroke-opacity:0.55] group-hover:[stroke-opacity:1] group-focus-visible:[stroke-opacity:1]"
        strokeWidth="2"
      />
      <rect
        x="-11"
        y="-11"
        width="22"
        height="22"
        rx="6"
        className="fill-n-800 stroke-accent transition-colors group-hover:fill-accent group-focus-visible:fill-accent"
        strokeWidth="1.5"
      />
      <text
        x="0"
        y="0.5"
        textAnchor="middle"
        dominantBaseline="middle"
        className="fill-text-1 font-mono transition-colors group-hover:fill-accent-ink group-focus-visible:fill-accent-ink"
        fontSize="13"
        fontWeight="600"
      >
        {choice.key}
      </text>
      {choice.kind === "pick" ? (
        <text
          x="16"
          y="-14"
          className="font-mono"
          fontSize="11"
          letterSpacing="0.06em"
          style={{ fill: "var(--text-1)" }}
        >
          {`PICK ${choice.progress!.done}/${choice.progress!.of}`}
        </text>
      ) : null}
    </g>
  );
}
