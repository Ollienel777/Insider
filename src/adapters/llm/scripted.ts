// ScriptedChatModel: the keyless model every agent runs on in fake mode and
// in CI (SPEC §4.4). It is a real LangChain chat model (`bindTools`,
// `withStructuredOutput`), so a `deepagents` agent's graph, todos, subagent
// dispatch and tools all run for real; only the model's turns are recorded.
//
// A script is keyed by agent, not by global call order (spec review R1-M8).
// On each call the model works out *who* is asking from the call itself:
//
// - the agent: the script entry whose `systemIncludes` occurs in the call's
//   system prompt (and whose optional `task` occurs in the task message);
// - the turn: how many assistant messages follow that task message.
//
// Both are read from the messages, not from state kept between calls, so two
// subagents dispatched in parallel through deepagents' `task` tool each get
// their own turns whatever order their calls interleave in.
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BaseChatModelParams,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import { AIMessage, type BaseMessage, type MessageContent } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { RunnableLambda, type Runnable } from "@langchain/core/runnables";
import { z } from "zod";

// ── The script format (fixtures/llm/scripts/*.json) ─────────────────────────

export const ScriptedToolCall = z.object({
  name: z.string().min(1),
  args: z.record(z.string(), z.unknown()).default({}),
  /** Defaults to `<agent>-t<turn>-<index>`, so ids are stable across runs. */
  id: z.string().min(1).optional(),
});
export type ScriptedToolCall = z.infer<typeof ScriptedToolCall>;

/** One recorded assistant message. */
export const ScriptedTurn = z.object({
  content: z.string().default(""),
  toolCalls: z.array(ScriptedToolCall).default([]),
});
export type ScriptedTurn = z.infer<typeof ScriptedTurn>;

/** The turns of one agent or subagent, in order. */
export const ScriptedAgent = z.object({
  /** A name for errors and the call log: the agent or subagent name. */
  agent: z.string().min(1),
  /** Text that occurs in this agent's system prompt and no other's. */
  systemIncludes: z.string().min(1),
  /** Narrows the entry to tasks whose message contains this text. */
  task: z.string().min(1).optional(),
  turns: z.array(ScriptedTurn).min(1),
});
export type ScriptedAgent = z.infer<typeof ScriptedAgent>;

export const Script = z.object({
  id: z.string().min(1),
  /** Set when the turns were recorded from a live model (`npm run record:builds`), not written by hand. */
  recorded: z.object({ model: z.string().min(1), recordedAt: z.iso.datetime() }).optional(),
  agents: z.array(ScriptedAgent).min(1),
});
export type Script = z.infer<typeof Script>;
export type ScriptInput = z.input<typeof Script>;

export const SCRIPTS_DIR = path.join(process.cwd(), "fixtures", "llm", "scripts");

