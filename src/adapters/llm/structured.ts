// One structured model call with a recorded fallback (SPEC §4.4, §4.5): the
// crew, the Chief and the drill narrator each make exactly one. In fake mode
// the fake answers without a call. Live, the call has `LLM_TIMEOUT_MS`
// (default 4 s); on a timeout, an error or an answer that fails the schema,
// the fake answers instead. Either way the answer says whether it was
// recorded, so the UI can show its "recorded reply" chip.
import { ChatAnthropic } from "@langchain/anthropic";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import type { z } from "zod";
import { safeErrorMessage } from "./redact";
import { getChatModelSelection, llmTimeoutMs } from "./select";
import { LlmConfigurationError, type ChatModelSelection, type LlmRole } from "./types";

export interface StructuredAnswer<T> {
  value: T;
  /** True when the fake answered: fake mode, a timeout, or a failed call. */
  recorded: boolean;
  /**
   * Why the fake answered; absent for a live answer. "configuration": a setting refuses every live
   * call, so no model was built or called (the chip reads fixtures for the same setting).
   */
  reason?: "fake mode" | "configuration" | "timeout" | "error";
}

/** Why the recorded answer was asked for. */
export type StandInReason = NonNullable<StructuredAnswer<unknown>["reason"]>;

export interface StructuredCallOptions<T> {
  /** The recorded answer, or a function that returns it; the function is told why it is asked. */
  fake: T | ((reason: StandInReason) => T | Promise<T>);
  /** Defaults to `LLM_TIMEOUT_MS`, then 4000. */
  timeoutMs?: number;
  /** The tool or schema name the model sees. */
  name?: string;
  role?: LlmRole;
  /** Defaults to the role's model from the environment. */
  selection?: ChatModelSelection;
}

class TimeoutError extends Error {}

async function recorded<T>(schema: z.ZodType<T>, fake: StructuredCallOptions<T>["fake"], reason: StandInReason): Promise<T> {
  const value = typeof fake === "function" ? await (fake as (reason: StandInReason) => T | Promise<T>)(reason) : fake;
  // A recording that no longer fits the schema is a bug, not a fallback.
  return schema.parse(value);
}

export async function structuredCall<T>(
  schema: z.ZodType<T>,
  prompt: BaseLanguageModelInput,
  options: StructuredCallOptions<T>,
): Promise<StructuredAnswer<T>> {
  const name = options.name ?? "answer";
  let selection: ChatModelSelection;
  let timeoutMs: number;
  try {
    selection = options.selection ?? getChatModelSelection(options.role ?? "fast");
    timeoutMs = selection.mode === "fake" ? 0 : (options.timeoutMs ?? llmTimeoutMs(process.env));
  } catch (error) {
    // A setting that refuses every live call: no model is called, and the recording answers.
    if (!(error instanceof LlmConfigurationError)) throw error;
    console.warn(`structuredCall(${name}): no model was called; the recorded answer stands in (configuration: ${error.message})`);
    return { value: await recorded(schema, options.fake, "configuration"), recorded: true, reason: "configuration" };
  }
  if (selection.mode === "fake") {
    return { value: await recorded(schema, options.fake, "fake mode"), recorded: true, reason: "fake mode" };
  }

  // Anthropic's native structured output works on every current model; the
  // tool-forcing default does not (forced tool_choice is refused on some).
  const method = selection.model instanceof ChatAnthropic ? "jsonSchema" : undefined;
  const runnable = selection.model.withStructuredOutput(schema, { name, ...(method && { method }) });

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(`no answer within ${timeoutMs} ms`));
    }, timeoutMs);
  });

  try {
    const raw = await Promise.race([runnable.invoke(prompt, { signal: controller.signal }), timeout]);
    return { value: schema.parse(raw), recorded: false };
  } catch (error) {
    const reason = error instanceof TimeoutError ? "timeout" : "error";
    console.warn(`structuredCall(${name}): the recorded answer stands in (${reason}: ${safeErrorMessage(error)})`);
    return { value: await recorded(schema, options.fake, reason), recorded: true, reason };
  } finally {
    clearTimeout(timer);
  }
}
