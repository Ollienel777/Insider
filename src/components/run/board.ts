// What the run board shows, read off the engine's state (SPEC §2 beat 5,
// DESIGN.md the hero screen). Pure: everything here is a function of the run
// and the placed level, so the board, the panel and the tests all read the
// same answers. The engine stays authoritative: these helpers only say what
// it would do, using its own `watched`, `visibleFrom` and `shortestPath`.
import type { FloorGraph } from "@/domain";
import { neighbours, shortestPath, visibleFrom, watched, type Action, type RunState } from "@/engine";
import type { PlacedLevel } from "@/level/placer";
import { project } from "./iso";

// ---- cones ------------------------------------------------------------------

export type WatcherKind = "camera" | "guard" | "cleaner";

export interface Cone {
  id: string;
  kind: WatcherKind;
  /** Where the cone starts, in floor units: the guard's node, or the camera's mount on the wall. */
  origin: { x: number; y: number };
  /** The nodes it would see the player on this turn. */
  nodes: readonly string[];
  /** A sweeping camera's part for the turn after, drawn as an outline. Empty for guards. */
  next: readonly string[];
}

/**
 * Where a camera hangs: on an end wall of its cover's room, the end nearer
 * the cover, so it looks down the room's length across its cover (a corridor
 * camera looks along the corridor).
 */
export function cameraMount(floor: FloorGraph, cover: readonly string[]): { x: number; y: number } {
  const nodes = cover.map((id) => floor.nodes.find((n) => n.id === id)!);
  const cx = nodes.reduce((s, n) => s + n.x, 0) / nodes.length;
  const cy = nodes.reduce((s, n) => s + n.y, 0) / nodes.length;
  const rect = floor.rooms.find((r) => r.id === nodes[0].roomId)?.rect;
  if (!rect) return { x: cx, y: cy };
  if (rect.w >= rect.h) {
    const x = cx - rect.x <= rect.x + rect.w - cx ? rect.x : rect.x + rect.w;
    return { x, y: rect.y + rect.h / 2 };
  }
  const y = cy - rect.y <= rect.y + rect.h - cy ? rect.y : rect.y + rect.h;
  return { x: rect.x + rect.w / 2, y };
}

/** Every camera's, guard's and cleaner's cone on the run's current turn. */
export function cones(run: RunState): Cone[] {
  const { board, turn } = run;
  const { floor } = board.level;
  const node = (id: string) => board.nodes.get(id)!;
  const fromCameras = board.cameras.map(
    (camera): Cone => ({
      id: camera.id,
      kind: "camera",
      origin: cameraMount(floor, camera.parts.flat()),
      nodes: watched(camera, turn),
      next: camera.parts.length > 1 ? watched(camera, turn + 1) : [],
    }),
  );
  const walkers = (kind: "guard" | "cleaner", group: RunState["guards"]) =>
    group.map((walker): Cone => {
      const at = node(walker.nodeId);
      return { id: walker.id, kind, origin: { x: at.x, y: at.y }, nodes: visibleFrom(board, walker), next: [] };
    });
  return [...fromCameras, ...walkers("guard", run.guards), ...walkers("cleaner", run.cleaners)];
}

/** Node id → the ids of everything that would see the player there this turn. */
export function coverage(run: RunState): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const cone of cones(run)) {
    for (const id of cone.nodes) out.set(id, [...(out.get(id) ?? []), cone.id]);
  }
  return out;
}

// ---- the player's choices ---------------------------------------------------

export interface Choice {
  /** The number key that takes it, 1–9. */
  key: number;
  nodeId: string;
  action: Action;
  /** `pick` when the way there is a locked door: the key picks it for one turn. */
  kind: "move" | "pick";
  doorId?: string;
  /** For a pick: picks so far, and the picks it needs. */
  progress?: { done: number; of: number };
}

/**
 * The player's neighbours, numbered clockwise on screen from twelve o'clock,
 * so the numbers read in the same order as the board. A neighbour behind a
 * locked door is a pick of that door. At most nine; none once the run is over.
 */
export function choices(run: RunState): Choice[] {
  if (run.status !== "playing") return [];
  const { board } = run;
  const here = board.nodes.get(run.playerNode)!;
  const from = project(here.x, here.y);
  const bearing = (id: string) => {
    const n = board.nodes.get(id)!;
    const p = project(n.x, n.y);
    const a = Math.atan2(p.x - from.x, -(p.y - from.y));
    return a < 0 ? a + 2 * Math.PI : a;
  };
  return [...neighbours(board, run.playerNode)]
    .sort((a, b) => bearing(a.to) - bearing(b.to) || a.to.localeCompare(b.to))
    .slice(0, 9)
    .map((exit, i): Choice => {
      const locked = exit.doorId !== undefined && run.locked.includes(exit.doorId);
      if (!locked) return { key: i + 1, nodeId: exit.to, action: { kind: "move", to: exit.to }, kind: "move" };
      const doorId = exit.doorId!;
      const done = run.picking?.doorId === doorId ? run.picking.progress : 0;
      return {
        key: i + 1,
        nodeId: exit.to,
        action: { kind: "pick", doorId },
        kind: "pick",
        doorId,
        progress: { done, of: board.level.pickTurns },
      };
    });
}

