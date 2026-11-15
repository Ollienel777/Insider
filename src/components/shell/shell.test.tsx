import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { configuredModes, modeChip, serviceModes } from "@/lib/mode";
import { FIXTURE_BUILDINGS } from "@/adapters/costar/fake";
import { LayerDot } from "./layer-dot";
import { ModeChip, modeTooltip } from "./mode-chip";
import { StepRailView } from "./step-rail-view";
import { nextStep, stepStates } from "./steps";
import { TopBar } from "./top-bar";
import { Button, buttonVariants } from "@/components/ui/button";

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");

describe("stepStates", () => {
  it("marks earlier steps done, the route's step current and later ones upcoming", () => {
    expect(stepStates("plan")).toEqual({
      scout: "done",
      dossier: "done",
      plan: "current",
      run: "upcoming",
      debrief: "upcoming",
      drill: "upcoming",
    });
  });

  it("marks nothing current for an unknown segment", () => {
    expect(Object.values(stepStates(null))).toEqual(Array(6).fill("upcoming"));
  });

  it("gives Drill no next step", () => {
    expect(nextStep("scout")?.segment).toBe("dossier");
    expect(nextStep("drill")).toBeUndefined();
  });
});

describe("StepRailView", () => {
  const html = renderToStaticMarkup(<StepRailView buildingId="F1" current="scout" />);

  it("lists the whole game in order as numbered folder tabs, then Owner Mode, on one row", () => {
    const items = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => text(m[1]).replace(/\s*\(.*\)$/, ""));
    expect(items).toEqual(["1Missions", "2Cast", "3Scout", "4Dossier", "5Plan", "6Run", "7Debrief", "8Owner Mode"]);
    expect(html).not.toContain("Drill");
    expect(html).toContain("flex-nowrap");
  });

  it("shows every tab on the mission picker, with only Missions and Owner Mode open", () => {
    const picker = renderToStaticMarkup(<StepRailView current="missions" />);
    expect([...picker.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1])).toEqual(["/", "/b/F1/owner"]);
    expect(picker).toMatch(/aria-disabled="true" title="Pick a mission first" data-state="upcoming"/);
    expect(picker.match(/aria-disabled="true"/g)).toHaveLength(6);
  });

  it("opens Cast on the cast screen, with the mission in its link", () => {
    const cast = renderToStaticMarkup(<StepRailView current="cast" missionId="romaine-1974" />);
    expect([...cast.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1])).toEqual(["/", "/m/romaine-1974/cast", "/b/F1/owner"]);
    expect(cast).toMatch(/aria-disabled="true" title="Finish Cast first" data-state="upcoming"/);
  });

  it("marks the current step with aria-current and the front tab", () => {
    const current = [...html.matchAll(/<a [^>]*aria-current="page"[^>]*>/g)];
    expect(current).toHaveLength(1);
    expect(current[0][0]).toContain('href="/b/F1/scout"');
    expect(current[0][0]).toContain("bg-manila ");
  });

  it("locks the steps not reached yet, says why, and keeps Owner Mode open", () => {
    const links = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);
    expect(links).toEqual(["/", "/b/F1/scout", "/b/F1/owner"]);
    expect(html).toMatch(/aria-disabled="true" title="Finish Scout first" data-state="upcoming"/);
    expect(html).toMatch(/aria-disabled="true" title="Finish Run first" data-state="upcoming"/);
  });

  it("opens every step on Owner Mode", () => {
    const owner = renderToStaticMarkup(<StepRailView buildingId="F1" current="owner" missionId="romaine-1974" />);
    expect(owner).not.toContain('aria-disabled="true"');
    expect([...owner.matchAll(/<a [^>]*aria-current="page"[^>]*href="([^"]+)"/g)].map((m) => m[1])).toEqual(["/b/F1/owner?m=romaine-1974"]);
  });

  it("shows a check on done steps", () => {
    const run = renderToStaticMarkup(<StepRailView buildingId="F1" current="run" />);
    // Missions, Scout, Dossier and Plan (Cast needs the mission in the address to link).
    expect(run.match(/data-state="done"/g)).toHaveLength(4);
    expect(run.match(/lucide-check/g)).toHaveLength(4);
  });
});

