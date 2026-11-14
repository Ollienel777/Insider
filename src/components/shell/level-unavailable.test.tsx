// Plan, Run and Debrief on a cached level that fails its check (#98): each
// shows the error state, as the Dossier does, instead of throwing out of the
// page into Next's generic error page. And the segment's own error and
// loading states render inside the shell's frame.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FIXTURE_BUILDINGS } from "@/adapters/costar/fake";
import BuildingError from "@/app/b/[id]/error";
import BuildingLoading from "@/app/b/[id]/loading";
import DebriefPage from "@/app/b/[id]/debrief/page";
import PlanPage from "@/app/b/[id]/plan/page";
import RunPage from "@/app/b/[id]/run/page";

const building = FIXTURE_BUILDINGS.find((b) => b.id === "F1")!;

vi.mock("@/lib/building", () => ({ findBuilding: async (id: string) => (id === "F1" ? building : null) }));
vi.mock("@/agents/builder/cache", () => ({
  readCachedLevel: async () => {
    throw new Error("mission.objective: expected string, received undefined");
  },
}));

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");

describe("a bad level file (#98)", () => {
  for (const [step, Page] of [
    ["Plan", PlanPage],
    ["Run", RunPage],
    ["Debrief", DebriefPage],
  ] as const) {
    it(`gives ${step} its error state, with the fix and the way on`, async () => {
      const out = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: "F1" }) }));
      expect(out).toContain('data-testid="level-unavailable"');
      expect(text(out)).toContain(`${building.name}'s cached level failed its check`);
      expect(out).toContain(`${step} · F1`);
      expect(out).toContain("npm run build:levels -- F1");
      expect(out).toContain("mission.objective: expected string, received undefined");
      expect(out).toContain('href="/"');
    });
  }
});

describe("the building segment's own states", () => {
  it("error: says what happened, offers a retry and the way out", () => {
    const reset = vi.fn();
    const out = renderToStaticMarkup(<BuildingError error={Object.assign(new Error("boom"), { digest: "abc123" })} reset={reset} />);
    expect(out).toContain('data-testid="building-error"');
    expect(out).toContain("This screen failed to open");
    expect(out).toContain("Error abc123");
    expect(out).toContain(">Try again<");
    expect(out).toContain('href="/"');
    expect(out).not.toContain("boom");
  });

  it("loading: placeholders in the two-column frame", () => {
    const out = renderToStaticMarkup(<BuildingLoading />);
    expect(out).toContain('data-testid="building-loading"');
    expect(out).toContain("animate-pulse");
  });
});
