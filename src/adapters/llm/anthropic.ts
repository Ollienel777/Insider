// The live model on the Anthropic API, through `@langchain/anthropic`
// (SPEC §4.5). Model ids come from the environment, with the spec's defaults
// (§7; D28 confirms them).
//
// The key comes from the environment only (`ANTHROPIC_API_KEY`, select.ts).
// The crew and the Chief were measured live against Anthropic on F1 (#30);
// the unit tests and CI run it on a stubbed client, with no key.
import { ChatAnthropic, type AnthropicInput } from "@langchain/anthropic";
import type { LlmRole } from "./types";

export const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-6";

/** Output budget per role: the crew, Chief and drill calls stay short (§4.5). */
export const MAX_TOKENS: Record<LlmRole, number> = { fast: 400, builder: 16_000 };

type Env = Record<string, string | undefined>;

export interface AnthropicConfig {
  apiKey: string;
  model: string;
  role: LlmRole;
  /** Replaces the SDK client; tests pass a stub so nothing reaches the network. */
  createClient?: AnthropicInput["createClient"];
}

export function anthropicModelId(role: LlmRole, env: Env): string {
  const configured = role === "fast" ? env.ANTHROPIC_MODEL_FAST : env.ANTHROPIC_MODEL_BUILDER;
  return configured || ANTHROPIC_DEFAULT_MODEL;
}

/** The models that accept thinking turned off at their default effort. */
const THINKING_OFF = ["claude-haiku-5-5", "claude-sonnet-5", "claude-opus-5"];

/**
 * How the fast role keeps thinking out of its 400 tokens (issue 162). The
 * Claude 5 models think by default, and a thinking turn spends the budget
 * before the answer, so it comes back empty and the recording stands in.
 * Off where the model allows it; low effort where it can't be turned off.
 * The 4.x models don't think unless asked, so they get nothing.
 */
export function fastThinking(model: string): Pick<AnthropicInput, "thinking" | "outputConfig"> {
  if (THINKING_OFF.includes(model)) return { thinking: { type: "disabled" } };
  if (model === "claude-sonnet-5-5") return { thinking: { type: "between_tools" } };
  if (/^claude-(opus|sonnet|haiku)-5/.test(model) || /^claude-(fable|mythos)-/.test(model)) {
    return { outputConfig: { effort: "low" } };
  }
  return {};
}

export function createAnthropicModel(config: AnthropicConfig): ChatAnthropic {
  return new ChatAnthropic({
    apiKey: config.apiKey,
    model: config.model,
    maxTokens: MAX_TOKENS[config.role],
    ...(config.role === "fast" && fastThinking(config.model)),
    // A fast call has a 4 s budget; a retry would only spend it.
    maxRetries: config.role === "fast" ? 0 : 2,
    ...(config.createClient && { createClient: config.createClient }),
  });
}
