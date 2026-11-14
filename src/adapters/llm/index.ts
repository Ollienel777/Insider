// The LLM adapter (SPEC §4.5): every agent gets its chat model here, and the
// crew, Chief and drill narrator make their one structured call through
// `structuredCall`. See select.ts for how the mode and provider are chosen.
export {
  DEFAULT_TIMEOUT_MS,
  forcedChatModelSelection,
  getChatModel,
  getChatModelSelection,
  llmProvider,
  llmTimeoutMs,
  selectChatModel,
  type SelectOptions,
} from "./select";
export { REDACTED, redactSecrets, safeErrorMessage } from "./redact";
export { loadScript, Script, ScriptedChatModel, ScriptError, type ScriptedCall } from "./scripted";
export { structuredCall, type StructuredAnswer, type StructuredCallOptions } from "./structured";
export { LlmConfigurationError, type ChatModelSelection, type LlmProvider, type LlmRole } from "./types";
