"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import type { Building } from "@/domain";
import type { RunState } from "@/engine";
import type { PlacedLevel } from "@/level/placer";
import { objectiveLabel } from "@/lib/objective-noun";
import { recordNote } from "@/lib/record-label";
import { cameraMount, cones, coverage, guardOrders, roomName, sprintWay, type Choice, type Cone } from "./board";
import { useHop } from "./hop";
import { frameOf, hull, LABEL_FONT, matrixAttr, pointsAttr, project, projectRect, round, TILE_DEPTH, type Point } from "./iso";
import {
  addCamera,
  addNode,
  addPawn,
  box,
  boxReach,
  MARK_FONT,
  PAWN_SPOTS,
  PIECE_FONT,
  placeLabel,
  quadsOverlap,
  placeRoomLabels,
  textBox,
  type LabelSpot,
  type Quad,
  type RoomLabel,
  type Taken,
} from "./labels";
import { LayerMarks, LayerRings, LENS_COLOUR, marksWidth, MARK, RoomPattern, roomStyle } from "./layer-lens";
import { lensElements, lensKey, LENS_LAYERS, type LensLayer } from "./lens";
import { ProvenanceThread } from "./provenance-thread";
import { CARD_WIDTH, liveSubtitle, placeCard, threadColour, toScreen, whyKey, whyTargets } from "./why";
import { WhyCard } from "./why-card";

/**
 * The label under an objective or exit node, as the board draws it: the
 * mission's objective noun on the objective (#70), else the entry's label,
 * else "EXIT", upper-case. The Run board, its label layout and the Debrief's
 * replay all read it here, so what is sized is what is drawn.
 */
export function markerLabel(placed: PlacedLevel, nodeId: string): string {
  if (nodeId === placed.level.objective) return objectiveLabel(placed.level.missionId);
  return (placed.entries.find((e) => e.nodeId === nodeId)?.label ?? "EXIT").toUpperCase();
}

/** A node disc's radii on the board (a circle seen at the isometric angle). */
export const DISC = { rx: 13, ry: 7.5 };
/** How far apart, in board units, pieces sharing a node stand. */
const SHARE_GAP = 36;
/** The keys that work a piece in Tab focus (and move the focus), rather than play the game. */
const WORKS_A_PIECE = new Set(["Tab", "Enter", " ", "Escape", "Shift", "Control", "Alt", "Meta"]);

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
  /** The element whose Why card is open at first (a `data-why-target` key); the board keeps it after. */
  initialWhy?: string | null;
  /** The Layer lens (#33): every element tinted by the layers its provenance records (the screen draws the legend). */
  lens?: boolean;
  /** The building's source: a CoStar kit building's Why cards cite its real record (#95); a fixture's are unchanged. */
  source?: Building["source"];
}

/** The props that mark an element the lens tints, for the legend's counts to be checked against. */
function lensAttrs(key: string, layers: readonly LensLayer[] | undefined) {
  return layers ? { "data-lens": key, "data-lens-layers": layers.join(" ") } : {};
}

