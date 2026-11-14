// The quiet route (issue #15, #19): the placement's own answer to "is there a
// way to the objective and back out that nobody sees?". It is computed from
// the placed level by playing the engine forward, so it is the engine's
// answer, not a second model of it: every turn on the route stays Calm, and
// the run ends won. The crew's advice (src/level/validate-plan.ts) reads this
// route; it never re-derives one.
//
// Pure: a breadth-first search over engine states, one layer per turn, so the
// route found has the fewest turns. Among routes of equal length, moves are
// tried before waiting (so a wait sits as late as it can, next to what it
// waits for), and the way back out through the entry the run started from is
// preferred over another exit.
"use client";

import { act, createRun, neighbours, type Action, type RunState } from "@/engine";
import type { PlacedLevel } from "./placer";

/** No route on a demo floor is longer than this; past it the search gives up. */
export const MAX_ROUTE_TURNS = 60;

/** What makes two states the same for the rest of the run (the turn is the layer). */
function keyOf(run: RunState): string {
  const walkers = (group: RunState["guards"]) =>
    group.map((g) => `${g.nodeId}:${g.waypoint}:${g.idle}:${g.target?.zoneId ?? ""}`).join(",");
  return [
    run.playerNode,
    run.carrying ? 1 : 0,
    run.picking ? `${run.picking.doorId}:${run.picking.progress}` : "",
    run.locked.join(","),
    walkers(run.guards),
    walkers(run.cleaners),
  ].join("|");
}

/** The actions worth trying from a state: moves (in id order), picks, take, then wait. */
function candidates(run: RunState): Action[] {
  const out: Action[] = [];
  const exits = [...neighbours(run.board, run.playerNode)].sort((a, b) => a.to.localeCompare(b.to));
  for (const exit of exits) {
    if (exit.doorId !== undefined && run.locked.includes(exit.doorId)) out.push({ kind: "pick", doorId: exit.doorId });
    else out.push({ kind: "move", to: exit.to });
  }
  if (!run.carrying && run.playerNode === run.board.level.objective) out.unshift({ kind: "take" });
  out.push({ kind: "wait" });
  return out;
}

/**
 * The shortest route from the start to the objective and out by an exit on
 * which nothing raises the alarm, as engine actions; null when the floor has
 * none within `maxTurns`.
 */
export function quietRoute(placed: PlacedLevel, maxTurns: number = MAX_ROUTE_TURNS): Action[] | null {
  const start = createRun(placed.level);
  type Node = { run: RunState; actions: Action[] };
  let layer: Node[] = [{ run: start, actions: [] }];
  for (let turn = 0; turn < maxTurns && layer.length > 0; turn++) {
    const seen = new Set<string>();
    const next: Node[] = [];
    let won: Action[][] = [];
    for (const { run, actions } of layer) {
      for (const action of candidates(run)) {
        const result = act(run, action);
        if (!result.ok) continue;
        const after = result.run;
        if (after.alarmEvents.length > 0 || after.status === "caught") continue;
        const path = [...actions, action];
        if (after.status === "won") {
          won.push(path);
          continue;
        }
        const key = keyOf(after);
        if (seen.has(key)) continue;
        seen.add(key);
        next.push({ run: after, actions: path });
      }
    }
    if (won.length > 0) {
      // Out the way you came in, when that is as short as any other exit.
      const home = won.filter((path) => {
        const last = path[path.length - 1];
        return last.kind === "move" && last.to === placed.level.start;
      });
      won = home.length > 0 ? home : won;
      return won[0];
    }
    layer = next;
  }
  return null;
}
