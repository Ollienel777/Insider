import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { modeChip, serviceModes } from "@/lib/mode";
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

  it("lists the five run steps, a divider, then Drill", () => {
    const items = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => text(m[1]));
    expect(items).toEqual(["Scout", "Dossier", "Plan", "Run", "Debrief", "", "Drill"]);
    expect(html).toMatch(/<li aria-hidden="true" class="[^"]*w-px[^"]*bg-border/);
  });

  it("marks the current route with aria-current and the accent underline", () => {
    const current = [...html.matchAll(/<a [^>]*aria-current="page"[^>]*>/g)];
    expect(current).toHaveLength(1);
    expect(current[0][0]).toContain('href="/b/F1/scout"');
    expect(current[0][0]).toContain("after:bg-accent");
    expect(current[0][0]).toContain("text-text-1");
  });

  it("shows a check on done steps", () => {
    const run = renderToStaticMarkup(<StepRailView buildingId="F1" current="run" />);
    expect(run.match(/data-state="done"/g)).toHaveLength(3);
    expect(run.match(/lucide-check/g)).toHaveLength(3);
  });
});

describe("TopBar", () => {
  const chip = modeChip(serviceModes({}));

  it("shows the wordmark, the building and city, and the mode chip", () => {
    const building = FIXTURE_BUILDINGS.find((b) => b.id === "F1")!;
    const html = renderToStaticMarkup(<TopBar chip={chip} building={building} />);
    expect(html).toContain("h-14");
    expect(text(html)).toContain("Heist Anywhere");
    const slot = html.match(/data-testid="building-slot"[^>]*>([\s\S]*?)<\/div>/)![1];
    expect(text(slot)).toBe("Halvorsen Tower · Los Angeles");
  });

  it("leaves the building slot empty on the map", () => {
    const html = renderToStaticMarkup(<TopBar chip={chip} />);
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
    expect(buttonVariants({ variant })).toContain("h-10");
  });

  it("uses the accent for primary only", () => {
    expect(buttonVariants({ variant: "primary" })).toContain("bg-accent");
    expect(buttonVariants({ variant: "secondary" })).not.toContain("accent");
    expect(buttonVariants({ variant: "ghost" })).not.toContain("accent");
  });

  it("defaults to type=button so it never submits a form by accident", () => {
    expect(renderToStaticMarkup(<Button>Retry</Button>)).toContain('type="button"');
  });
});
