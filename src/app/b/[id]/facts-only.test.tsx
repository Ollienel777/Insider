// A kit building (`source: "costar"`) has facts and no level (live check on
// PR #59): its Scout, its Dossier and the step rail above them must link only
// to steps that exist for it. Every `/b/<kit id>/…` link on those screens is
// followed to its page here, which must render, not 404.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FIXTURE_BUILDINGS } from "@/adapters/costar/fake";
import type { Building } from "@/domain";

const f1 = FIXTURE_BUILDINGS.find((b) => b.id === "F1")!;
// A fictional kit building: F1's fields under a kit-style id.
const kit: Building = { ...f1, id: "900001", name: "Testwood Tower", source: "costar" };

// The shell's client parts, outside a mounted app router.
const route = vi.hoisted(() => ({ segment: null as string | null }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {} }),
  useSelectedLayoutSegment: () => route.segment,
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
vi.mock("@/lib/forced-server", () => ({ forcedServices: async () => new Set() }));
vi.mock("@/lib/building", () => ({
  findBuilding: async (id: string) => (id === kit.id ? kit : id === f1.id ? f1 : null),
}));
vi.mock("@/agents/builder/cache", () => ({ readCachedLevel: async () => null }));

const { AppShell } = await import("@/components/shell/app-shell");
const { ScoutScreen } = await import("@/components/scout/scout-screen");
const { default: ScoutPage } = await import("./scout/page");
const { default: DossierPage } = await import("./dossier/page");
const { default: PlanPage } = await import("./plan/page");
const { default: RunPage } = await import("./run/page");
const { default: DebriefPage } = await import("./debrief/page");
const { default: DrillPage } = await import("./drill/page");

type Page = (props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => Promise<unknown>;
const PAGES: Record<string, Page> = {
  scout: ScoutPage as Page,
  dossier: DossierPage as Page,
  plan: PlanPage as Page,
  run: RunPage as Page,
  debrief: DebriefPage as Page,
  drill: DrillPage as Page,
};

/** Every `/b/<id>/<step>?…` link in the markup, as [step, query]. */
function buildingLinks(html: string, id: string): Array<[string, URLSearchParams]> {
  const links: Array<[string, URLSearchParams]> = [];
  for (const [, raw] of html.matchAll(/href="([^"]+)"/g)) {
    const url = new URL(raw.replace(/&amp;/g, "&"), "http://x");
    const match = url.pathname.match(/^\/b\/([^/]+)\/([^/]+)$/);
    if (match && decodeURIComponent(match[1]) === id) links.push([match[2], url.searchParams]);
  }
  return links;
}

/** Renders the page a link points to; "404" when it calls notFound. */
async function follow(id: string, step: string, query: URLSearchParams): Promise<string> {
  const page = PAGES[step];
  if (!page) return "404";
  try {
    const out = await page({ params: Promise.resolve({ id }), searchParams: Promise.resolve(Object.fromEntries(query)) });
    renderToStaticMarkup(out as React.ReactElement);
    return "ok";
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    if (digest.includes("404")) return "404";
    throw error;
  }
}

/** A kit building's screens as the map opens them (no `m`), inside the shell with its step rail. */
async function kitScreens(): Promise<Record<string, string>> {
  route.segment = "scout";
  const scout = renderToStaticMarkup(await AppShell({ building: kit, children: <ScoutScreen building={kit} /> }));
  route.segment = "dossier";
  const dossier = renderToStaticMarkup(
    await AppShell({
      building: kit,
      children: (await DossierPage({ params: Promise.resolve({ id: kit.id }), searchParams: Promise.resolve({}) })) as React.ReactElement,
    }),
  );
  return { scout, dossier };
}

describe("a kit building's screens offer only steps that exist", () => {
  it("links nothing on Scout or the Dossier to a page that 404s", async () => {
    const screens = await kitScreens();
    for (const [screen, html] of Object.entries(screens)) {
      const links = buildingLinks(html, kit.id);
      expect(links.length, `${screen} links to some step`).toBeGreaterThan(0);
      for (const [step, query] of links) {
        expect(await follow(kit.id, step, query), `${screen} → ${step}`).toBe("ok");
      }
    }
  });

  it("shows the steps it lacks as off, and says why", async () => {
    const { scout, dossier } = await kitScreens();
    for (const html of [scout, dossier]) {
      for (const label of ["Plan", "Run", "Debrief", "Drill"]) {
        expect(html).toMatch(new RegExp(`aria-disabled="true"[^>]*>${label}<`));
      }
      expect(html).toContain("Facts only: no level is built for this building.");
    }
    expect(scout).not.toContain("Plan the job");
  });

  it("is right that those steps 404 for a kit building", async () => {
    for (const step of ["plan", "run", "debrief", "drill"]) {
      expect(await follow(kit.id, step, new URLSearchParams()), step).toBe("404");
    }
  });

  it("still links a fixture building's every step, and its Plan the job", async () => {
    route.segment = "scout";
    const html = renderToStaticMarkup(await AppShell({ building: f1, children: <ScoutScreen building={f1} /> }));
    expect(buildingLinks(html, f1.id).map(([step]) => step)).toEqual(
      expect.arrayContaining(["scout", "dossier", "plan", "run", "debrief", "drill"]),
    );
    expect(html).toContain("Plan the job");
    expect(html).not.toContain("Facts only");
  });
});
