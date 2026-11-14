// The Level Builder (SPEC §4.4): a `deepagents` deep agent with planning
// todos, two subagents (`data-analyst`, `game-master`) and its own tools,
// which turns one building's CoStar and Vexcel data into a LevelManifest and
// a trace of how it got there.
//
// Keyless, it runs on ScriptedChatModel with the recorded script
// fixtures/llm/scripts/builder-<id>.json: the graph, the todos, the subagent
// dispatch and every tool run for real against the fake adapters; only the
// model's turns are recorded. Live, the same agent runs on the builder model
// from the LLM adapter.
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { createDeepAgent, GENERAL_PURPOSE_SUBAGENT } from "deepagents";
import { todoListMiddleware } from "langchain";
import { getCoStar } from "@/adapters/costar";
import { getChatModelSelection, loadScript, type Script } from "@/adapters/llm";
import { getVexcel } from "@/adapters/vexcel";
import { type BuilderAgent, BuildTrace, LevelManifest, SCRIPTED_MODEL_PREFIX } from "@/domain";
import type { ServiceMode } from "@/lib/mode";
import { BUILDER_PROMPT, DATA_ANALYST_PROMPT, GAME_MASTER_PROMPT, SUBAGENT_DESCRIPTIONS } from "./prompts";
import { analystTools, builderTools, type BuildRun, gameMasterTools } from "./tools";
import { TraceRecorder, type TraceRecorderOptions } from "./trace";

export interface BuiltLevel {
  manifest: LevelManifest;
  trace: BuildTrace;
  /** The deep agent's final answer. */
  summary: string;
}

export interface BuildOptions extends TraceRecorderOptions {
  /** Defaults to the LLM adapter's builder model, on `builder-<id>` in fake mode. */
  model?: BaseChatModel;
  /** A name for the model in the trace header; read from the selection by default. */
  modelLabel?: string;
  costar?: BuildRun["costar"];
  vexcel?: BuildRun["vexcel"];
  /**
   * Which of `costar` and `vexcel` serve fixtures. A passed adapter counts as
   * live unless said here, so its data stays out of the trace (SPEC §4.5).
   */
  dataModes?: { costar?: ServiceMode; vexcel?: ServiceMode };
  missions?: BuildRun["missions"];
  /** The run's start time, for the trace header. */
  recordedAt?: Date;
}

/** The subagents the builder can dispatch, as its trace lists them. */
export const SUBAGENTS = ["general-purpose", "data-analyst", "game-master"] as const satisfies readonly BuilderAgent[];

/** The recorded script name for a building. */
export const scriptName = (buildingId: string): string => `builder-${buildingId}`;

async function scriptFor(buildingId: string): Promise<Script | undefined> {
  try {
    return await loadScript(scriptName(buildingId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function resolveModel(buildingId: string, options: BuildOptions): Promise<{ model: BaseChatModel; label: string }> {
  if (options.model) return { model: options.model, label: options.modelLabel ?? options.model._llmType() };
  const script = await scriptFor(buildingId);
  const selection = getChatModelSelection("builder", { script });
  if (selection.mode === "fake") {
    if (!script) {
      throw new Error(
        `no recorded builder script for ${buildingId} (fixtures/llm/scripts/${scriptName(buildingId)}.json); ` +
          "fake mode cannot build it",
      );
    }
    // Say plainly what ran: no language model; the model's turns are the
    // script's, replayed by ScriptedChatModel (#17, R1-M5).
    return { model: selection.model, label: `${SCRIPTED_MODEL_PREFIX}${script.id}), no LLM ran` };
  }
  const id = (selection.model as { model?: unknown }).model;
  return { model: selection.model, label: `${selection.provider}${typeof id === "string" ? ` ${id}` : ""}` };
}

/** Builds one building's level by running the deep agent. */
export async function buildLevel(buildingId: string, options: BuildOptions = {}): Promise<BuiltLevel> {
  const recordedAt = options.recordedAt ?? new Date();
  const { model, label } = await resolveModel(buildingId, options);
  // The modes the adapters actually serve, as the mode chip reads them; a
  // live one that falls back to fixtures mid-run only withholds more.
  const costar = options.costar ? { adapter: options.costar, mode: options.dataModes?.costar ?? "live" } : getCoStar();
  const vexcel = options.vexcel ? { adapter: options.vexcel, mode: options.dataModes?.vexcel ?? "live" } : getVexcel();
  const liveData = costar.mode === "live" || vexcel.mode === "live";
  const run: BuildRun = { buildingId, costar: costar.adapter, vexcel: vexcel.adapter, missions: options.missions };
  const recorder = new TraceRecorder({ now: options.now, recordPayloads: !liveData });

  const agent = createDeepAgent({
    model,
    systemPrompt: BUILDER_PROMPT,
    tools: builderTools(run),
    // deepagents 1.16.5 adds the todo list only for some harness profiles;
    // the builder passes it explicitly (#53).
    middleware: [todoListMiddleware(), recorder.middleware("level-builder")],
    subagents: [
      // deepagents adds this subagent to every deep agent unless one of that
      // name is passed, and offers no switch for these models. Passed here as
      // its own default (first, where deepagents puts it), it gets the
      // recorder, so a dispatch to it shows in the trace by name (R1-M2).
      {
        ...GENERAL_PURPOSE_SUBAGENT,
        tools: builderTools(run),
        middleware: [recorder.middleware("general-purpose")],
      },
      {
        name: "data-analyst",
        description: SUBAGENT_DESCRIPTIONS["data-analyst"],
        systemPrompt: DATA_ANALYST_PROMPT,
        tools: analystTools(run),
        middleware: [recorder.middleware("data-analyst")],
      },
      {
        name: "game-master",
        description: SUBAGENT_DESCRIPTIONS["game-master"],
        systemPrompt: GAME_MASTER_PROMPT,
        tools: gameMasterTools(run),
        middleware: [recorder.middleware("game-master")],
      },
    ],
  });

  const traceSoFar = (): BuildTrace =>
    recorder.toTrace(buildingId, { recordedAt: recordedAt.toISOString(), model: label, liveData, subagents: [...SUBAGENTS] });

  let summary = "";
  try {
    const result = await agent.invoke(
      { messages: [{ role: "user", content: `Build the level for building ${buildingId}.` }] },
      { recursionLimit: 60 },
    );
    const last = result.messages.at(-1);
    summary = typeof last?.content === "string" ? last.content : "";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new LevelBuildError(`the Level Builder failed on ${buildingId}: ${message}`, traceSoFar(), { cause: error });
  }

  if (!run.manifest) {
    throw new LevelBuildError(`the Level Builder finished without writing a manifest for ${buildingId}`, traceSoFar());
  }
  return { manifest: LevelManifest.parse(run.manifest), trace: BuildTrace.parse(traceSoFar()), summary };
}

/** A build that did not produce a manifest, with the trace of what it did. */
export class LevelBuildError extends Error {
  constructor(
    message: string,
    /** The events recorded up to the failure; not schema-checked, and may be empty. */
    readonly trace: BuildTrace,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LevelBuildError";
  }
}
