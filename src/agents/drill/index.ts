// The drill narrator (SPEC §4.4). Server only.
export {
  narrateDrill,
  NarratorUnavailableError,
  NARRATOR_PROMPT_HEAD,
  narratorMessages,
  narratorSystemPrompt,
  type NarrateOptions,
  type NarrativeAnswer,
} from "./narrator";
export { DrillRecording, loadDrillRecording, matchNarrative, NoNarrativeError, RecordedNarrative } from "./recorded";