/**
 * The isometric board (DESIGN.md, the hero screen), as SVG: rooms as low
 * tiles, nodes as discs, cones as translucent wedges over the nodes they
 * watch this turn, guards and the player as pawns, cameras on their walls,
 * the player's path in the accent, and a number on each neighbour the player
 * can move to. Pieces hop (`useHop`): the player in `--t-base`,
 * the guards in `--t-slow` once the player has landed.
 *
 * Every guard, cleaner, camera, lock and zone is a button: clicking one draws the
 * provenance thread and opens its Why card beside it (#21). Esc, the card's
 * close button or a click anywhere else closes it. The guards' and cameras'
 * hit areas sit in a layer above the numbered neighbours, so a click on a
 * guard standing on a neighbour opens its card and never moves the player;
 * the number key still moves there. The locks' sit below them: a lock never
 * stands on a node, and the badges beside it keep their whole area. Space
 * opens a card only on a piece Tab put in focus; everywhere else it takes.
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
  initialWhy = null,
  lens = false,
  source,
}: BoardViewProps) {
  const { floor } = placed.level;
  const patternId = useId().replace(/:/g, "");
  const lensed = useMemo(
    () => (lens ? lensElements(placed, run.locked) : null),
    [lens, placed, run.locked],
  );
  const layersOf = (key: string): readonly LensLayer[] | undefined =>
    lensed ? (lensed.find((e) => e.key === key)?.layers ?? []) : undefined;
  const frame = useMemo(() => frameOf(floor), [floor]);
  const targets = useMemo(() => whyTargets(placed), [placed]);
  const [why, setWhy] = useState<string | null>(initialWhy);
  const target = why ? (targets.find((t) => t.key === why) ?? null) : null;
  const wrap = useRef<HTMLDivElement>(null);
  // The game's keys (the numbers, W and Space) drive the run unless the player
  // has deliberately put a piece in focus with Tab (R3-C1). The board records
  // the last input on itself (`data-input`: "tab" after a Tab, else "other");
  // a piece focused right after a Tab is marked `data-tabbed`, and only a
  // marked piece takes Space (run-screen leaves it alone). A click, or the
  // focus the board itself restores after a click, never marks one.
  // Whether the open card came from a piece in Tab focus: Esc then hands focus back to it.
  const [openedByTab, setOpenedByTab] = useState(false);
  useEffect(() => {
    const mark = (input: "tab" | "other") => wrap.current?.setAttribute("data-input", input);
    const onKey = (event: globalThis.KeyboardEvent) => {
      mark(event.key === "Tab" ? "tab" : "other");
      // Any other key (a number, W) is the player back at the game: the piece Tab or Esc left in
      // focus gives Space back to the run, so at the files Space takes them (#68).
      if (!WORKS_A_PIECE.has(event.key)) {
        wrap.current?.querySelectorAll("[data-tabbed]").forEach((el) => el.removeAttribute("data-tabbed"));
      }
    };
    const onPointer = () => mark("other");
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, []);
  const inspect = useCallback((key: string, fromTab: boolean) => {
    setOpenedByTab(fromTab);
    setWhy((open) => (open === key ? null : key));
  }, []);
  // Esc and the close button: focus goes back to the piece only when Tab put it
  // there; after a click it goes to the board, so Space still takes the files.
  const close = useCallback(() => {
    setWhy(null);
    if (!why) return;
    const piece = wrap.current?.querySelector<SVGElement>(`[data-why-target="${why}"]`);
    if (openedByTab && piece) {
      piece.focus({ preventScroll: true });
      piece.setAttribute("data-tabbed", "");
    } else {
      wrap.current?.focus({ preventScroll: true });
    }
  }, [why, openedByTab]);

  // The board's drawn size and the card's height, to place the card beside its piece.
  const card = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [cardHeight, setCardHeight] = useState(240);
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const el = card.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setCardHeight(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [why]);

  // Esc and a click outside the card close it; a click on another element switches to that one.
  useEffect(() => {
    if (!why) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Esc closes the card and does nothing else: the Run screen's handler sees it taken (issue 121).
      event.preventDefault();
      close();
    };
    const onDown = (event: PointerEvent) => {
      const el = event.target as Element | null;
      if (el?.closest?.('[data-testid="why-card"], [data-why-target]')) return;
      setWhy(null);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [why, close]);
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
  const entryAt = new Map(placed.entries.map((e) => [e.nodeId, e.entryId]));
  const lockedEdges = floor.edges.filter((e) => e.door && run.locked.includes(e.door.id));

  const standing = standingOf(run, at);
  const cameraAt = (id: string): Point => {
    const cone = allCones.find((c) => c.id === id)!;
    return project(cone.origin.x, cone.origin.y);
  };
  const doorMid = (doorId: string): Point | null => {
    const edge = floor.edges.find((e) => e.door?.id === doorId);
    if (!edge) return null;
    const a = at(edge.a);
    const b = at(edge.b);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  const known = new Set(targets.map((t) => t.key));

  // Labels (#68). The rooms' names and everything that never moves first, once per level; then each
  // guard's id beside its pawn, and the plan's marks, each in the first spot clear of the rest.
  const fixed = useMemo(() => fixedLabels(placed, run.board.cameras, lens), [placed, run.board.cameras, lens]);
  // With the lens on, each guard's and cleaner's lens marks are placed too, clear of the labels.
  const guardMarks = lensed ? (kind: "guard" | "cleaner", id: string) => layersOf(whyKey[kind](id))?.length ?? 0 : undefined;
  const { pawns: pawnLabels, ghost: ghostLabels, marks: pawnMarks } = movingLabels(fixed, at, choices, standing, ghost, guardMarks);

  // Where the selected element stands, in board units: the thread starts there.
  const anchor = ((): Point | null => {
    if (!target) return null;
    const id = target.key.slice(target.key.indexOf(":") + 1);
    if (target.kind === "guard" || target.kind === "cleaner") {
      const piece = standing.find((s) => s.kind === target.kind && s.id === id);
      return piece ? { x: piece.p.x, y: piece.p.y - 20 } : null;
    }
    if (target.kind === "camera") {
      const p = cameraAt(id);
      return { x: p.x, y: p.y - 22 };
    }
    if (target.kind === "lock") return doorMid(id);
    const room = floor.rooms.find((r) => r.id === id);
    return room ? project(room.rect.x + room.rect.w / 2, room.rect.y + room.rect.h / 2) : null;
  })();
  // The card leaves the player and every numbered choice in view (R3-M3).
  const avoid = size
    ? [run.playerNode, ...choices.map((c) => c.nodeId)].map((id) => toScreen(frame, size, at(id)))
    : [];
  const placement = anchor && size ? placeCard(toScreen(frame, size, anchor), size, cardHeight, avoid) : null;

  return (
    // Focusable so Esc after a click can hand focus to the board, where Space still takes the files.
    <div ref={wrap} tabIndex={-1} className="absolute inset-0 outline-none">
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
        {lensed ? (
          <defs>
            {LENS_LAYERS.map((layer) => (
              <RoomPattern key={layer} id={`${patternId}-${layer}`} layer={layer} />
            ))}
          </defs>
        ) : null}
        <g data-testid="board-base" opacity={reduced ? 0.55 : undefined}>
        {/* Rooms: a low tile each, its two front faces darker. A room that holds a zone opens its Why card. */}
        <g>
          {floor.rooms.map((room) => {
            const [back, right, front, left] = projectRect(room.rect);
            const down = (p: Point): Point => ({ x: p.x, y: p.y + TILE_DEPTH });
            const key = whyKey.room(room.id);
            const zone = known.has(key);
            const selected = why === key;
            const layers = layersOf(key);
            return (
              <g
                key={room.id}
                data-room={room.id}
                {...lensAttrs(key, layers)}
                {...(zone ? inspectable(key, `Why is the ${room.label} a zone?`, inspect) : { "aria-hidden": true })}
                className={zone ? "cursor-pointer" : undefined}
              >
                <polygon points={pointsAttr([left, front, down(front), down(left)])} style={{ fill: "var(--n-900)" }} />
                <polygon points={pointsAttr([front, right, down(right), down(front)])} style={{ fill: "var(--n-950)" }} />
                <polygon
                  points={pointsAttr([back, right, front, left])}
                  style={{ fill: "var(--n-850)", stroke: selected ? "var(--accent)" : "var(--n-700)" }}
                  strokeWidth={selected ? 2 : 1}
                  strokeLinejoin="round"
                />
                {/* The lens: a hatch per zone layer, then the Matterport outline, inset so the selection ring stays clear. */}
                {layers
                  ? layers.map((layer) => (
                      <polygon
                        key={layer}
                        data-testid="lens-room"
                        data-layer={layer}
                        points={pointsAttr(inset([back, right, front, left], layer === "matterport" ? 3 : 0))}
                        style={roomStyle(layer, `${patternId}-${layer}`)}
                        strokeLinejoin="round"
                        pointerEvents="none"
                      />
                    ))
                  : null}
              </g>
            );
          })}
        </g>

        {/* Room labels, painted flat on each tile along its back edge. */}
        {/* Under the lens each label gets a dark halo, so it stays legible over a hatched tile. */}
        <g
          aria-hidden
          className="font-mono"
          style={{ fill: "var(--text-3)", stroke: lensed ? "var(--n-850)" : undefined }}
          strokeWidth={lensed ? 3 : undefined}
          paintOrder="stroke"
          strokeLinejoin="round"
          fontSize={LABEL_FONT}
          letterSpacing="0.06em"
        >
          {fixed.rooms.map((label) => (
            <text key={label.roomId} data-testid="room-label" data-label-of={label.roomId} transform={matrixAttr(label.matrix)}>
              {label.text}
            </text>
          ))}
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
            const entryId = entryAt.get(node.id);
            const layers = entryId ? layersOf(lensKey.entry(entryId)) : undefined;
            return (
              <g
                key={node.id}
                data-testid="board-node"
                data-node={node.id}
                data-watched-by={seenBy.join(" ")}
                {...(entryId ? lensAttrs(lensKey.entry(entryId), layers) : {})}
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
                    {markerLabel(placed, node.id)}
                  </text>
                ) : null}
                {layers ? (
                  <g transform={`translate(${round(p.x)}, ${round(p.y)})`}>
                    <LayerRings layers={layers} rx={DISC.rx + 5} ry={DISC.ry + 3} />
                    <LayerMarks
                      layers={layers}
                      at={ENTRY_MARKS}
                    />
                  </g>
                ) : null}
              </g>
            );
          })}
        </g>

        {/* Locked doors: a bar across each. The hit area that opens the lock's Why card is in the top layer. */}
        {lockedEdges.map((edge) => {
          const a = at(edge.a);
          const b = at(edge.b);
          const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          const n = { x: (-(b.y - a.y) / len) * 9, y: ((b.x - a.x) / len) * 9 };
          const selected = why === whyKey.lock(edge.door!.id);
          const layers = layersOf(whyKey.lock(edge.door!.id));
          return (
            <g
              key={edge.door!.id}
              data-testid="locked-door"
              data-door={edge.door!.id}
              {...lensAttrs(whyKey.lock(edge.door!.id), layers)}
              aria-hidden
            >
              {layers ? (
                <g transform={`translate(${round(m.x)}, ${round(m.y)})`}>
                  <LayerRings layers={layers} rx={13} ry={13} />
                  <LayerMarks layers={layers} at={lockMarksAt(layers.length)} />
                </g>
              ) : null}
              <line
                x1={round(m.x - n.x)}
                y1={round(m.y - n.y)}
                x2={round(m.x + n.x)}
                y2={round(m.y + n.y)}
                style={{ stroke: selected ? "var(--accent)" : "var(--n-200)" }}
                strokeWidth="3"
                strokeLinecap="round"
              />
            </g>
          );
        })}

        {/* Cameras, on their walls. */}
        {placed.cameras.map((camera) => (
          <CameraPiece
            key={camera.id}
            id={camera.id}
            at={cameraAt(camera.id)}
            live={camera.id === tripped}
            selected={why === whyKey.camera(camera.id)}
            layers={layersOf(whyKey.camera(camera.id))}
            marks={false}
          />
        ))}

        {/* Guards, cleaners and the player, back to front by where they stand. */}
        {standing
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
                selected={why === whyKey[piece.kind](piece.id)}
                layers={layersOf(whyKey[piece.kind](piece.id))}
                labelAt={pawnLabels.get(piece.id)}
                marksAt={pawnMarks.get(piece.id)}
              />
            ),
          )}

        {/* The cameras' lens marks, above the pawns: a pawn below a camera (the player under C2 at the
            wow beat) would otherwise hide the chip that names the trip's layer. */}
        {placed.cameras.map((camera) => {
          const layers = layersOf(whyKey.camera(camera.id));
          if (!layers || layers.length === 0) return null;
          const p = cameraAt(camera.id);
          return (
            <g
              key={camera.id}
              data-lens-marks-of={whyKey.camera(camera.id)}
              transform={`translate(${round(p.x)}, ${round(p.y)})`}
              aria-hidden
            >
              <LayerMarks layers={layers} at={cameraMarksAt(layers.length)} />
            </g>
          );
        })}
        </g>

        {ghost ? <GhostPath ghost={ghost} at={at} spots={ghostLabels} /> : null}

        {/* Every lock's hit area, below the numbered neighbours: a lock never stands on a node, so the
            PICK and move badges beside it keep their whole area (R3-M1). */}
        <g data-testid="why-lock-hits">
          {lockedEdges.map((edge) => {
            const key = whyKey.lock(edge.door!.id);
            const m = doorMid(edge.door!.id);
            if (!known.has(key) || !m) return null;
            return (
              <g
                key={key}
                {...inspectable(key, `Why is the door ${edge.door!.id} locked?`, inspect)}
                className="cursor-pointer"
                transform={`translate(${round(m.x)}, ${round(m.y)})`}
              >
                <circle r="20" fill="transparent" />
              </g>
            );
          })}
        </g>

        {/* The numbered neighbours: click or press the number. */}
        <g>
          {choices.map((choice) => (
            <ChoiceHint
              key={choice.nodeId}
              choice={choice}
              at={at(choice.nodeId)}
              room={roomName(floor, choice.nodeId)}
              way={choice.via ? sprintWay(floor, run.playerNode, choice.via, choice.nodeId) : undefined}
              onChoose={onChoose}
            />
          ))}
        </g>

        {/* Every camera's, guard's and cleaner's hit area, above the numbered neighbours: a click on one opens its card. */}
        <g data-testid="why-hits">
          {placed.cameras.map((camera) => {
            const p = cameraAt(camera.id);
            return (
              <g
                key={camera.id}
                {...inspectable(whyKey.camera(camera.id), `Why is camera ${camera.id} here?`, inspect)}
                className="cursor-pointer"
                transform={`translate(${round(p.x)}, ${round(p.y)})`}
              >
                <rect x="-20" y="-40" width="40" height="44" fill="transparent" />
              </g>
            );
          })}
          {standing.map((piece) =>
            piece.kind === "player" ? null : (
              <GuardHit key={piece.id} kind={piece.kind} id={piece.id} nodeId={piece.nodeId} at={piece.p} onInspect={inspect} />
            ),
          )}
        </g>
      </svg>
      {target ? (
        <>
          {placement ? (
            <ProvenanceThread from={placement.from} to={placement.to} colour={threadColour(target)} drawKey={target.key} />
          ) : null}
          <WhyCard
            ref={card}
            key={target.key}
            target={target}
            subtitle={liveSubtitle(placed, run, target)}
            note={recordNote(source, target.provenance)}
            onClose={close}
            style={
              placement && size
                ? {
                    left: placement.left,
                    top: placement.top,
                    width: Math.min(CARD_WIDTH, size.width - 32),
                    maxHeight: Math.max(160, size.height - 32),
                  }
                : { left: 16, top: 16, width: CARD_WIDTH, visibility: "hidden" }
            }
          />
        </>
      ) : null}
    </div>
  );
}

