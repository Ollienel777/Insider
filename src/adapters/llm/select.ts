// Picks the chat model for a role from the environment (SPEC §4.5, §7).
//
// - fake mode (the default, and always in the gate): a ScriptedChatModel;
// - live, `LLM_PROVIDER=anthropic` (the default) with `ANTHROPIC_API_KEY`:
//   ChatAnthropic; without the key it falls back to the fake and says so;
// - live, `LLM_PROVIDER=bedrock`: ChatBedrockConverse, refused with a
//   configuration error unless `BEDROCK_ENABLED=1`.
//
// Choosing a model never calls the network; only invoking a live one does.
import { serviceModes } from "@/lib/mode";
import { anthropicModelId, createAnthropicModel, type AnthropicConfig } from "./anthropic";
import { assertBedrockEnabled, createBedrockModel } from "./bedrock";
import { ScriptedChatModel, type ScriptInput } from "./scripted";
import { LlmConfigurationError, type ChatModelSelection, type LlmProvider, type LlmRole } from "./types";

type Env = Record<string, string | undefined>;

export const DEFAULT_TIMEOUT_MS = 4_000;

export interface SelectOptions {
  /** The recorded turns the fake replays. */
  script?: ScriptInput;
  /** Test seam: replaces the Anthropic SDK client. */
  createAnthropicClient?: AnthropicConfig["createClient"];
}

export function llmProvider(env: Env): LlmProvider {
  const value = env.LLM_PROVIDER || "anthropic";
  if (value === "anthropic" || value === "bedrock") return value;
  throw new LlmConfigurationError(`LLM_PROVIDER must be "anthropic" or "bedrock", not "${value}"`);
}

/** `LLM_TIMEOUT_MS`, the fast calls' budget before the fake answers. */
export function llmTimeoutMs(env: Env): number {
  const raw = env.LLM_TIMEOUT_MS;
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new LlmConfigurationError(`LLM_TIMEOUT_MS must be a positive number of milliseconds, not "${raw}"`);
  }
  return value;
}

export function selectChatModel(role: LlmRole, env: Env, options: SelectOptions = {}): ChatModelSelection {
  const fake = (reason: string): ChatModelSelection => ({
    model: new ScriptedChatModel({ script: options.script }),
    mode: "fake",
    provider: "scripted",
    reason: `Model: ${reason}`,
  });

  if (serviceModes(env).llm === "fake") return fake("recorded turns (fake mode)");

  const provider = llmProvider(env);
  if (provider === "bedrock") {
    assertBedrockEnabled(env);
    return { model: createBedrockModel(role, env), mode: "live", provider, reason: "Model: live (Bedrock)" };
  }
  if (!env.ANTHROPIC_API_KEY) return fake("recorded turns (live mode, but ANTHROPIC_API_KEY not set)");
  const model = createAnthropicModel({
    apiKey: env.ANTHROPIC_API_KEY,
    model: anthropicModelId(role, env),
    role,
    createClient: options.createAnthropicClient,
  });
  return { model, mode: "live", provider, reason: "Model: live (Anthropic)" };
}

const logged = new Set<LlmRole>();

/**
 * The chat model for a role, from `process.env`. A fake is built per call,
 * since each carries its own script; the reason is logged once per role.
 */
export function getChatModelSelection(role: LlmRole, options: SelectOptions = {}): ChatModelSelection {
  const selection = selectChatModel(role, process.env, options);
  if (!logged.has(role)) {
    logged.add(role);
    console.info(`${selection.reason} [${role}]`);
  }
  return selection;
}

/** The fake, chosen because the demo settings forced the model to fixtures (recorded turns). */
export function forcedChatModelSelection(options: SelectOptions = {}): ChatModelSelection {
  return {
    model: new ScriptedChatModel({ script: options.script }),
    mode: "fake",
    provider: "scripted",
    reason: "Model: recorded turns (forced in demo settings)",
  };
}

export function getChatModel(role: LlmRole, options: SelectOptions = {}) {
  return getChatModelSelection(role, options).model;
}
