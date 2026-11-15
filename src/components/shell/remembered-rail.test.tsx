// The folder tabs remember how far you got (issue 166): a tab you have opened
// stays open, even from the mission picker; another mission or building starts
// them over; Owner Mode doesn't count.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { forgetTabs, recordTab } from "./remembered-rail";
import { StepRailView } from "./step-rail-view";

afterEach(() => forgetTabs());

const at = (current: string, missionId: string | null = "romaine-1974", buildingId: string | null = "F1") =>
  recordTab({ current, missionId, buildingId, factsOnly: false });

/** The tabs a rail draws as links, by label. */
const linked = (html: string) => [...html.matchAll(/<a [^>]*data-state="(\w+)"[^>]*>.*?<span class="min-w-0 truncate">([^<]+)<\/span>/g)].map((m) => `${m[2]}:${m[1]}`);

describe("the tabs on Run", () => {
  it("open the Debrief mid-run, the demo script's fallback, and nothing after it", () => {
    const html = renderToStaticMarkup(<StepRailView current="run" missionId="romaine-1974" buildingId="F1" />);
    expect(html).toContain('href="/b/F1/debrief?m=romaine-1974"');
    expect(linked(html)).toContain("Debrief:upcoming");
  });
});

describe("the remembered tabs", () => {
  it("keep every tab up to the furthest opened, from any tab, the mission picker included", () => {
    at("cast", "romaine-1974", null);
    at("scout");
    at("dossier");
    expect(at("plan")?.reached).toBe(4);
    // Back on the mission picker, which knows no mission or building: Cast to Plan stay open.
    const memory = at("missions", null, null)!;
    expect(memory).toMatchObject({ missionId: "romaine-1974", buildingId: "F1", reached: 4 });
    const html = renderToStaticMarkup(
      <StepRailView current="missions" missionId={memory.missionId} buildingId={memory.buildingId} reachedAtLeast={memory.reached} />,
    );
    expect(linked(html)).toEqual(["Missions:current", "Cast:upcoming", "Scout:upcoming", "Dossier:upcoming", "Plan:upcoming", "Owner Mode:upcoming"]);
    expect(html).toContain('href="/b/F1/plan?m=romaine-1974"');
    // Run, never opened, stays locked.
    expect(html).toMatch(/aria-disabled="true"[^>]*>.*?Run/);
  });

  it("start over for another mission or another building, and ignore Owner Mode", () => {
    at("plan");
    expect(at("owner")?.reached).toBe(4);
    expect(at("scout", "romaine-1974", "F2")).toMatchObject({ buildingId: "F2", reached: 2 });
    expect(at("cast", "sunset-1986", null)).toMatchObject({ missionId: "sunset-1986", buildingId: null, reached: 1 });
  });
});
