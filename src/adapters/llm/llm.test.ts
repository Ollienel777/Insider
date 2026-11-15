// Mode and provider selection, the live adapters on a stubbed SDK client, and
// structuredCall's fallback. Nothing here reaches the network.
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatBedrockConverse } from "@langchain/aws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  getChatModel,
  LlmConfigurationError,
  llmTimeoutMs,
  ScriptedChatModel,
  selectChatModel,
  structuredCall,
} from "./index";

const Answer = z.object({ say: z.string() });
const FAKE = { say: "recorded" };
const PROMPT = [
  { role: "system", content: "You are the crew." },
  { role: "user", content: "Go in through the dock." },
];

interface StubCall {
  request: Record<string, unknown>;
  signal?: AbortSignal;
}

/** An Anthropic SDK client that answers `reply` after `delayMs`, honouring abort. */
function stubClient(reply: string, delayMs = 0) {
  const calls: StubCall[] = [];
  const create = (request: Record<string, unknown>, options?: { signal?: AbortSignal }) => {
    calls.push({ request, signal: options?.signal });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          resolve({
            id: "msg_stub",
            type: "message",
            role: "assistant",
            model: request.model,
            content: [{ type: "text", text: reply }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        delayMs,
      );
      options?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      });
    });
  };
  const client = { messages: { create }, beta: { messages: { create } } };
  return { createClient: () => client, calls };
}

const LIVE = { HEIST_MODE: "live", ANTHROPIC_API_KEY: "test-key" };

