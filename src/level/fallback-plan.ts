// The crew's fallback on a building with no recorded replies (issue 140): a
// plan worked out from the placed level itself, in the browser, when the
// crew's model is slow or fails and no recording can stand in (a kit
// building's level lives in memory, so it has none). No model is called and
// nothing is sent or stored: the floor never leaves the browser (SPEC §4.5).
//
// The plan is the crew's own shape, three steps: in by the entry the run
// starts at, take the objective (the board inserts any picks on the way), and
// out by the quiet route's exit, or the way in when the floor has no quiet
// route. Its pushback is the board's answer to that plan: what sees it, where
// and on which turn, and the quiet route's first wait, or that there is no way
// through unseen.
//
// Pure: same placement, same plan.
"use client";

import type { CrewPlan } from "@/domain";
import { objectiveNoun } from "@/lib/objective-noun";
import type { PlacedEntry, PlacedLevel } from "./placer";
import { validatePlan } from "./validate-plan";

/** How sure the crew sounds about a plan the board worked out: a quiet way exists, or it doesn't. */
const SURE_WITH_ROUTE = 0.6;
const SURE_WITHOUT = 0.3;

export function fallbackPlan(placed: PlacedLevel): CrewPlan {
  const { level } = placed;
  const way = (e: PlacedEntry) => e.label.toLowerCase();
  const start = placed.entries.find((e) => e.nodeId === level.start) ?? placed.entries[0];
  const noun = objectiveNoun(level.missionId);
  const steps = (exit: PlacedEntry) => [
    { zoneId: start.entryId, action: `In by the ${way(start)}` },
    { zoneId: placed.objective.zoneId, action: `Take the ${noun}` },
    { zoneId: exit.entryId, action: `Out by the ${way(exit)}` },
  ];

  // Out the way the quiet route leaves, when there is one; else back the way in.
  const first = validatePlan(placed, { steps: steps(start), pushback: "", confidence: 0 });
  const leaves = first.advice?.path.at(-1);
  const exit = placed.entries.find((e) => e.nodeId === leaves && level.exits.includes(e.nodeId)) ?? start;
  const plan = { steps: steps(exit), pushback: "", confidence: 0 };
  const checked = exit === start ? first : validatePlan(placed, plan);

  const warning = checked.warnings[0];
  const wait = checked.advice?.waits[0];
  const pushback =
    checked.outcome === "clean"
      ? `Nothing on this way sees us if we keep moving. In by the ${way(start)}, out by the ${way(exit)}.`
      : [
          warning ? warning.text : null,
          checked.advice ? (wait ? `The quiet way: ${wait.text}` : checked.advice.summary) : `There's no way through this floor unseen; the board shows where we're caught.`,
        ]
          .filter((line): line is string => line !== null)
          .join(" ");
  return { steps: plan.steps, pushback, confidence: checked.noQuietRoute ? SURE_WITHOUT : SURE_WITH_ROUTE };
}
