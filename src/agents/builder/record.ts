// Turns a build's recorded model turns into a ScriptedChatModel script, so a
// live run can be replayed keyless (`npm run record:builds`, #31).
//
// ScriptedChatModel finds a call's entry by the agent's system prompt (and,
// when one agent has several entries, by its task message), and its turn by
// how many assistant messages follow that task. So the turns are grouped by
// agent and task, in the order they returned: within one task an agent's
// calls run one after another, so that order is the turn number.
import path from "node:path";
import { Script } from "@/adapters/llm/scripted";
import type { BuilderAgent } from "@/domain";
import { BUILDER_PROMPT, DATA_ANALYST_PROMPT, GAME_MASTER_PROMPT } from "./prompts";
import type { RecordedTurn } from "./trace";

/** Where `npm run record:builds` saves live runs: scripts, manifests and traces. */
export const RECORDED_DIR = path.join(process.cwd(), "fixtures", "llm", "recorded");

/** The line of each agent's system prompt that no other prompt contains. */
export const SYSTEM_INCLUDES: Record<BuilderAgent, string> = {
  "level-builder": BUILDER_PROMPT.split("\n")[0],
  "data-analyst": DATA_ANALYST_PROMPT.split("\n")[0],
  "game-master": GAME_MASTER_PROMPT.split("\n")[0],
};

export interface RecordedFrom {
  /** The live model, as the trace names it, e.g. `anthropic claude-sonnet-4-6`. */
  model: string;
  recordedAt: string;
}

/** The script that replays `turns`. */
export function scriptFromTurns(id: string, turns: readonly RecordedTurn[], recorded?: RecordedFrom): Script {
  const groups = new Map<string, { agent: BuilderAgent; task: string; turns: RecordedTurn[] }>();
  for (const turn of turns) {
    const key = `${turn.agent}\u0000${turn.task}`;
    const group = groups.get(key) ?? { agent: turn.agent, task: turn.task, turns: [] };
    group.turns.push(turn);
    groups.set(key, group);
  }

  const tasksPerAgent = new Map<BuilderAgent, number>();
  for (const { agent } of groups.values()) tasksPerAgent.set(agent, (tasksPerAgent.get(agent) ?? 0) + 1);

  const agents = [...groups.values()].map(({ agent, task, turns: own }) => {
    const several = (tasksPerAgent.get(agent) ?? 0) > 1;
    if (several && task === "") throw new Error(`${agent} ran several tasks, one with no task message to tell it apart`);
    return {
      agent,
      systemIncludes: SYSTEM_INCLUDES[agent],
      // Only an agent dispatched more than once needs its task to tell the entries apart.
      ...(several && { task }),
      turns: own.map(({ content, toolCalls }) => ({ content, toolCalls })),
    };
  });
  return Script.parse({ id, ...(recorded && { recorded }), agents });
}
