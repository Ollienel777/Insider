import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_BUILDINGS } from "@/adapters/costar/fake";
import type { Building } from "@/domain";

const state = vi.hoisted(() => ({ building: null as Building | null, cached: null as unknown, forced: new Set<string>() }));
vi.mock("@/lib/forced-server", () => ({ forcedServices: async () => state.forced }));
vi.mock("@/lib/building", () => ({ findBuilding: async () => state.building }));
vi.mock("@/agents/builder/cache", () => ({
  readCachedLevel: async () => {
    if (state.cached instanceof Error) throw state.cached;
    return state.cached;
  },
}));

const { default: DossierPage } = await import("./page");

const f1 = FIXTURE_BUILDINGS.find((b) => b.id === "F1")!;
// A fictional kit building: F1's fields under a kit-style id.
const kitBuilding: Building = { ...f1, id: "900001", name: "Testwood Tower", source: "costar" };

// Levels are mission-keyed: the page reads `?m=`. `render` names one;
// `renderFromMap` opens the building as the map links it, with no `m`.
const M = "romaine-1974";
const render = async (id: string) =>
  renderToStaticMarkup(await DossierPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ m: M }) }));
const renderFromMap = async (id: string) =>
  renderToStaticMarkup(await DossierPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));

describe("the Dossier without a cached level", () => {
  beforeEach(() => {
    state.cached = null;
  });

  it("shows a kit building's CoStar facts", async () => {
    state.building = kitBuilding;
    const html = await render("900001");
    expect(html).toContain('data-testid="costar-facts"');
    expect(html).toContain(String(kitBuilding.yearBuilt));
  });

  it("never offers a kit building the build command, which writes into the tracked data/levels/", async () => {
    state.building = kitBuilding;
    expect(await render("900001")).not.toContain("build:levels");
    state.cached = new Error("bad manifest");
    expect(await render("900001")).not.toContain("build:levels");
  });

  it("offers no build of a kit building's level while the model is forced to fixtures (#97 M1)", async () => {
    vi.stubEnv("LLM_MODE", "live");
    vi.stubEnv("LLM_PROVIDER", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-placeholder");
    state.building = kitBuilding;
    state.cached = null;
    try {
      expect(await render(kitBuilding.id)).toContain('data-testid="build-level"');
      state.forced = new Set(["llm"]);
      const html = await render(kitBuilding.id);
      expect(html).not.toContain('data-testid="build-level"');
      expect(html).toContain("forced to fixtures in the demo settings");
    } finally {
      state.forced = new Set();
      vi.unstubAllEnvs();
    }
  });

  it("opens a kit building from the map (no m) on its facts, with no level and no command", async () => {
    state.building = kitBuilding;
    state.cached = { manifest: {}, trace: [] }; // must not be read: no mission, no level
    const html = await renderFromMap("900001");
    expect(html).toContain('data-testid="costar-facts"');
    expect(html).toContain("has no level built yet");
    expect(html).not.toContain("build:levels");
  });

  it("still redirects a fixture building with no m to its own mission", async () => {
    state.building = f1;
    const digest = await renderFromMap("F1").then(
      () => "rendered",
      (error: { digest?: string }) => String(error.digest),
    );
    expect(digest).toMatch(/\/b\/F1\/dossier\?m=romaine-1974;/);
  });

  it("still offers a fixture building the build command", async () => {
    state.building = f1;
    expect(await render("F1")).toContain(`npm run build:levels -- F1:${M}`);
  });
});