/**
 * The props that make a board element a button opening its Why card: a click,
 * Enter when focused, or Space when Tab focused it (`data-tabbed`, R3-C1). A
 * piece focused any other way leaves Space to the run: it takes the files.
 */
function inspectable(key: string, label: string, onInspect: (key: string, fromTab: boolean) => void) {
  return {
    role: "button",
    tabIndex: 0,
    "aria-label": label,
    "data-why-target": key,
    onClick: () => onInspect(key, false),
    // The board records the last input on itself (`data-input`); a piece focused right after a Tab is marked.
    onFocus: (event: FocusEvent<SVGGElement>) => {
      const el = event.currentTarget;
      if (el.closest('[data-input="tab"]')) el.setAttribute("data-tabbed", "");
    },
    onBlur: (event: FocusEvent<SVGGElement>) => event.currentTarget.removeAttribute("data-tabbed"),
    onKeyDown: (event: KeyboardEvent<SVGGElement>) => {
      const tabbed = event.currentTarget.hasAttribute("data-tabbed");
      if (event.key === "Enter" || (event.key === " " && tabbed)) {
        event.preventDefault();
        onInspect(key, tabbed);
      }
    },
  } as const;
}

/** A guard's or cleaner's hit area in the board's top layer: it hops with the pawn. */
function GuardHit({
  kind,
  id,
  nodeId,
  at,
  onInspect,
}: {
  kind: "guard" | "cleaner";
  id: string;
  nodeId: string;
  at: Point;
  onInspect: (key: string, fromTab: boolean) => void;
}) {
  const ref = useRef<SVGGElement>(null);
  const p = { x: round(at.x), y: round(at.y) };
  useHop(ref, p, { speed: "slow", delayed: true });
  return (
    <g
      ref={ref}
      {...inspectable(whyKey[kind](id), `Why is ${id} here?`, onInspect)}
      data-node={nodeId}
      className="cursor-pointer"
      style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
    >
      <rect x="-20" y="-46" width="40" height="54" fill="transparent" />
    </g>
  );
}

