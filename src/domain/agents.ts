// What each agent returns (SPEC §4.4). The Crew, Chief and drill narrator
// schemas are the structured-output contracts for one model call each; the
// engine still validates and clamps their content against the board.
import { z } from "zod";
import { Id, Text } from "./common";

/** The Crew's answer to one plain-English order. */
export const CrewStep = z.object({ zoneId: Id, action: Text });
export type CrewStep = z.infer<typeof CrewStep>;

export const CrewPlan = z.object({
  steps: z.array(CrewStep).min(1),
  /** The crew's objection or caution; empty when it has none. */
  pushback: z.string(),
  confidence: z.number().min(0).max(1),
});
export type CrewPlan = z.infer<typeof CrewPlan>;

export const GuardIntent = z.enum(["hold", "sweep", "converge", "block"]);
export type GuardIntent = z.infer<typeof GuardIntent>;

export const GuardOrder = z.object({ guardId: Id, intent: GuardIntent, zoneId: Id });
export type GuardOrder = z.infer<typeof GuardOrder>;

export const CHIEF_RATIONALE_MAX = 280;

/** The Security Chief's re-plan on one alarm-state change. */
export const ChiefOrders = z.object({
  orders: z.array(GuardOrder),
  lockZones: z.array(Id),
  rationale: Text.max(CHIEF_RATIONALE_MAX),
});
export type ChiefOrders = z.infer<typeof ChiefOrders>;

/** The drill narrator's output: a scenario paragraph and three recommendations. */
export const DrillReport = z.object({
  scenario: Text,
  recommendations: z.array(Text).length(3),
});
export type DrillReport = z.infer<typeof DrillReport>;

export const BuilderAgent = z.enum(["level-builder", "data-analyst", "game-master"]);
export type BuilderAgent = z.infer<typeof BuilderAgent>;

/**
 * One line of the Level Builder's trace, as the dossier replays it: a todo,
 * a subagent task or a tool call, `atMs` after the run started.
 */
export const BuildTraceEvent = z.object({
  atMs: z.number().nonnegative(),
  kind: z.enum(["todo", "subagent", "tool"]),
  agent: BuilderAgent,
  label: Text,
  status: z.enum(["pending", "in_progress", "completed", "failed"]),
  durationMs: z.number().nonnegative().optional(),
});
export type BuildTraceEvent = z.infer<typeof BuildTraceEvent>;

/** The trace cached beside a manifest in `data/levels/`. */
export const BuildTrace = z.object({
  buildingId: Id,
  events: z.array(BuildTraceEvent).min(1),
});
export type BuildTrace = z.infer<typeof BuildTrace>;
