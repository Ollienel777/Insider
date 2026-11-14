// The warm-up (#90): nothing in fake mode or without a key, one tiny request
// live, and a failure that is swallowed. Nothing here reaches the network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { warmLiveModel } from "./index";

const LIVE = { HEIST_MODE: "live", ANTHROPIC_API_KEY: "test-key" };

/** An Anthropic SDK client that counts calls and answers (or fails) as told. */
function stubClient(answer: "ok" | "throw" | "hang" = "ok") {
  let created = 0;
  const calls: Record<string, unknown>[] = [];
  const create = (request: Record<string, unknown>, options?: { signal?: AbortSignal }) => {
    calls.push(request);
    if (answer === "throw") return Promise.reject(new Error("overloaded (key test-key)"));
    if (answer === "hang") {
      return new Promise((_, reject) => options?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    }
    return Promise.resolve({
      id: "msg_stub",
      type: "message",
      role: "assistant",
      model: request.model,
      content: [{ type: "text", text: "OK" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 5, output_tokens: 1 },
    });
  };
  const client = { messages: { create }, beta: { messages: { create } } };
  return {
    createAnthropicClient: () => {
      created += 1;
      return client as never;
    },
    calls,
    created: () => created,
  };
}

describe("warmLiveModel", () => {
  let fetchCalls = 0;
  beforeEach(() => {
    fetchCalls = 0;
    vi.stubGlobal("fetch", () => {
      fetchCalls += 1;
      throw new Error("network access in a keyless test");
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends nothing in fake mode, even with a key", async () => {
    for (const env of [{}, { ...LIVE, LLM_MODE: "fake" }, { HEIST_MODE: "fake", ANTHROPIC_API_KEY: "test-key" }]) {
      const stub = stubClient();
      expect(await warmLiveModel({ env, createAnthropicClient: stub.createAnthropicClient })).toBe(false);
      expect(stub.calls).toHaveLength(0);
    }
    expect(fetchCalls).toBe(0);
  });

  it("sends nothing live without a key, or on Bedrock left off", async () => {
    for (const env of [{ HEIST_MODE: "live" }, { LLM_MODE: "live" }, { HEIST_MODE: "live", LLM_PROVIDER: "bedrock" }]) {
      const stub = stubClient();
      expect(await warmLiveModel({ env, createAnthropicClient: stub.createAnthropicClient })).toBe(false);
      expect(stub.calls).toHaveLength(0);
    }
    expect(fetchCalls).toBe(0);
  });

  it("live, sends exactly one small request on the fast model", async () => {
    const stub = stubClient();
    expect(await warmLiveModel({ env: LIVE, createAnthropicClient: stub.createAnthropicClient })).toBe(true);
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]).toMatchObject({ model: "claude-sonnet-4-6", max_tokens: 400 });
    expect(JSON.stringify(stub.calls[0].messages)).toContain("Reply with OK.");
  });

  it("a warm-up that fails or times out resolves false and says nothing of the key", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const failing = stubClient("throw");
      expect(await warmLiveModel({ env: LIVE, createAnthropicClient: failing.createAnthropicClient })).toBe(false);
      const hanging = stubClient("hang");
      expect(await warmLiveModel({ env: LIVE, timeoutMs: 20, createAnthropicClient: hanging.createAnthropicClient })).toBe(false);
      expect(failing.calls).toHaveLength(1);
      expect(hanging.calls).toHaveLength(1);
      expect(warn).not.toHaveBeenCalled();
      for (const [line] of info.mock.calls) expect(String(line)).not.toContain("test-key");
    } finally {
      info.mockRestore();
      warn.mockRestore();
    }
  });
});