describe("TopBar", () => {
  const status = { configured: configuredModes({}), forced: [], fallbacks: [] };

  it("shows the wordmark, the building and city, and the mode chip", () => {
    const building = FIXTURE_BUILDINGS.find((b) => b.id === "F1")!;
    const html = renderToStaticMarkup(<TopBar status={status} building={building} />);
    expect(html).toContain("h-14");
    expect(text(html)).toContain("Hobbs");
    const slot = html.match(/data-testid="building-slot"[^>]*>([\s\S]*?)<\/div>/)![1];
    expect(text(slot)).toBe("Halvorsen Tower · Los Angeles");
  });

  it("leaves the building slot empty on the map", () => {
    const html = renderToStaticMarkup(<TopBar status={status} />);
    expect(html).toMatch(/data-testid="building-slot"[^>]*><\/div>/);
  });
});

describe("ModeChip", () => {
  it("reads FIXTURES in fake mode and lists every service on fixtures", () => {
    const chip = modeChip(serviceModes({}));
    const html = renderToStaticMarkup(<ModeChip chip={chip} />);
    const button = html.match(/<button[\s\S]*?<\/button>/)![0];
    expect(text(button)).toBe("FIXTURES");
    expect(button).not.toContain("bg-success");
    expect(html).toContain('role="tooltip"');
    expect(text(html)).toContain("On fixtures: Model, CoStar, Vexcel, Matterport");
  });

  it("reads LIVE with a success dot, and lists the services still on fixtures", () => {
    const chip = modeChip(serviceModes({ HEIST_MODE: "live", VEXCEL_MODE: "fake" }));
    const html = renderToStaticMarkup(<ModeChip chip={chip} />);
    expect(text(html.match(/<button[\s\S]*?<\/button>/)![0])).toBe("LIVE");
    expect(html).toContain("bg-success");
    expect(modeTooltip(chip)).toBe("On fixtures: Vexcel");
    expect(modeTooltip(modeChip(serviceModes({ HEIST_MODE: "live" })))).toBe("All services live");
  });
});

describe("LayerDot", () => {
  it("is an 8px dot in its layer's colour, named for assistive tech", () => {
    const html = renderToStaticMarkup(<LayerDot layer="vexcel" />);
    expect(html).toContain("size-2");
    expect(html).toContain("bg-layer-vexcel");
    expect(html).toContain('aria-label="Vexcel"');
  });

  it("is an outline when the layer has no data, and hidden when decorative", () => {
    expect(renderToStaticMarkup(<LayerDot layer="costar" absent />)).toContain('aria-label="CoStar: no data"');
    expect(renderToStaticMarkup(<LayerDot layer="costar" decorative />)).toContain('aria-hidden="true"');
  });
});

describe("Button", () => {
  it.each(["primary", "secondary", "ghost"] as const)("%s is at least 40px tall", (variant) => {
    expect(buttonVariants({ variant })).toMatch(/(^| )h-(10|11|12|14)( |$)/);
  });

  it("draws primary only as the stamp: a walnut block with a red handle", () => {
    expect(buttonVariants({ variant: "primary" })).toContain("bg-walnut");
    expect(buttonVariants({ variant: "primary" })).toContain("var(--stamp-handle)");
    for (const variant of ["secondary", "ghost"] as const) {
      expect(buttonVariants({ variant })).not.toContain("walnut");
      expect(buttonVariants({ variant })).not.toContain("stamp-handle");
    }
  });

  it("defaults to type=button so it never submits a form by accident", () => {
    expect(renderToStaticMarkup(<Button>Retry</Button>)).toContain('type="button"');
  });
});
