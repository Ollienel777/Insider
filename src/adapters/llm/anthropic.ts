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

export function createAnthropicModel(config: AnthropicConfig): ChatAnthropic {
  return new ChatAnthropic({
    apiKey: config.apiKey,
    model: config.model,
    maxTokens: MAX_TOKENS[config.role],
    // A fast call has a 4 s budget; a retry would only spend it.
    maxRetries: config.role === "fast" ? 0 : 2,
    ...(config.createClient && { createClient: config.createClient }),
  });
}