/** The plan's ghost path in the accent at 50%, with a ring where it is seen and one where the advice waits. */
function GhostPath({
  ghost,
  at,
  spots,
}: {
  ghost: GhostPlan;
  at: (id: string) => Point;
  /** Where each mark's label stands beside its node, clear of the board's other labels (`placeLabel`). */
  spots: readonly LabelSpot[];
}) {
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
        const spot = spots[i] ?? ghostSpots(mark.kind, mark.label.length)[0];
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
              data-testid="ghost-label"
              x={round(p.x + spot.x)}
              y={round(p.y + spot.y)}
              textAnchor={spot.anchor}
              className="font-mono"
              fontSize={MARK_FONT}
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

/** A polygon pulled `by` board units toward its centre, so an outline sits just inside the tile's edge. */
function inset(points: readonly Point[], by: number): Point[] {
  if (by === 0) return [...points];
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  return points.map((p) => {
    const d = Math.hypot(p.x - cx, p.y - cy) || 1;
    return { x: p.x + ((cx - p.x) / d) * by, y: p.y + ((cy - p.y) / d) * by };
  });
}

/** "West Stair (Stair B)" → "West Stair"; "Suites 2202–2205" stays. */
export function shortLabel(label: string): string {
  return label.replace(/\s*\(.*\)$/, "");
}

/** A pawn's id: right of its head unless the board places it elsewhere. */
const PAWN_LABEL: LabelSpot = PAWN_SPOTS[0];
const PAWN_FONT = PIECE_FONT;
/** "PICK 0/2": the PICK label beside a door's badge (`ChoiceHint`). */
const PICK_CHARS = 8;

/** The farthest a plan mark's glyphs stand from its node, in board units, so it reads as that node's. */
export const GHOST_REACH = 30;

/**
 * A plan mark's label: right of its ring, above it for a sighting and below for a wait, then the
 * other way, then left, then centred. With the Layer lens on, its marks and rings block more of
 * those, so then also level with the node on either side, and every spot is tried nearest first:
 * a clear spot on the far side of the node beats a farther one on the near side. None stands
 * more than `GHOST_REACH` from the node; when none of them is clear, the label covers what the
 * fewest of them cover rather than drift away from its node.
 */
function ghostSpots(kind: GhostPlan["marks"][number]["kind"], chars: number, lens = false): LabelSpot[] {
  const right = DISC.rx + 10;
  const above = -DISC.ry - 6;
  const below = DISC.ry + 16;
  const [first, second] = kind === "sighting" ? [above, below] : [below, above];
  const spots: LabelSpot[] = [
    { x: right, y: first, anchor: "start" },
    { x: right, y: second, anchor: "start" },
    { x: -right, y: first, anchor: "end" },
    { x: -right, y: second, anchor: "end" },
    { x: 0, y: first < 0 ? first - 6 : first + 6, anchor: "middle" },
    { x: 0, y: second < 0 ? second - 6 : second + 6, anchor: "middle" },
  ];
  if (!lens) return spots;
  const reach = (s: LabelSpot) => boxReach(textBox(s.x, s.y, chars, MARK_FONT, s.anchor, 0), { x: 0, y: 0 });
  return [...spots, { x: right, y: 0, anchor: "start" as const }, { x: -right, y: 0, anchor: "end" as const }]
    .filter((s) => reach(s) <= GHOST_REACH)
    .sort((a, b) => reach(a) - reach(b));
}

/** Where each piece stands on the board, back to front, so a nearer pawn overlaps a farther one. */
export function standingOf(run: RunState, at: (nodeId: string) => Point) {
  const pieces = [
    ...run.guards.map((g) => ({ kind: "guard" as const, id: g.id, nodeId: g.nodeId })),
    ...run.cleaners.map((c) => ({ kind: "cleaner" as const, id: c.id, nodeId: c.nodeId })),
  ];
  return [...pieces, { kind: "player" as const, id: "player", nodeId: run.playerNode }]
    .map((piece, _, all) => {
      // Pieces sharing a node stand side by side, so each one and its id stay readable.
      const here = all.filter((other) => other.nodeId === piece.nodeId);
      const shift = (here.indexOf(piece) - (here.length - 1) / 2) * SHARE_GAP;
      const p = at(piece.nodeId);
      return { ...piece, p: { x: p.x + shift, y: p.y } };
    })
    .sort((a, b) => a.p.y - b.p.y || a.id.localeCompare(b.id));
}

/** The rooms' names, and what the labels that move keep clear of before any piece is drawn. */
export interface FixedLabels {
  rooms: RoomLabel[];
  taken: Taken;
  /** Whether these were placed with the Layer lens on. */
  lens: boolean;
  /** With the lens on, the rings round the cameras, locks and entries: no plan mark covers one. */
  rings: Quad[];
}

/**
 * Where each guard's and cleaner's id, and each plan mark's label, stands this
 * turn: in the first of its spots clear of the fixed labels, the numbered
 * choices, the pieces and the labels placed before it. Also returns the glyph
 * boxes of every label placed, for the tests to check.
 */
export function movingLabels(
  fixed: FixedLabels,
  at: (nodeId: string) => Point,
  choices: readonly Choice[],
  standing: readonly { kind: "guard" | "cleaner" | "player"; id: string; p: Point }[],
  ghost: GhostPlan | null,
  /** With the lens on: how many lens marks each guard and cleaner carries; its marks are placed after the ids. */
  markCount?: (kind: "guard" | "cleaner", id: string) => number,
): { pawns: Map<string, LabelSpot>; ghost: LabelSpot[]; marks: Map<string, Point>; taken: Taken } {
  const taken: Taken = { text: [...fixed.taken.text], marks: [...fixed.taken.marks] };
  for (const c of choices) {
    const p = at(c.nodeId);
    addNode(taken, p);
    if (c.kind === "pick") taken.text.push(textBox(p.x + 16, p.y - 14, PICK_CHARS, MARK_FONT));
  }
  for (const piece of standing) addPawn(taken, piece.p);
  const pawns = new Map(
    standing
      .filter((piece) => piece.kind !== "player")
      .map((piece) => [piece.id, placeLabel(piece.p, PAWN_SPOTS, piece.id.length, PIECE_FONT, taken)] as const),
  );
  const lensMarks = new Map<string, Point>();
  for (const piece of standing) {
    const n = piece.kind !== "player" && markCount ? markCount(piece.kind, piece.id) : 0;
    if (n > 0) lensMarks.set(piece.id, placeMarks(piece.p, n, taken));
  }
  // A plan mark keeps clear of the lens's rings too, so it never reads as a lock's or a camera's label.
  taken.text.push(...fixed.rings);
  const marks = ghost
    ? ghost.marks.map((mark) => placeLabel(at(mark.nodeId), ghostSpots(mark.kind, mark.label.length, fixed.lens), mark.label.length, MARK_FONT, taken))
    : [];
  return { pawns, ghost: marks, marks: lensMarks, taken };
}

/**
 * The labels that never move on a placed level: each room's name, placed clear
 * of the nodes, the entry and files labels, the cameras and the PICK labels
 * (any door's far node can carry one), and with the Layer lens on its marks;
 * and those boxes, for the labels that move to keep clear of.
 */
export function fixedLabels(placed: PlacedLevel, cameras: RunState["board"]["cameras"], lens = false): FixedLabels {
  const { floor, objective, exits } = placed.level;
  const point = (id: string): Point => {
    const n = floor.nodes.find((node) => node.id === id)!;
    return project(n.x, n.y);
  };
  const named = [objective, ...exits.filter((id) => id !== objective)];
  const doorNodes = (edges: typeof floor.edges) => new Set(edges.filter((e) => e.door).flatMap((e) => [e.a, e.b]));
  const pickBox = (id: string) => {
    const p = point(id);
    return textBox(p.x + 16, p.y - 14, PICK_CHARS, MARK_FONT);
  };
  // Without the nodes: the labels that move keep clear only of the ones a choice stands on.
  const taken: Taken = { text: [], marks: [] };
  for (const id of named) {
    const p = point(id);
    const text = markerLabel(placed, id);
    taken.text.push(textBox(p.x, p.y + DISC.ry + 14, text.length, MARK_FONT, "middle"));
  }
  for (const camera of cameras) {
    const m = cameraMount(floor, camera.parts.flat());
    addCamera(taken, project(m.x, m.y), camera.id);
  }
  const beforePicks = taken.text.length;
  for (const id of doorNodes(floor.edges)) taken.text.push(pickBox(id));
  // With the Layer lens on, its letter marks on the elements that never move (#83 R1-M1): no
  // label covers them, the rooms' names nor the ones that move (a ghost mark's halo hid a lock's
  // chip). With it off they are not drawn, so nothing keeps clear of them.
  const lensMarks = lens ? fixedLensMarks(placed, cameras) : [];
  taken.text.push(...lensMarks);
  taken.marks.push(...lensMarks);
  // The rooms' names keep clear of every node, and of a pawn standing on it (with its lens marks,
  // while the lens is on), where they can: a numbered choice or a piece can stand on any of them.
  const forRooms: Taken = { text: [...taken.text], marks: [...taken.marks] };
  for (const n of floor.nodes) {
    const p = project(n.x, n.y);
    addNode(forRooms, p);
    addPawn(forRooms, p);
    if (lens) forRooms.marks.push(markRow(p.x + PAWN_MARKS.x, p.y + PAWN_MARKS.y, LENS_LAYERS.length - 1));
  }
  // Just outside a corridor's outer wall (R1-N2) only a lockable door's ends can carry a PICK
  // label: no other door is ever picked.
  const outside: Taken = {
    text: [...taken.text.slice(0, beforePicks), ...[...doorNodes(floor.edges.filter((e) => e.door?.lockable))].map(pickBox), ...lensMarks],
    marks: [],
  };
  const rooms = placeRoomLabels(floor, (label) => shortLabel(label).toUpperCase(), forRooms, outside, frameOf(floor));
  return { rooms, taken: { text: [...taken.text, ...rooms.map((r) => r.quad)], marks: taken.marks }, lens, rings: lens ? fixedLensRings(placed, cameras) : [] };
}

/** Where a guard's lens marks start beside its pawn (see `Pawn`), unless the board places them elsewhere. */
const PAWN_MARKS: Point = { x: 14, y: -28 };

/**
 * Where a guard's row of `count` lens marks goes: right of its head by default, then left of it,
 * then beside its body, then above it; the first clear of every label `taken`, else the one
 * covering the fewest. Its box is added to `taken`.
 */
function placeMarks(p: Point, count: number, taken: Taken): Point {
  const w = marksWidth(count);
  const spots: Point[] = [PAWN_MARKS, { x: -14 - w, y: -28 }, { x: 14, y: -10 }, { x: -14 - w, y: -10 }, { x: -w / 2, y: -62 }];
  const boxOf = (s: Point) => markRow(p.x + s.x, p.y + s.y, count);
  const hits = (s: Point) => taken.text.filter((t) => quadsOverlap(boxOf(s), t)).length;
  const spot = spots.find((s) => hits(s) === 0) ?? spots.reduce((best, s) => (hits(s) < hits(best) ? s : best));
  taken.text.push(boxOf(spot));
  return spot;
}

/** Where a lock's lens marks start, from the middle of its door: above its bar, clear of the room's name and the PICK label. */
function lockMarksAt(count: number): Point {
  return { x: -marksWidth(count) / 2, y: -18 - MARK.h };
}

/** Where an entry's lens marks start, from its node: right of its rings, clear of the stair's name. */
const ENTRY_MARKS: Point = { x: DISC.rx + 10, y: -MARK.h / 2 };

/** The box a row of `count` lens marks fills from its top-left (`LayerMarks`). */
function markRow(x: number, y: number, count: number): Quad {
  return box(x, y, x + marksWidth(count), y + MARK.h);
}

/**
 * The lens footprints of the cameras, the locks and the entries, where the board draws them with
 * the lens on (`CameraPiece`, the locked doors and the nodes in `BoardView`), one per element: the
 * box of its row of letter marks, and the box of its outermost ring with the ring's stroke.
 */
function fixedLensFootprints(placed: PlacedLevel, cameras: RunState["board"]["cameras"]): { marks: Quad[]; rings: Quad[] } {
  const { floor } = placed.level;
  const elements = lensElements(placed, placed.level.lockedDoors);
  const count = (key: string) => elements.find((e) => e.key === key)?.layers.length ?? 0;
  const point = (id: string): Point => {
    const n = floor.nodes.find((node) => node.id === id)!;
    return project(n.x, n.y);
  };
  const marks: Quad[] = [];
  const rings: Quad[] = [];
  // An ellipse `LayerRings` draws, its `n`th ring the outermost, as the box round it.
  const ellipse = (p: Point, rx: number, ry: number, n: number) => {
    const [x, y] = [rx + (n - 1) * 5 + 1, ry + (n - 1) * 2.5 + 1];
    return box(p.x - x, p.y - y, p.x + x, p.y + y);
  };
  for (const camera of cameras) {
    const n = count(whyKey.camera(camera.id));
    if (n === 0) continue;
    const m = cameraMount(floor, camera.parts.flat());
    const p = project(m.x, m.y);
    const at = cameraMarksAt(n);
    marks.push(markRow(p.x + at.x, p.y + at.y, n));
    const grow = (n - 1) * 4 + 1;
    rings.push(box(p.x - 20 - grow, p.y - 34 - grow, p.x + 20 + grow, p.y - 10 + grow));
  }
  for (const edge of floor.edges) {
    const n = edge.door ? count(whyKey.lock(edge.door.id)) : 0;
    if (n === 0) continue;
    const a = point(edge.a);
    const b = point(edge.b);
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const at = lockMarksAt(n);
    marks.push(markRow(m.x + at.x, m.y + at.y, n));
    rings.push(ellipse(m, 13, 13, n));
  }
  for (const entry of placed.entries) {
    const n = count(lensKey.entry(entry.entryId));
    if (n === 0) continue;
    const p = point(entry.nodeId);
    marks.push(markRow(p.x + ENTRY_MARKS.x, p.y + ENTRY_MARKS.y, n));
    rings.push(ellipse(p, DISC.rx + 5, DISC.ry + 3, n));
  }
  return { marks, rings };
}

/** The lens's letter marks on the cameras, the locks and the entries (`fixedLensFootprints`). */
export function fixedLensMarks(placed: PlacedLevel, cameras: RunState["board"]["cameras"]): Quad[] {
  return fixedLensFootprints(placed, cameras).marks;
}

/** The lens's rings round the cameras, the locks and the entries (`fixedLensFootprints`). */
export function fixedLensRings(placed: PlacedLevel, cameras: RunState["board"]["cameras"]): Quad[] {
  return fixedLensFootprints(placed, cameras).rings;
}

/** Where a camera's `n` lens marks start, from its mount (`CameraPiece`, `fixedLensFootprints`). */
function cameraMarksAt(n: number): Point {
  return { x: 24 + (n - 1) * 4, y: -28 };
}

/** How far above its mount a camera's lens sits, in board units (see `CameraPiece`). */
const LENS_RISE = 14;

/**
 * A watcher's cone: a translucent wedge from the guard's node, or the
 * camera's lens, over the nodes it sees this turn (DESIGN.md: `--n-500` at
 * 20%). On the turn a watcher raised the alarm, its whole cone turns `--danger`
 * and flashes (`.cone-flash`), and a stronger `--danger` wedge runs from it to
 * where it saw the player.
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
        // On the trip turn the whole cone is `--danger`: it flashes from 70% down to 30% (`.cone-flash`),
        // then stays `--danger` at 30% until the next turn (DESIGN.md the wow beat, step 2).
        <polygon
          data-testid={sighting ? "cone-tripped" : undefined}
          className={sighting ? "cone-flash" : undefined}
          points={pointsAttr(shape)}
          style={
            sighting
              ? { fill: "var(--danger)", stroke: "var(--danger)" }
              : { fill: camera ? "var(--n-400)" : "var(--n-500)", stroke: camera ? "var(--n-400)" : "none" }
          }
          fillOpacity={sighting ? 0.3 : camera ? 0.24 : 0.2}
          strokeOpacity={sighting ? 0.9 : 0.5}
          strokeWidth={sighting ? 2 : undefined}
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
export function Pawn({
  testId,
  label,
  at,
  nodeId,
  tone,
  carrying = false,
  caught = false,
  selected = false,
  layers,
  labelAt,
  marksAt,
}: {
  testId: string;
  label: string;
  at: Point;
  nodeId: string;
  tone: "player" | "guard" | "cleaner";
  carrying?: boolean;
  caught?: boolean;
  /** Its Why card is open (guards and cleaners; the hit area that opens it is in the board's top layer). */
  selected?: boolean;
  /** With the Layer lens on (guards and cleaners): its layers, as rings round its base and letter marks beside it. */
  layers?: readonly LensLayer[];
  /** Where its id stands beside its head, clear of the board's other labels (`placeLabels`); right of it by default. */
  labelAt?: LabelSpot;
  /** Where its lens marks start, clear of the board's labels (`movingLabels`); right of its head by default. */
  marksAt?: Point;
}) {
  const body = tone === "player" ? "var(--accent)" : tone === "guard" ? "var(--n-200)" : "var(--n-400)";
  const shade = tone === "player" ? "var(--accent-active)" : tone === "guard" ? "var(--n-400)" : "var(--n-500)";
  const scale = tone === "cleaner" ? 0.8 : 1;
  const ref = useRef<SVGGElement>(null);
  const p = { x: round(at.x), y: round(at.y) };
  // The player hops in `--t-base`; the guards in `--t-slow`, once the player has landed.
  useHop(ref, p, tone === "player" ? { speed: "base", delayed: false } : { speed: "slow", delayed: true });
  const text = labelAt ?? PAWN_LABEL;
  return (
    <g
      ref={ref}
      data-testid={testId}
      data-node={nodeId}
      data-id={label}
      {...lensAttrs(tone === "cleaner" ? whyKey.cleaner(label) : whyKey.guard(label), layers)}
      style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
    >
      {layers ? <LayerRings layers={layers} rx={selected ? 25 : 19} ry={selected ? 12.5 : 9.5} /> : null}
      {selected ? (
        <ellipse cx="0" cy="0" rx="20" ry="10" fill="none" style={{ stroke: "var(--accent)" }} strokeWidth="2" />
      ) : null}
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
          data-testid="pawn-label"
          x={text.x}
          y={text.y}
          textAnchor={text.anchor}
          className="font-mono"
          fontSize={PAWN_FONT}
          fontWeight="500"
          style={{ fill: tone === "guard" ? "var(--text-1)" : "var(--text-2)" }}
        >
          {label}
        </text>
      ) : null}
      {layers && layers.length > 0 ? (
        <LayerMarks layers={layers} at={marksAt ?? PAWN_MARKS} />
      ) : null}
    </g>
  );
}

