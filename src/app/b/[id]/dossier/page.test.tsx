import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_BUILDINGS } from "@/adapters/costar/fake";
import type { Building } from "@/domain";

const state = vi.hoisted(() => ({ building: null as Building | null, cached: null as unknown }));
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

// Levels are mission-keyed: the page reads `?m=`. A kit building has no own
// mission, so every render names one.
const M = "romaine-1974";
const render = async (id: string) =>
  renderToStaticMarkup(await DossierPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ m: M }) }));

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

  it("still offers a fixture building the build command", async () => {
    state.building = f1;
    expect(await render("F1")).toContain(`npm run build:levels -- F1:${M}`);
  });
});
