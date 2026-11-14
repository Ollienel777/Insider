"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import type { RunState } from "@/engine";
import type { PlacedLevel } from "@/level/placer";
import { cn } from "@/lib/utils";
import { cones, coverage, guardOrders, roomName, type Choice, type Cone } from "./board";
import { frameOf, hull, LABEL_FONT, pointsAttr, project, projectRect, roomLabelTransform, round, TILE_DEPTH, type Point } from "./iso";
import { LayerMarks, LayerRings, LENS_COLOUR, marksWidth, MARK, RoomPattern, roomStyle } from "./layer-lens";
import { lensElements, lensKey, LENS_LAYERS, type LensLayer } from "./lens";
import { ProvenanceThread } from "./provenance-thread";
import { CARD_WIDTH, liveSubtitle, placeCard, threadColour, toScreen, whyKey, whyTargets } from "./why";
import { WhyCard } from "./why-card";

/** A node disc's radii on the board (a circle seen at the isometric angle). */
export const DISC = { rx: 13, ry: 7.5 };
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
  /** The element whose Why card is open at first (a `data-why-target` key); the board keeps it after. */
  initialWhy?: string | null;
  /** The Layer lens (#33): every element tinted by the layers its provenance records (the screen draws the legend). */
  lens?: boolean;
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
 * can move to. Pieces hop with a CSS transition: the player in `--t-base`,
 * the guards in `--t-slow` once the player has landed.
 *
 * Every guard, camera, lock and zone is a button: clicking one draws the
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
    const onKey = (event: globalThis.KeyboardEvent) => mark(event.key === "Tab" ? "tab" : "other");
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
      if (event.key === "Escape") close();
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
  const entryLabel = new Map(placed.entries.map((e) => [e.nodeId, e.label]));
  const entryAt = new Map(placed.entries.map((e) => [e.nodeId, e.entryId]));
  const lockedEdges = floor.edges.filter((e) => e.door && run.locked.includes(e.door.id));

  // Pieces are drawn back to front, so a nearer pawn overlaps a farther one.
  const pieces = [
    ...run.guards.map((g) => ({ kind: "guard" as const, id: g.id, nodeId: g.nodeId })),
    ...run.cleaners.map((c) => ({ kind: "cleaner" as const, id: c.id, nodeId: c.nodeId })),
  ];
  const standing = [...pieces, { kind: "player" as const, id: "player", nodeId: run.playerNode }]
    .map((piece, _, all) => {
      // Pieces sharing a node stand side by side, so each one and its id stay readable.
      const here = all.filter((other) => other.nodeId === piece.nodeId);
      const shift = (here.indexOf(piece) - (here.length - 1) / 2) * SHARE_GAP;
      const p = at(piece.nodeId);
      return { ...piece, p: { x: p.x + shift, y: p.y } };
    })
    .sort((a, b) => a.p.y - b.p.y || a.id.localeCompare(b.id));
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

  // Where the selected element stands, in board units: the thread starts there.
  const anchor = ((): Point | null => {
    if (!target) return null;
    const id = target.key.slice(target.key.indexOf(":") + 1);
    if (target.kind === "guard") {
      const piece = standing.find((s) => s.kind === "guard" && s.id === id);
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
                    {isObjective ? "FILES" : (entryLabel.get(node.id) ?? "EXIT").toUpperCase()}
                  </text>
                ) : null}
                {layers ? (
                  <g transform={`translate(${round(p.x)}, ${round(p.y)})`}>
                    <LayerRings layers={layers} rx={DISC.rx + 5} ry={DISC.ry + 3} />
                    <LayerMarks
                      layers={layers}
                      at={{ x: -DISC.rx - 10 - marksWidth(layers.length), y: -MARK.h / 2 }}
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
                  <LayerMarks layers={layers} at={{ x: -marksWidth(layers.length) / 2, y: 18 }} />
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
                selected={piece.kind === "guard" && why === whyKey.guard(piece.id)}
                layers={piece.kind === "guard" ? layersOf(whyKey.guard(piece.id)) : undefined}
              />
            ),
          )}
        </g>

        {ghost ? <GhostPath ghost={ghost} at={at} /> : null}

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
              onChoose={onChoose}
            />
          ))}
        </g>

        {/* Every camera's and guard's hit area, above the numbered neighbours: a click on one opens its card. */}
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
          {standing
            .filter((piece) => piece.kind === "guard")
            .map((piece) => (
              <g
                key={piece.id}
                {...inspectable(whyKey.guard(piece.id), `Why is ${piece.id} here?`, inspect)}
                data-node={piece.nodeId}
                className="cursor-pointer delay-200 duration-slow ease-out motion-reduce:delay-0"
                style={{ transform: `translate(${round(piece.p.x)}px, ${round(piece.p.y)}px)`, transitionProperty: "transform" }}
              >
                <rect x="-20" y="-46" width="40" height="54" fill="transparent" />
              </g>
            ))}
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
}: {
  testId: string;
  label: string;
  at: Point;
  nodeId: string;
  tone: "player" | "guard" | "cleaner";
  carrying?: boolean;
  caught?: boolean;
  /** Its Why card is open (guards only; the hit area that opens it is in the board's top layer). */
  selected?: boolean;
  /** With the Layer lens on (guards only): its layers, as rings round its base and letter marks beside it. */
  layers?: readonly LensLayer[];
}) {
  const body = tone === "player" ? "var(--accent)" : tone === "guard" ? "var(--n-200)" : "var(--n-400)";
  const shade = tone === "player" ? "var(--accent-active)" : tone === "guard" ? "var(--n-400)" : "var(--n-500)";
  const scale = tone === "cleaner" ? 0.8 : 1;
  return (
    <g
      data-testid={testId}
      data-node={nodeId}
      data-id={label}
      {...lensAttrs(whyKey.guard(label), layers)}
      className={cn("ease-out motion-reduce:delay-0", tone === "player" ? "duration-base" : "delay-200 duration-slow")}
      style={{ transform: `translate(${round(at.x)}px, ${round(at.y)}px)`, transitionProperty: "transform" }}
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
      {layers && layers.length > 0 ? (
        <LayerMarks layers={layers} at={{ x: 14, y: -28 }} />
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
}: {
  id: string;
  at: Point;
  live: boolean;
  selected?: boolean;
  /** With the Layer lens on: its layers, as an outline round the housing and letter marks beside it. */
  layers?: readonly LensLayer[];
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
      {layers && layers.length > 0 ? <LayerMarks layers={layers} at={{ x: 24 + (layers.length - 1) * 4, y: -28 }} /> : null}
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
      {/* With its label, the badge's whole box is its hit area: a click anywhere on it picks and never
          reaches the lock below (R3-M1). */}
      {choice.kind === "pick" ? <rect x="-20" y="-26" width="100" height="46" fill="transparent" /> : null}
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
