// The build route's one exception to #97's "model on fixtures" refusal (#95,
// the #111 review): the smoke's fictional test building builds from its
// recording only when the flag is on, the building is that one, and the
// builder will pick the scripted model. Anything else is refused, and the
// demo settings' forced fixtures refuse first, for every building.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SMOKE_KIT_BUILDING } from "@/adapters/costar/test-kit";
import { configuredModes, FORCE_COOKIE, serviceModes } from "@/lib/mode";

// Another kit building, beside the test one: the test building's record under a different id.
const OTHER_KIT_BUILDING = "900102";

// The real builder, watched, so a test can say it never ran.
const buildLevel = vi.fn();
vi.mock("@/agents/builder/builder", async (original) => {
  const real = await original<typeof import("@/agents/builder/builder")>();
  buildLevel.mockImplementation(real.buildLevel);
  return { ...real, buildLevel: (...args: Parameters<typeof real.buildLevel>) => buildLevel(...args) };
});
// No test here may reach the live model: if a refusal is ever lost, the build fails here, with no request sent.
vi.mock("@/adapters/llm/anthropic", async (original) => {
  const real = await original<typeof import("@/adapters/llm/anthropic")>();
  return {
    ...real,
    createAnthropicModel: () => {
      throw new Error("a test reached the live model");
    },
  };
});
vi.mock("@/adapters/costar", async (original) => {
  const real = await original<typeof import("@/adapters/costar")>();
  return {
    ...real,
    getCoStar: (options?: { forced?: boolean }) => {
      const selection = real.getCoStar(options);
      const getBuilding = async (id: string) => {
        if (id !== OTHER_KIT_BUILDING) return selection.adapter.getBuilding(id);
        const building = await selection.adapter.getBuilding(SMOKE_KIT_BUILDING);
        return building && { ...building, id: OTHER_KIT_BUILDING };
      };
      return { ...selection, adapter: { ...selection.adapter, getBuilding } };
    },
  };
});

const { POST } = await import("./route");
const { getCoStar, resetCoStar } = await import("@/adapters/costar");
const { clearKitLevels, buildState } = await import("@/agents/builder/live-levels");

const MISSION = "romaine-1974";
const post = (id: string, cookie?: string) =>
  POST(
    new Request(`http://localhost/api/levels/${id}/generate?m=${MISSION}`, { method: "POST", headers: cookie ? { cookie } : {} }),
    { params: Promise.resolve({ id }) },
  );

// The smoke server's environment: everything on fixtures, and the flag on.
beforeEach(() => {
  vi.stubEnv("HEIST_MODE", "fake");
  vi.stubEnv("LLM_MODE", "fake");
  vi.stubEnv("COSTAR_MODE", "fake");
  vi.stubEnv("VEXCEL_MODE", "fake");
  vi.stubEnv("HEIST_TEST_KIT", "1");
  vi.spyOn(console, "info").mockImplementation(() => {});
  resetCoStar();
});
afterEach(() => {
  clearKitLevels();
  buildLevel.mockClear();
  resetCoStar();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/levels/[id]/generate?m= for the fictional test kit (#95)", () => {
  it("builds the test building from its recording with the flag on and the model scripted", async () => {
    const response = await post(SMOKE_KIT_BUILDING);
    expect(response.status).toBe(200);
    expect(buildLevel).toHaveBeenCalledTimes(1);
    expect(buildState(SMOKE_KIT_BUILDING, MISSION)).toEqual({ status: "built" });
  });

  it("refuses the test building without the flag", async () => {
    // CoStar reads the flag once, so it still serves the building: the route's own check is what refuses.
    getCoStar();
    vi.stubEnv("HEIST_TEST_KIT", "");
    expect((await post(SMOKE_KIT_BUILDING)).status).toBe(409);
    expect(buildLevel).not.toHaveBeenCalled();
  });

  it("refuses any other kit building, flag or not", async () => {
    expect((await post(OTHER_KIT_BUILDING)).status).toBe(409);
    expect(buildLevel).not.toHaveBeenCalled();
  });

  it("refuses when the builder would pick a live model though the mode reads fixtures (an invalid LLM_TIMEOUT_MS)", async () => {
    vi.stubEnv("LLM_MODE", "live");
    vi.stubEnv("LLM_PROVIDER", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-placeholder");
    vi.stubEnv("LLM_TIMEOUT_MS", "soon");
    expect(configuredModes(process.env).llm).toBe("fake");
    expect(serviceModes(process.env).llm).toBe("live");
    expect((await post(SMOKE_KIT_BUILDING)).status).toBe(409);
    expect(buildLevel).not.toHaveBeenCalled();
  });

  it("refuses the test building too while the model is forced to fixtures in the demo settings", async () => {
    const response = await post(SMOKE_KIT_BUILDING, `${FORCE_COOKIE}=llm`);
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toMatch(/forced to fixtures/);
    expect(buildLevel).not.toHaveBeenCalled();
  });
});
