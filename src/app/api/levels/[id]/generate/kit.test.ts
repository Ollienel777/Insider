// The build route for a kit building (#93, the #97 review): it refuses while
// the model is on fixtures, answers 200 once built, says only what kind of
// failure a failed build was, and answers 429 when the build can't start now.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_BUILDINGS } from "@/adapters/costar/fake";
import { FORCE_COOKIE } from "@/lib/mode";
import type { Building } from "@/domain";

const f1 = FIXTURE_BUILDINGS.find((b) => b.id === "F1")!;
const kit: Building = { ...f1, id: "900001", name: "Testwood Tower", source: "costar" };

const buildLevel = vi.fn();
vi.mock("@/agents/builder/builder", async (original) => ({
  ...(await original<typeof import("@/agents/builder/builder")>()),
  buildLevel: (...args: unknown[]) => buildLevel(...args),
}));
vi.mock("@/adapters/costar", async (original) => ({
  ...(await original<typeof import("@/adapters/costar")>()),
  getCoStar: () => ({ adapter: { getBuilding: async (id: string) => (id === kit.id ? kit : null) } }),
}));

const { POST } = await import("./route");
const { clearKitLevels, buildState } = await import("@/agents/builder/live-levels");
const { readCachedLevel } = await import("@/agents/builder/cache");

const post = (cookie?: string) =>
  POST(
    new Request(`http://localhost/api/levels/${kit.id}/generate?m=romaine-1974`, {
      method: "POST",
      headers: cookie ? { cookie } : {},
    }),
    { params: Promise.resolve({ id: kit.id }) },
  );

// The model live as configured: a placeholder key, since the build itself is mocked and no call goes out.
beforeEach(() => {
  vi.stubEnv("LLM_MODE", "live");
  vi.stubEnv("LLM_PROVIDER", "anthropic");
  vi.stubEnv("ANTHROPIC_API_KEY", "test-placeholder");
});
afterEach(() => {
  clearKitLevels();
  buildLevel.mockReset();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/levels/[id]/generate?m= for a kit building (#93)", () => {
  it("refuses while the model is forced to fixtures in the demo settings, and runs no build (#97 M1)", async () => {
    const response = await post(`${FORCE_COOKIE}=llm`);
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toMatch(/forced to fixtures/);
    expect(buildLevel).not.toHaveBeenCalled();
  });

  it("refuses while the server's model is on fixtures", async () => {
    vi.stubEnv("LLM_MODE", "fake");
    expect((await post()).status).toBe(409);
    expect(buildLevel).not.toHaveBeenCalled();
  });

  it("answers 200 once the level is built, and keeps it in memory", async () => {
    const level = (await readCachedLevel("F1", "romaine-1974"))!;
    buildLevel.mockResolvedValue({ manifest: { ...level.manifest, buildingId: kit.id }, trace: level.trace, summary: "", turns: [] });
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ built: true });
    expect(buildState(kit.id, "romaine-1974")).toEqual({ status: "built" });
  });

  it("answers 502 with a fixed line, not the raw error, when the build fails (#97 M2)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    buildLevel.mockRejectedValue(new Error('manifest.guards[0].roomId: "suite 4125, tenant Acme"'));
    const response = await post();
    expect(response.status).toBe(502);
    const { error } = (await response.json()) as { error: string };
    expect(error).toBe("the Level Builder failed");
    expect(error).not.toContain("Acme");
  });

  it("answers 429 with Retry-After for a level whose build just failed (#97 M4)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    buildLevel.mockRejectedValue(new Error("boom"));
    expect((await post()).status).toBe(502);
    const again = await post();
    expect(again.status).toBe(429);
    expect(Number(again.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(buildLevel).toHaveBeenCalledTimes(1);
  });
});