/**
 * A wall camera: a housing with its lens toward the room, and its id. `selected` rings the
 * housing while its Why card is open; the debrief replay leaves it off.
 */
export function CameraPiece({
  id,
  at,
  live,
  selected = false,
  layers,
  marks = true,
}: {
  id: string;
  at: Point;
  live: boolean;
  selected?: boolean;
  /** With the Layer lens on: its layers, as an outline round the housing and letter marks beside it. */
  layers?: readonly LensLayer[];
  /** Whether it draws its own letter marks; the Run and Plan board draws them above the pawns instead. */
  marks?: boolean;
}) {
  return (
    <g
      data-testid="camera-piece"
      data-id={id}
      {...lensAttrs(whyKey.camera(id), layers)}
      transform={`translate(${round(at.x)}, ${round(at.y)})`}
    >
      {layers?.map((layer, i) => (
        <rect
          key={layer}
          data-testid="lens-ring"
          data-layer={layer}
          x={-20 - i * 4}
          y={-34 - i * 4}
          width={40 + i * 8}
          height={24 + i * 8}
          rx="5"
          fill="none"
          style={{ stroke: LENS_COLOUR[layer] }}
          strokeWidth="2"
          strokeDasharray={i === 0 ? undefined : "4 3"}
        />
      ))}
      <rect x="-2" y="-30" width="4" height="12" style={{ fill: "var(--n-500)" }} />
      <rect
        x="-16"
        y="-30"
        width="32"
        height="16"
        rx="3"
        style={{ fill: "var(--n-300)", stroke: selected ? "var(--accent)" : "var(--n-950)" }}
        strokeWidth={selected ? 2 : 1}
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
      {marks && layers && layers.length > 0 ? <LayerMarks layers={layers} at={cameraMarksAt(layers.length)} /> : null}
    </g>
  );
}

