// Where the crew's plan sends the player next, in first person (issue 115):
// the node to head for and the engine's route there, for the corner map to
// draw. It follows the plan the Run panel shows: the crew's briefed steps when
// there are some (`crewPlanSteps`), otherwise the level's own (objective,
// then out). Pure: the run in, a route out. It decides nothing for the engine.
import { shortestPath, type RunState } from "@/engine";
import type { PlacedLevel } from "@/level/placer";
import { crewPlanSteps } from "../board";

export interface Waypoint {
  /** What the player is heading for: a step of the crew's plan, the objective, or a way out. */
  kind: "step" | "objective" | "exit";
  /** The route from where the engine has the player to the nearest goal, both ends included. */
  route: readonly string[];
}

interface Plan {
  steps: readonly { zoneId: string; action: string }[];
}

/** The engine's route to the nearest of `goals`, locks ignored: a lock on the way is one to pick. */
function routeTo(run: RunState, goals: readonly string[]): string[] | null {
  return goals.length > 0 ? shortestPath(run.board, run.playerNode, goals) : null;
}

/** The objective until it is taken, then the nearest exit. */
function levelWaypoint(run: RunState): Waypoint | null {
  const { level } = run.board;
  if (!run.carrying) {
    const route = routeTo(run, [level.objective]);
    return route ? { kind: "objective", route } : null;
  }
  const route = routeTo(run, level.exits);
  return route ? { kind: "exit", route } : null;
}

/**
 * The next place the plan sends the player, or null once the run is over.
 * A crew step on the objective's zone heads for the objective itself, and the
 * plan's last step for the nearest exit, as the steps are marked done.
 */
export function nextWaypoint(placed: PlacedLevel, run: RunState, plan: Plan | null = null): Waypoint | null {
  if (run.status !== "playing") return null;
  if (!plan) return levelWaypoint(run);
  const zones = run.board.level.zones ?? {};
  const steps = plan.steps.filter((s) => Object.hasOwn(zones, s.zoneId));
  const at = crewPlanSteps(placed, run, plan).findIndex((s) => s.state === "next");
  if (steps.length === 0 || at === -1) return levelWaypoint(run);
  const step = steps[at];
  if (at === steps.length - 1 || step.zoneId === placed.objective.zoneId) return levelWaypoint(run);
  const route = routeTo(run, zones[step.zoneId]);
  return route ? { kind: "step", route } : levelWaypoint(run);
}
