// The Casting Director (SPEC §4.4): a `deepagents` deep agent with planning
// todos, the subagent `location-scout` and its own tools, which narrows the
// CoStar inventory to three finalists for one mission and keeps a trace of
// how it got there.
//
// Keyless, it runs on ScriptedChatModel with the recorded script
// fixtures/llm/scripts/casting-<missionId>.json: the graph, the todos, the
// subagent dispatch and every tool run for real against the fake adapters;
// only the model's turns are recorded. Live, the same agent runs on the deep
// agents' model from the LLM adapter (the `builder` role).
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { createDeepAgent, GENERAL_PURPOSE_SUBAGENT } from "deepagents";
import { todoListMiddleware } from "langchain";
import { getCoStar } from "@/adapters/costar";
import { FIXTURE_INVENTORY } from "@/adapters/costar/fake";
import { getChatModelSelection, loadScript, type Script, ScriptedChatModel } from "@/adapters/llm";
import { getVexcel } from "@/adapters/vexcel";
import { MISSIONS } from "@/agents/builder/missions";
import { CastingResult, type CastingTrace, type InventoryProperty, type Mission } from "@/domain";
import { DIRECTOR_PROMPT, SCOUT_PROMPT, SUBAGENT_DESCRIPTIONS } from "./prompts";
import { type CastRun, directorTools, missionTool, scoutTools } from "./tools";
import { CastingTraceRecorder, type TraceRecorderOptions } from "./trace";

/** The subagents the director can dispatch, in the order deepagents lists them. */
export const CASTING_SUBAGENTS = ["general-purpose", "location-scout"] as const;

export interface CastMission {
  result: CastingResult;
  /** The deep agent's final answer. */
  summary: string;
  /** True when only fixtures and recorded model turns ran: the result may be committed to data/casting/. */
  fake: boolean;
}

export interface CastOptions extends TraceRecorderOptions {
  /** Defaults to the LLM adapter's deep-agent model, on `casting-<missionId>` in fake mode. */
  model?: BaseChatModel;
  /** A name for the model in the trace header; read from the selection by default. */
  modelLabel?: string;
  costar?: CastRun["costar"];
  vexcel?: CastRun["vexcel"];
  /** Whether `vexcel` serves live data; an adapter passed in counts as live unless this says `fake`. */
  vexcelMode?: "fake" | "live";
  missions?: readonly Mission[];
  inventory?: readonly InventoryProperty[];
  /** The run's start time, for the trace header. */
  recordedAt?: Date;
}

/** The recorded script name for a mission. */
export const scriptName = (missionId: string): string => `casting-${missionId}`;

async function scriptFor(missionId: string): Promise<Script | undefined> {
  try {
    return await loadScript(scriptName(missionId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Says plainly what ran: no language model, only the recorded script (#17, R1-M5). */
const scriptedLabel = (script: Script): string => `ScriptedChatModel (script ${script.id}, no LLM)`;

async function resolveModel(
  missionId: string,
  options: CastOptions,
): Promise<{ model: BaseChatModel; label: string; scripted: boolean }> {
  if (options.model) {
    const { model } = options;
    const script = model instanceof ScriptedChatModel ? model.script : undefined;
    const label = options.modelLabel ?? (script ? scriptedLabel(script) : model._llmType());
    return { model, label, scripted: model._llmType() === "scripted" };
  }
  const script = await scriptFor(missionId);
  const selection = getChatModelSelection("builder", { script });
  if (selection.mode === "fake") {
    if (!script) {
      throw new Error(
        `no recorded casting script for ${missionId} (fixtures/llm/scripts/${scriptName(missionId)}.json); ` +
          "fake mode cannot cast it",
      );
    }
    return { model: selection.model, label: scriptedLabel(script), scripted: true };
  }
  const id = (selection.model as { model?: unknown }).model;
  return { model: selection.model, label: `${selection.provider}${typeof id === "string" ? ` ${id}` : ""}`, scripted: false };
}

/** Casts one mission's building by running the deep agent. */
export async function castMission(missionId: string, options: CastOptions = {}): Promise<CastMission> {
  const mission = (options.missions ?? MISSIONS).find((m) => m.id === missionId);
  if (!mission) throw new Error(`no mission "${missionId}" in the library`);
  const recordedAt = options.recordedAt ?? new Date();
  const { model, label, scripted } = await resolveModel(missionId, options);
  const vexcelSelection = options.vexcel ? undefined : getVexcel();
  const vexcelLive = options.vexcel ? options.vexcelMode !== "fake" : vexcelSelection?.mode === "live";
  const run: CastRun = {
    mission: structuredClone(mission),
    costar: options.costar ?? getCoStar().adapter,
    vexcel: options.vexcel ?? vexcelSelection!.adapter,
    inventory: options.inventory ?? FIXTURE_INVENTORY,
    applied: [],
  };
  const recorder = new CastingTraceRecorder({ now: options.now });

  const agent = createDeepAgent({
    model,
    systemPrompt: DIRECTOR_PROMPT,
    tools: directorTools(run),
    // deepagents 1.16.5 adds the todo list only for some harness profiles;
    // the director passes it explicitly, as the Level Builder does (#53).
    middleware: [todoListMiddleware(), recorder.middleware("casting-director")],
    subagents: [
      // deepagents adds a general-purpose subagent unless one by that name is
      // given. Giving it here keeps it in the trace, so the trace is honest
      // about every subagent there is, and leaves it read-only: it reads the
      // mission, and only the director writes the shortlist.
      {
        ...GENERAL_PURPOSE_SUBAGENT,
        tools: [missionTool(run)],
        middleware: [recorder.middleware("general-purpose")],
      },
      {
        name: "location-scout",
        description: SUBAGENT_DESCRIPTIONS["location-scout"],
        systemPrompt: SCOUT_PROMPT,
        tools: scoutTools(run),
        middleware: [recorder.middleware("location-scout")],
      },
    ],
  });

  const traceSoFar = (): CastingTrace =>
    recorder.toTrace({
      recordedAt: recordedAt.toISOString(),
      model: label,
      subagents: [...CASTING_SUBAGENTS],
      // Only the search knows which inventory answered; until one has, only
      // the mission (a fixture) has been read.
      liveData: vexcelLive || (run.search !== undefined && run.search.source !== "fixture"),
    });

  let summary = "";
  try {
    const result = await agent.invoke(
      { messages: [{ role: "user", content: `Cast the building for mission ${missionId}.` }] },
      { recursionLimit: 80 },
    );
    const last = result.messages.at(-1);
    summary = typeof last?.content === "string" ? last.content : "";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CastingError(`the Casting Director failed on ${missionId}: ${message}`, traceSoFar(), { cause: error });
  }

  if (!run.shortlist) {
    throw new CastingError(`the Casting Director finished without writing a shortlist for ${missionId}`, traceSoFar());
  }
  const trace = traceSoFar();
  const result = CastingResult.parse({ missionId, ...run.shortlist, trace });
  return { result, summary, fake: scripted && !trace.liveData && result.source === "fixture" };
}

/** A casting run that did not produce a shortlist, with the trace of what it did. */
export class CastingError extends Error {
  constructor(
    message: string,
    /** The events recorded up to the failure; not schema-checked, and may be empty. */
    readonly trace: CastingTrace,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CastingError";
  }
}