/** A numbered choice's hit target, from its node. */
export const CHOICE_HIT = { x: -20, y: -20, width: 40, height: 40 } as const;
/** A PICK choice's hit target, its badge and its label with the label's halo, from its node. */
export const PICK_HIT = { x: -20, y: -30, width: 100, height: 50 } as const;

/** A neighbour's number, a 40-unit hit target, that moves the player there (or picks its door). */
function ChoiceHint({
  choice,
  at,
  room,
  way,
  onChoose,
}: {
  choice: Choice;
  at: Point;
  room: string;
  /** For a sprint: the way it runs, from `sprintWay`. */
  way?: string;
  onChoose: (choice: Choice) => void;
}) {
  const label =
    choice.kind === "pick"
      ? `Pick the door to ${room}, ${choice.progress!.done} of ${choice.progress!.of} (${choice.key})`
      : choice.kind === "sprint"
        ? // Rooms are the finest names the board has; `sprintWay` keeps the way true for all three nodes.
          `Sprint to ${room}, ${way ?? "two hops"}, loud (${choice.key})`
        : `Move to ${room} (${choice.key})`;
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
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
      data-via={choice.via}
      className="group cursor-pointer outline-none"
      transform={`translate(${round(at.x)}, ${round(at.y)})`}
      onClick={() => onChoose(choice)}
      onKeyDown={onKey}
    >
      {/* On hover, the label says the way: for a sprint, the room it runs through. */}
      <title>{label}</title>
      <rect {...CHOICE_HIT} fill="transparent" />
      <ellipse
        cx="0"
        cy="0"
        rx={DISC.rx + 5}
        ry={DISC.ry + 3}
        fill="none"
        className="stroke-accent transition-[stroke-opacity] [stroke-opacity:0.55] group-hover:[stroke-opacity:1] group-focus-visible:[stroke-opacity:1]"
        strokeWidth="2"
        // A sprint target's ring is dashed: two hops away, and loud (issue 121).
        strokeDasharray={choice.kind === "sprint" ? "4 3" : undefined}
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
      {/* With its label and the label's halo, the badge's whole box is its hit area: a click anywhere on
          it picks and never reaches the lock below (R3-M1). */}
      {choice.kind === "pick" ? <rect {...PICK_HIT} fill="transparent" /> : null}
      {choice.kind === "pick" ? (
        <text
          x="16"
          y="-14"
          className="font-mono"
          fontSize="11"
          letterSpacing="0.06em"
          // A dark halo, so the lock's bar it sits beside never strikes through it.
          paintOrder="stroke"
          strokeWidth="4"
          strokeLinejoin="round"
          style={{ fill: "var(--text-1)", stroke: "var(--n-950)" }}
        >
          {`PICK ${choice.progress!.done}/${choice.progress!.of}`}
        </text>
      ) : null}
    </g>
  );
}
