// POST /api/warm (#90): in fake mode, live without a key, or with the model
// forced to fixtures, it sends nothing and answers `{warmed: false}`, never a
// fallback.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FORCE_COOKIE } from "@/lib/mode";
import { POST } from "./route";

const post = (cookie?: string) =>
  POST(new Request("http://localhost/api/warm", { method: "POST", headers: cookie ? { cookie } : {} }));

describe("POST /api/warm", () => {
  let fetchCalls = 0;
  beforeEach(() => {
    fetchCalls = 0;
    vi.stubGlobal("fetch", () => {
      fetchCalls += 1;
      throw new Error("network access in a keyless test");
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends nothing in fake mode, live without a key, or with the model forced to fixtures", async () => {
    const cases: [Record<string, string>, string | undefined][] = [
      [{ HEIST_MODE: "fake", LLM_MODE: "fake", ANTHROPIC_API_KEY: "test-key" }, undefined],
      [{ HEIST_MODE: "live", LLM_MODE: "", ANTHROPIC_API_KEY: "" }, undefined],
      [{ HEIST_MODE: "live", LLM_MODE: "", ANTHROPIC_API_KEY: "test-key" }, `${FORCE_COOKIE}=llm`],
    ];
    for (const [env, cookie] of cases) {
      for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
      const response = await post(cookie);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ warmed: false });
      vi.unstubAllEnvs();
    }
    expect(fetchCalls).toBe(0);
  });
});
