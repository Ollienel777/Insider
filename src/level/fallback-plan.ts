// The crew's fallback on a building with no recorded replies (issue 140): a
// plan worked out from the placed level itself, in the browser, when the
// crew's model is slow or fails and no recording can stand in (a kit
// building's level lives in memory, so it has none). No model is called and
// nothing is sent or stored: the floor never leaves the browser (SPEC §4.5).
//
// The plan is in the crew's own shape, steps to zones, and it is the quiet way
// when the floor has one. A crew step walks the shortest way to its zone and
// then waits as its words say, so the plan can wait only where a zone is: at
// the way in, in a quiet zone the quiet route passes through (on the way in,
// and back through it on the way out), or at the objective. The fallback tries those shapes, fewest waits first, and keeps
// the first one the board plays clean. Its pushback names what those waits get
// past: the camera or guard that catches the same plan played without them.
// With no quiet way through, the plan is the shortest one, and the pushback
// says who catches it and where.
//
// Pure: same placement, same plan.
"use client";

import type { CrewPlan } from "@/domain";
import { objectiveNoun } from "@/lib/objective-noun";
import type { PlacedEntry, PlacedLevel } from "./placer";
import { adviceFor, validatePlan, zoneLabel } from "./validate-plan";

/** How sure the crew sounds: a plan the board plays clean, or one it knows is caught. */
const SURE_CLEAN = 0.6;
const SURE_CAUGHT = 0.3;
/** The most turns the plan waits at one stop; past this the shapes are not worth trying. */
const MAX_WAIT = 4;

const TURNS = ["", "one turn", "two turns", "three turns", "four turns"];

type Step = CrewPlan["steps"][number];

/** A warning's text in the crew's voice: "sees you" becomes "sees us". */
const ours = (text: string) => text.replace(/\b(sees|hears|spots) you\b/g, "$1 us");