describe("selecting the model", () => {
  let fetchCalls = 0;
  beforeEach(() => {
    fetchCalls = 0;
    // No test in this file may reach the network.
    vi.stubGlobal("fetch", () => {
      fetchCalls += 1;
      throw new Error("network access in a keyless test");
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("with no keys, returns fakes and makes no network call", async () => {
    for (const env of [{}, { HEIST_MODE: "live" }, { LLM_MODE: "live", LLM_PROVIDER: "anthropic" }]) {
      for (const role of ["builder", "fast"] as const) {
        const selection = selectChatModel(role, env, {
          script: {
            id: "one",
            agents: [{ agent: "crew", systemIncludes: "You are the crew.", turns: [{ content: "On it." }] }],
          },
        });
        expect(selection.mode).toBe("fake");
        expect(selection.model).toBeInstanceOf(ScriptedChatModel);
        expect((await selection.model.invoke(PROMPT)).content).toBe("On it.");
      }
    }
    expect(selectChatModel("fast", { HEIST_MODE: "live" }).reason).toBe(
      "Model: recorded turns (live mode, but ANTHROPIC_API_KEY not set)",
    );

    // The process-wide path, from process.env, with any key in the shell removed.
    vi.stubEnv("HEIST_MODE", "live");
    vi.stubEnv("LLM_MODE", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(getChatModel("builder")).toBeInstanceOf(ScriptedChatModel);
    const answer = await structuredCall(Answer, PROMPT, { fake: FAKE });
    expect(answer).toEqual({ value: FAKE, recorded: true, reason: "fake mode" });

    expect(fetchCalls).toBe(0);
  });

  it("the gate's fake mode wins over a key and a provider", () => {
    const selection = selectChatModel("fast", { ...LIVE, LLM_MODE: "fake", LLM_PROVIDER: "bedrock" });
    expect(selection.mode).toBe("fake");
    expect(selection.provider).toBe("scripted");
  });

  it("live with a key, picks ChatAnthropic on the spec's default model", () => {
    const { createClient } = stubClient("{}");
    const fast = selectChatModel("fast", LIVE, { createAnthropicClient: createClient });
    expect(fast).toMatchObject({ mode: "live", provider: "anthropic", reason: "Model: live (Anthropic)" });
    expect(fast.model).toBeInstanceOf(ChatAnthropic);
    expect((fast.model as ChatAnthropic).model).toBe("claude-sonnet-4-6");

    const builder = selectChatModel("builder", { ...LIVE, ANTHROPIC_MODEL_BUILDER: "claude-opus-5-5" });
    expect((builder.model as ChatAnthropic).model).toBe("claude-opus-5-5");
  });

  it("sends max_tokens 400 for the fast role", async () => {
    const fast = stubClient('{"say":"live"}');
    const model = selectChatModel("fast", LIVE, { createAnthropicClient: fast.createClient }).model;
    await model.invoke(PROMPT);
    expect(fast.calls[0].request.max_tokens).toBe(400);
    expect(fast.calls[0].request.model).toBe("claude-sonnet-4-6");

    const builder = stubClient("ok");
    await selectChatModel("builder", LIVE, { createAnthropicClient: builder.createClient }).model.invoke(PROMPT);
    expect(builder.calls[0].request.max_tokens).toBe(16_000);
  });

  it("keeps a Claude 5 model's thinking out of the fast role's 400 tokens, and leaves the builder alone (issue 162)", async () => {
    const sent = async (role: "fast" | "builder", model: string) => {
      const stub = stubClient('{"say":"live"}');
      const env = { ...LIVE, ANTHROPIC_MODEL_FAST: model, ANTHROPIC_MODEL_BUILDER: model };
      await selectChatModel(role, env, { createAnthropicClient: stub.createClient }).model.invoke(PROMPT);
      const { thinking, output_config } = stub.calls[0].request;
      return { thinking, effort: (output_config as { effort?: string } | undefined)?.effort };
    };
    for (const model of ["claude-haiku-5-5", "claude-sonnet-5", "claude-opus-5"]) {
      expect(await sent("fast", model), model).toEqual({ thinking: { type: "disabled" }, effort: undefined });
    }
    expect(await sent("fast", "claude-sonnet-5-5")).toEqual({ thinking: { type: "between_tools" }, effort: undefined });
    // Thinking can't be turned off on these, so they think as little as they can.
    for (const model of ["claude-opus-5-5", "claude-fable-5-2", "claude-mythos-5-2"]) {
      expect(await sent("fast", model), model).toEqual({ thinking: undefined, effort: "low" });
    }
    // The 4.x models don't think unless asked: the request is unchanged.
    expect(await sent("fast", "claude-sonnet-4-6")).toEqual({ thinking: undefined, effort: undefined });
    expect(await sent("builder", "claude-haiku-5-5")).toEqual({ thinking: undefined, effort: undefined });
  });

  it("refuses LLM_PROVIDER=bedrock without BEDROCK_ENABLED=1, with a clear configuration error", () => {
    const env = { ...LIVE, LLM_PROVIDER: "bedrock" };
    expect(() => selectChatModel("fast", env)).toThrow(LlmConfigurationError);
    expect(() => selectChatModel("fast", { ...env, BEDROCK_ENABLED: "true" })).toThrow(
      /Bedrock is disabled: set BEDROCK_ENABLED=1/,
    );

    const enabled = selectChatModel("fast", { ...env, BEDROCK_ENABLED: "1" });
    expect(enabled).toMatchObject({ mode: "live", provider: "bedrock" });
    expect(enabled.model).toBeInstanceOf(ChatBedrockConverse);
    expect((enabled.model as ChatBedrockConverse).maxTokens).toBe(400);
  });

  it("rejects an unknown provider and a bad timeout", () => {
    expect(() => selectChatModel("fast", { ...LIVE, LLM_PROVIDER: "openai" })).toThrow(LlmConfigurationError);
    expect(llmTimeoutMs({})).toBe(4_000);
    expect(llmTimeoutMs({ LLM_TIMEOUT_MS: "1500" })).toBe(1_500);
    expect(() => llmTimeoutMs({ LLM_TIMEOUT_MS: "soon" })).toThrow(LlmConfigurationError);
  });
});

describe("structuredCall", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns the live answer, not recorded, when the model answers in time", async () => {
    const stub = stubClient('{"say":"live"}');
    const selection = selectChatModel("fast", LIVE, { createAnthropicClient: stub.createClient });
    const answer = await structuredCall(Answer, PROMPT, { fake: FAKE, selection, timeoutMs: 1_000 });
    expect(answer).toEqual({ value: { say: "live" }, recorded: false });
    // Native structured output: the schema goes in output_config, not a forced tool.
    expect(stub.calls[0].request.output_config).toMatchObject({ format: { type: "json_schema" } });
    expect(stub.calls[0].request.tool_choice).toBeUndefined();
  });

  it("returns the fake tagged recorded when the live call exceeds LLM_TIMEOUT_MS", async () => {
    vi.stubEnv("LLM_TIMEOUT_MS", "50");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stub = stubClient('{"say":"too late"}', 2_000);
    const selection = selectChatModel("fast", LIVE, { createAnthropicClient: stub.createClient });

    const started = performance.now();
    const answer = await structuredCall(Answer, PROMPT, { fake: () => FAKE, selection });
    const elapsed = performance.now() - started;

    expect(answer).toEqual({ value: FAKE, recorded: true, reason: "timeout" });
    expect(elapsed).toBeLessThan(1_000);
    // The slow request is cancelled, not left running.
    expect(stub.calls[0].signal?.aborted).toBe(true);
    warn.mockRestore();
  });

  it("returns the fake tagged recorded when the live answer fails the schema", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stub = stubClient('{"shout":42}');
    const selection = selectChatModel("fast", LIVE, { createAnthropicClient: stub.createClient });
    const answer = await structuredCall(Answer, PROMPT, { fake: FAKE, selection });
    expect(answer).toEqual({ value: FAKE, recorded: true, reason: "error" });
    warn.mockRestore();
  });

  it("answers with the recording, reason configuration, when a setting refuses every live call", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const [name, value] of [
      ["LLM_PROVIDER", "openai"],
      ["LLM_PROVIDER", "bedrock"],
      ["LLM_TIMEOUT_MS", "4s"],
    ] as const) {
      vi.unstubAllEnvs();
      // The gate forces LLM_MODE=fake, so ask for live explicitly.
      for (const [k, v] of Object.entries({ ...LIVE, LLM_MODE: "live" })) vi.stubEnv(k, v);
      vi.stubEnv(name, value);
      const answer = await structuredCall(Answer, PROMPT, { fake: FAKE });
      expect(answer, `${name}=${value}`).toEqual({ value: FAKE, recorded: true, reason: "configuration" });
    }
    warn.mockRestore();
  });

  it("refuses a recorded answer that does not fit the schema", async () => {
    const selection = selectChatModel("fast", {});
    await expect(structuredCall(Answer, PROMPT, { fake: { say: 1 } as never, selection })).rejects.toThrow();
  });
});
