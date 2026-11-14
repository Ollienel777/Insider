import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ServiceMode } from "@/lib/mode";

/** `builder`: the Level Builder's deep agent. `fast`: crew, Chief and drill. */
export type LlmRole = "builder" | "fast";

export type LlmProvider = "anthropic" | "bedrock";

export interface ChatModelSelection {
  model: BaseChatModel;
  mode: ServiceMode;
  /** The live provider, or `scripted` for the fake. */
  provider: LlmProvider | "scripted";
  /** One line saying why, for logs and the mode chip's tooltip. */
  reason: string;
}

/** The environment asks for something the adapter will not do. */
export class LlmConfigurationError extends Error {
  constructor(message: string) {
    super(`LLM configuration: ${message}`);
    this.name = "LlmConfigurationError";
  }
}