/** Reads and validates `fixtures/llm/scripts/<name>.json`. */
export async function loadScript(name: string, dir: string = SCRIPTS_DIR): Promise<Script> {
  if (!/^[\w-]+$/.test(name)) throw new ScriptError(`invalid script name "${name}"`);
  const file = path.join(dir, `${name}.json`);
  const parsed = Script.safeParse(JSON.parse(await readFile(file, "utf8")));
  if (!parsed.success) {
    throw new ScriptError(`${file} is not a valid script: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export class ScriptError extends Error {
  constructor(message: string) {
    super(`ScriptedChatModel: ${message}`);
    this.name = "ScriptError";
  }
}

// ── The model ───────────────────────────────────────────────────────────────

/** One answered call, in the order calls were answered. */
export interface ScriptedCall {
  agent: string;
  turn: number;
  toolCalls: string[];
}

type ScriptedCallOptions = BaseChatModelCallOptions & { tools?: BindToolsInput[] };

export interface ScriptedChatModelFields extends BaseChatModelParams {
  /** Without one, every call fails, saying no script was given. */
  script?: ScriptInput;
}

function text(content: MessageContent): string {
  if (typeof content === "string") return content;
  return content
    .map((block) => (block.type === "text" && typeof block.text === "string" ? block.text : ""))
    .join("\n");
}

function toolName(tool: BindToolsInput): string | undefined {
  const t = tool as { name?: unknown; function?: { name?: unknown }; toolSpec?: { name?: unknown } };
  const name = t.name ?? t.function?.name ?? t.toolSpec?.name;
  return typeof name === "string" ? name : undefined;
}

export class ScriptedChatModel extends BaseChatModel<ScriptedCallOptions> {
  readonly script: Script | undefined;
  /** Every call answered so far. Shared by every binding of this model. */
  readonly calls: ScriptedCall[] = [];

  static lc_name() {
    return "ScriptedChatModel";
  }

  constructor(fields: ScriptedChatModelFields) {
    super(fields);
    this.script = fields.script === undefined ? undefined : Script.parse(fields.script);
  }

  _llmType() {
    return "scripted";
  }

  /** Which entry and turn a call is: see the header comment. */
  locate(messages: BaseMessage[]): { entry: ScriptedAgent; turn: number } {
    const script = this.script;
    if (!script) {
      throw new ScriptError("no script was given; pass one to getChatModel or the ScriptedChatModel constructor");
    }
    const system = messages
      .filter((m) => m.getType() === "system")
      .map((m) => text(m.content))
      .join("\n");
    let taskAt = -1;
    messages.forEach((m, i) => {
      if (m.getType() === "human") taskAt = i;
    });
    const task = taskAt >= 0 ? text(messages[taskAt].content) : "";

    const matches = script.agents.filter(
      (a) => system.includes(a.systemIncludes) && (a.task === undefined || task.includes(a.task)),
    );
    // Entries narrowed by `task` win over general ones that also match.
    const narrowed = matches.some((a) => a.task !== undefined)
      ? matches.filter((a) => a.task !== undefined)
      : matches;
    if (narrowed.length === 0) {
      throw new ScriptError(
        `script "${script.id}" has no agent whose systemIncludes occurs in this call's system prompt ` +
          `(it starts "${system.slice(0, 80)}")`,
      );
    }
    if (narrowed.length > 1) {
      throw new ScriptError(
        `script "${script.id}": the call matches several agents (${narrowed.map((a) => a.agent).join(", ")}); ` +
          "make their systemIncludes or task distinct",
      );
    }
    const turn = messages.slice(taskAt + 1).filter((m) => m.getType() === "ai").length;
    return { entry: narrowed[0], turn };
  }

  async _generate(messages: BaseMessage[], options: this["ParsedCallOptions"]): Promise<ChatResult> {
    options.signal?.throwIfAborted();
    const { entry, turn } = this.locate(messages);
    const id = this.script?.id;
    const recorded = entry.turns[turn];
    if (!recorded) {
      throw new ScriptError(
        `script "${id}", agent "${entry.agent}": no turn ${turn} (it has ${entry.turns.length})`,
      );
    }

    const bound = (options.tools ?? []).map(toolName).filter((n): n is string => n !== undefined);
    for (const call of recorded.toolCalls) {
      if (!bound.includes(call.name)) {
        throw new ScriptError(
          `script "${id}", agent "${entry.agent}", turn ${turn}: calls "${call.name}", ` +
            `which is not bound (bound: ${bound.join(", ") || "none"})`,
        );
      }
    }

    const message = new AIMessage({
      content: recorded.content,
      tool_calls: recorded.toolCalls.map((call, i) => ({
        type: "tool_call" as const,
        name: call.name,
        args: structuredClone(call.args),
        id: call.id ?? `${entry.agent}-t${turn}-${i}`,
      })),
    });
    this.calls.push({ agent: entry.agent, turn, toolCalls: recorded.toolCalls.map((c) => c.name) });
    return { generations: [{ text: recorded.content, message }] };
  }

  override bindTools(tools: BindToolsInput[], kwargs?: Partial<ScriptedCallOptions>) {
    return this.withConfig({ ...kwargs, tools } as Partial<ScriptedCallOptions>);
  }

  /**
   * Binds the schema as one tool and returns that tool call's arguments,
   * validated by the schema when it is a zod schema. A script answers it
   * with a turn that calls the tool, named `config.name` or `extract`.
   */
  // The base class declares this with overloads for every schema kind; one
  // implementation serves them all.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override withStructuredOutput(outputSchema: any, config?: { name?: string; includeRaw?: boolean }): Runnable<BaseLanguageModelInput, any> {
    const name = config?.name ?? "extract";
    const schema = outputSchema as z.ZodType | Record<string, unknown>;
    const bound = this.bindTools([{ name, description: "Structured output", schema }]);
    return RunnableLambda.from(async (input: BaseLanguageModelInput, runConfig) => {
      const raw = await bound.invoke(input, runConfig);
      const call = raw.tool_calls?.find((c) => c.name === name);
      if (!call) throw new ScriptError(`expected a "${name}" tool call for structured output`);
      const parsed = schema instanceof z.ZodType ? schema.parse(call.args) : call.args;
      return config?.includeRaw ? { raw, parsed } : parsed;
    });
  }
}