/** Whether the player stands on the objective and can take it. */
export function canTake(run: RunState): boolean {
  return run.status === "playing" && !run.carrying && run.playerNode === run.board.level.objective;
}

/**
 * The action a key press asks for (DESIGN.md, Keyboard): 1–9 a neighbour,
 * `W` wait, `Space` take the objective. Null for any other key, or a key with
 * nothing to do.
 */
export function actionForKey(key: string, run: RunState): Action | null {
  if (run.status !== "playing") return null;
  if (/^[1-9]$/.test(key)) return choices(run).find((c) => c.key === Number(key))?.action ?? null;
  if (key === "w" || key === "W") return { kind: "wait" };
  if (key === " " && canTake(run)) return { kind: "take" };
  return null;
}

// ---- names --------------------------------------------------------------------

/** A zone's name for the panel: the placed zone's, an entry's label, or the room's label. */
export function zoneName(placed: PlacedLevel, zoneId: string): string {
  const zone = placed.zones.find((z) => z.zoneId === zoneId);
  if (zone) return zone.name;
  const entry = placed.entries.find((e) => e.entryId === zoneId);
  if (entry) return entry.label;
  return placed.level.floor.rooms.find((r) => r.id === zoneId)?.label ?? zoneId;
}

/** The room a node is in, by its label. */
export function roomName(floor: FloorGraph, nodeId: string): string {
  const roomId = floor.nodes.find((n) => n.id === nodeId)?.roomId;
  return floor.rooms.find((r) => r.id === roomId)?.label ?? nodeId;
}

// ---- the plan and the guards' orders -------------------------------------------

export interface PlanStep {
  label: string;
  state: "done" | "next" | "todo";
}

/**
 * The run's steps, from the placed level: in, through the objective's lock,
 * take it (`objective` is the mission's line for it), out. The first one not
 * yet done is next. The crew's own numbered
 * plan (#19) replaces these once it exists.
 */
export function planSteps(placed: PlacedLevel, run: RunState, objective: string): PlanStep[] {
  const { level } = placed;
  const lock = placed.locks.find((l) => l.zoneId === placed.objective.zoneId);
  const objectiveName = zoneName(placed, placed.objective.zoneId);
  const exits = placed.entries.filter((e) => level.exits.includes(e.nodeId)).map((e) => e.label.toLowerCase());
  const steps: { label: string; done: boolean }[] = [
    { label: `In by the ${placed.entries[0].label.toLowerCase()}`, done: true },
  ];
  if (lock) {
    steps.push({
      label: `Pick the ${objectiveName.toLowerCase()} door, ${level.pickTurns} turns`,
      done: !run.locked.includes(lock.doorId) || run.carrying,
    });
  }
  steps.push({ label: objective, done: run.carrying });
  steps.push({ label: `Out by the ${joinOr(exits)}`, done: run.status === "won" });
  let nextGiven = false;
  return steps.map(({ label, done }) => {
    if (done) return { label, state: "done" };
    if (nextGiven) return { label, state: "todo" };
    nextGiven = true;
    return { label, state: "next" };
  });
}

function joinOr(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "way you came";
  return `${items.slice(0, -1).join(", ")} or the ${items[items.length - 1]}`;
}

export interface GuardOrder {
  guardId: string;
  intent: "converge";
  zoneId: string;
  zone: string;
  /** The guard's next hops toward the zone, its own node first; at most three hops. */
  path: readonly string[];
}

/**
 * The guards the engine has sent somewhere: on Alert, every guard converges
 * on the last-known zone at once, before any Chief order (alarm.ts). Each
 * comes with its next three hops, which the board draws.
 */
export function guardOrders(placed: PlacedLevel, run: RunState): GuardOrder[] {
  return run.guards.flatMap((guard): GuardOrder[] => {
    if (!guard.target) return [];
    const path = shortestPath(run.board, guard.nodeId, guard.target.nodes) ?? [guard.nodeId];
    return [
      {
        guardId: guard.id,
        intent: "converge",
        zoneId: guard.target.zoneId,
        zone: zoneName(placed, guard.target.zoneId),
        path: path.slice(0, 4),
      },
    ];
  });
}

// ---- what just happened ---------------------------------------------------------

/** One line saying what the last turn did, for the board's status line. */
export function describeTurn(placed: PlacedLevel, before: RunState, after: RunState): string {
  const { floor } = placed.level;
  const where = roomName(floor, after.playerNode);
  if (after.status === "caught") return `Caught in the ${where}.`;
  if (after.status === "won") return `Out with the files in ${after.turn} turns.`;
  const raised = after.alarmEvents.slice(before.alarmEvents.length).find((e) => e.cause.kind !== "decay");
  if (raised) {
    const by = raised.cause.id ?? "Someone";
    if (raised.cause.kind === "noise") return `${by} heard you in the ${where}.`;
    return `${by} saw you in the ${where}. The guards are converging.`;
  }
  if (!before.carrying && after.carrying) return "You have the files. Get out.";
  const opened = before.locked.find((d) => !after.locked.includes(d));
  if (opened) return "The door is open.";
  if (after.picking) return `Picking the lock, ${after.picking.progress} of ${placed.level.pickTurns}.`;
  if (after.playerNode === before.playerNode) return `You wait in the ${where}.`;
  return `You move to the ${where}.`;
}