export function fallbackPlan(placed: PlacedLevel): CrewPlan {
  const { level } = placed;
  const way = (e: PlacedEntry) => e.label.toLowerCase();
  const start = placed.entries.find((e) => e.nodeId === level.start) ?? placed.entries[0];
  const noun = objectiveNoun(level.missionId);
  if (!start) {
    return {
      steps: [{ zoneId: placed.objective.zoneId, action: `Take the ${noun}` }],
      pushback: "This floor has no way in on the board.",
      confidence: SURE_CAUGHT,
    };
  }
  const advice = adviceFor(placed);
  const exits = placed.entries.filter((e) => level.exits.includes(e.nodeId));
  // The quiet route's own exit first, then the way in, then the rest.
  const leaves = advice?.path.at(-1);
  const exitOrder = [...exits].sort(
    (a, b) =>
      Number(b.nodeId === leaves) - Number(a.nodeId === leaves) ||
      Number(b === start) - Number(a === start) ||
      a.entryId.localeCompare(b.entryId),
  );
  if (exitOrder.length === 0) exitOrder.push(start);
  // Quiet zones the quiet route passes through: the only stops between the way in and the objective where a wait can sit.
  const onRoute = new Set(advice?.path ?? []);
  const quietStops = placed.zones.filter((z) => z.role === "quiet" && z.nodes.some((n) => onRoute.has(n)));

  const waitWords = (n: number) => (n > 0 ? `, and wait ${TURNS[n]} there` : "");
  type Stop = { zoneId: string; wait: number } | null;
  const through = (stop: Stop): Step[] => (stop ? [{ zoneId: stop.zoneId, action: `Through ${zoneLabel(placed, stop.zoneId)}${waitWords(stop.wait)}` }] : []);
  const shape = (waitIn: number, stop: Stop, waitAtObjective: number, exit: PlacedEntry, back: Stop = null): Step[] => [
    { zoneId: start.entryId, action: `In by the ${way(start)}${waitWords(waitIn)}` },
    ...through(stop),
    {
      zoneId: placed.objective.zoneId,
      action: `Take the ${noun}${waitAtObjective > 0 ? `, then wait ${TURNS[waitAtObjective]} by it` : ""}`,
    },
    // On the way out, back through a quiet zone when the quiet route leaves that way.
    ...through(back && { ...back, wait: 0 }),
    { zoneId: exit.entryId, action: `Out by the ${way(exit)}` },
  ];

  /**
   * With nothing in the way, who the plan stays clear of: a guard whose round crosses its path, or
   * a camera that covers it, else the board's cameras and guards by name (issue 140: the pushback
   * names a camera or guard).
   */
  const clearOf = (steps: Step[]): string => {
    const path = new Set(validatePlan(placed, { steps, pushback: "", confidence: 0 }).path);
    const guard = placed.guards.find((g) => g.patrol.some((n) => path.has(n)));
    if (guard) return `${guard.id}'s round crosses it, but never while we're on it.`;
    const camera = placed.cameras.find((c) => c.cover.some((n) => path.has(n)));
    if (camera) return `${camera.id} covers it, but it's looking away when we pass.`;
    const ids = [...placed.cameras.map((c) => c.id), ...placed.guards.map((g) => g.id)].slice(0, 3);
    if (ids.length === 0) return "There's no camera or guard on this floor.";
    const named = ids.length === 1 ? ids[0] : `${ids.slice(0, -1).join(", ")} and ${ids.at(-1)}`;
    return `${named} never get${ids.length === 1 ? "s" : ""} eyes on it.`;
  };

  // The shapes, fewest waits first; the first the board plays clean is the plan.
  let best: Step[] | null = null;
  if (advice) {
    const stops = [null, ...quietStops.flatMap((z) => [0, 1, 2].map((wait) => ({ zoneId: z.zoneId, wait })))];
    search: for (let total = 0; total <= 2 * MAX_WAIT + 2; total++) {
      for (let waitIn = 0; waitIn <= Math.min(total, MAX_WAIT); waitIn++) {
        for (const stop of stops) {
          const waitAtObjective = total - waitIn - (stop?.wait ?? 0);
          if (waitAtObjective < 0 || waitAtObjective > MAX_WAIT) continue;
          for (const exit of exitOrder) {
            for (const back of [null, ...quietStops.map((z) => ({ zoneId: z.zoneId, wait: 0 }))]) {
              const steps = shape(waitIn, stop, waitAtObjective, exit, back);
              const checked = validatePlan(placed, { steps, pushback: "", confidence: 0 });
              if (checked.outcome === "clean" && checked.dropped.length === 0) {
                best = steps;
                break search;
              }
            }
          }
        }
      }
    }
  }

  if (best) {
    // What the plan gets past: the same plan with no waits, or else the straight way with no
    // stops, and what catches it. The pushback names that camera or guard.
    const exit = placed.entries.find((e) => e.entryId === best.at(-1)!.zoneId) ?? start;
    const caughtOn = (steps: Step[]) => validatePlan(placed, { steps, pushback: "", confidence: 0 }).warnings[0];
    const hurried = caughtOn(best.map((s) => ({ ...s, action: s.action.replace(/, (and|then) wait .*$/, "") })));
    const straight = caughtOn(shape(0, null, 0, exit));
    const stop = best.find((s) => s.action.startsWith("Through "));
    const pushback = hurried?.by
      ? `${ours(hurried.text)} The waits in this plan let ${hurried.by} look away: hold where it says, then move.`
      : straight?.by && stop
        ? `${ours(straight.text)} Going through ${zoneLabel(placed, stop.zoneId)} keeps us out of ${straight.by}'s way.`
        : `Nothing sees this way if we keep moving: in by the ${way(start)}, out by the ${way(exit)}. ${clearOf(best)}`;
    return { steps: best, pushback, confidence: SURE_CLEAN };
  }

  // No quiet way through (or none that fits a plan's stops): the shortest plan, and who catches it.
  const steps = shape(0, null, 0, exitOrder[0]);
  const warning = validatePlan(placed, { steps, pushback: "", confidence: 0 }).warnings[0];
  const caughtLine = warning ? ` ${ours(warning.text)}` : "";
  const pushback = advice
    ? `I can't fit the quiet way into a plan here; follow the waits the board marks.${caughtLine}`
    : `There's no way through this floor unseen.${caughtLine}`;
  return { steps, pushback, confidence: SURE_CAUGHT };
}
