import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_BUILDINGS } from "@/adapters/costar/fake";
import { noCoverageFallback } from "@/adapters/vexcel";
import { FIXTURE_AERIALS } from "@/adapters/vexcel/fake";
import { orthoBounds, placeOnOrtho } from "@/adapters/vexcel/mapping";
import { buildImageViews, buildMassing, entryFace, FRAME, LABEL_GAP, layoutLabels, stepView, VIEW_ORDER } from "./massing";
import { MassingSvg } from "./massing-view";
import { fetchAerial, ScoutPanel, ScoutScreen, scoutViews } from "./scout-screen";
import { getStatus, resetStatus } from "@/lib/demo-status";
import { Aerial } from "@/domain";

const storiesOf = (id: string) => FIXTURE_BUILDINGS.find((b) => b.id === id)!.stories;
const all = [...FIXTURE_AERIALS].map(([id, aerial]) => ({ id, aerial, views: buildMassing(aerial, storiesOf(id)) }));

/** Distance from point p to segment a–b. */
function toSegment(p: [number, number], a: [number, number], b: [number, number]) {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

describe("stepView", () => {
  it("walks N, E, S, W, ortho and wraps both ways", () => {
    expect(VIEW_ORDER).toEqual(["N", "E", "S", "W", "ortho"]);
    expect(stepView("N", 1)).toBe("E");
    expect(stepView("W", 1)).toBe("ortho");
    expect(stepView("ortho", 1)).toBe("N");
    expect(stepView("N", -1)).toBe("ortho");
  });
});

describe("buildMassing", () => {
  it.each(all.map((b) => [b.id, b] as const))("%s has the five views, every entry on each, inside the frame", (_id, b) => {
    expect(b.views.map((v) => v.dir)).toEqual(VIEW_ORDER);
    for (const view of b.views) {
      expect(view.markers.map((m) => m.entry.id)).toEqual(b.aerial.entries.map((e) => e.id));
      for (const m of view.markers) {
        for (const value of [m.x, m.y, m.labelY]) {
          expect(value, `${view.dir} ${m.entry.id}`).toBeGreaterThan(0.02);
          expect(value, `${view.dir} ${m.entry.id}`).toBeLessThan(0.98);
        }
      }
    }
  });

  it.each(all.map((b) => [b.id, b] as const))("%s: an oblique shows two walls; the top-down view shows none", (_id, b) => {
    for (const view of b.views) {
      if (view.dir === "ortho") expect(view.walls).toHaveLength(0);
      else expect(view.walls.length, view.dir).toBeGreaterThanOrEqual(2);
    }
  });

  it("keeps the building one size across the obliques, so turning never zooms", () => {
    for (const b of all) {
      const scales = new Set(b.views.filter((v) => v.dir !== "ortho").map((v) => v.scale));
      expect(scales.size, b.id).toBe(1);
    }
  });

  it("draws a line at every storey CoStar gives, when they are far enough apart", () => {
    const f5 = all.find((b) => b.id === "F5")!;
    // Westchase Commons: 6 stories, so 5 lines on each of the visible walls.
    const n = f5.views.find((v) => v.dir === "N")!;
    expect(n.floors).toHaveLength(5 * n.walls.length);
  });

  it("puts the north-face dock in front on the north view and round the back on the south", () => {
    const f1 = all.find((b) => b.id === "F1")!;
    const marker = (dir: string) => f1.views.find((v) => v.dir === dir)!.markers.find((m) => m.entry.id === "dock-N")!;
    expect(marker("N").facing).toBe(true);
    expect(marker("S").facing).toBe(false);
    // The roof hatch is seen from every view.
    for (const v of f1.views) expect(v.markers.find((m) => m.entry.id === "roof")!.facing).toBe(true);
  });

  it("projects each entry on its own tagged view as facing the camera", () => {
    for (const b of all) {
      const views = new Map(b.views.map((v) => [v.dir, v]));
      for (const entry of b.aerial.entries) {
        const m = views.get(entry.view)!.markers.find((x) => x.entry.id === entry.id)!;
        expect(m.facing, `${b.id} ${entry.id} on ${entry.view}`).toBe(true);
      }
    }
  });

  it("keeps labels apart and no leader runs through another marker", () => {
    for (const b of all) {
      for (const view of b.views) {
        const ms = view.markers;
        for (const side of ["left", "right"]) {
          const ys = ms.filter((m) => m.side === side).map((m) => m.labelY * FRAME.height).sort((p, q) => p - q);
          for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1], `${b.id} ${view.dir}`).toBeGreaterThanOrEqual(LABEL_GAP - 0.01);
        }
        for (const m of ms) {
          const a: [number, number] = [m.x * FRAME.width, m.y * FRAME.height];
          const z: [number, number] = [m.labelX * FRAME.width, m.labelY * FRAME.height];
          for (const other of ms) {
            if (other === m) continue;
            const d = toSegment([other.x * FRAME.width, other.y * FRAME.height], a, z);
            expect(d, `${b.id} ${view.dir}: ${m.entry.id}'s leader crosses ${other.entry.id}`).toBeGreaterThan(24);
          }
        }
      }
    }
  });
});

describe("layoutLabels", () => {
  it("sends markers left and right of the middle to their own columns, outside the building", () => {
    const out = layoutLabels([{ x: 500, y: 400 }, { x: 900, y: 400 }], { x0: 450, x1: 950 });
    expect(out.map((o) => o.side)).toEqual(["left", "right"]);
    expect(out[0].labelX).toBeLessThan(450);
    expect(out[1].labelX).toBeGreaterThan(950);
  });

  it("puts a middle marker in the emptier column", () => {
    const out = layoutLabels([{ x: 500, y: 300 }, { x: 520, y: 600 }, { x: 700, y: 450 }], { x0: 450, x1: 950 });
    expect(out[2].side).toBe("right");
  });
});

describe("entryFace", () => {
  it("names the face from the tagged view, and the roof for a roof entry", () => {
    const f1 = FIXTURE_AERIALS.get("F1")!;
    const byId = (id: string) => f1.entries.find((e) => e.id === id)!;
    expect(entryFace(byId("dock-N"), f1.heightM)).toBe("North face");
    expect(entryFace(byId("exit-W"), f1.heightM)).toBe("West face");
    expect(entryFace(byId("roof"), f1.heightM)).toBe("Roof");
  });

  it("names the nearest face for an entry pinned on the ortho, as a live aerial pins them", () => {
    const f1 = FIXTURE_AERIALS.get("F1")!;
    for (const entry of f1.entries) {
      const pinned = { ...entry, view: "ortho" as const, x: 1, y: 1 };
      expect(entryFace(pinned, f1.heightM, f1.footprint), entry.id).toBe(entryFace(entry, f1.heightM));
    }
  });
});

describe("buildImageViews (live imagery)", () => {
  const f1 = FIXTURE_AERIALS.get("F1")!;
  const box = orthoBounds(f1.footprint);
  const live = {
    views: [
      { dir: "N" as const, url: "/api/buildings/F1/aerial/N", width: 960, height: 700 },
      { dir: "ortho" as const, url: "/api/buildings/F1/aerial/ortho", width: 2000, height: 1000 },
    ],
    entries: placeOnOrtho(f1.entries, box, { width: 2000, height: 1000 }, () => {}),
  };
  const views = buildImageViews(live);

  it("fits each image whole and centred in the frame", () => {
    const [n, ortho] = views;
    // 960×700 is narrower than 16:10: full height, bars either side.
    expect(n.box.height).toBeCloseTo(1);
    expect(n.box.width).toBeCloseTo((960 / 700) * (FRAME.height / FRAME.width));
    expect(n.box.x).toBeCloseTo((1 - n.box.width) / 2);
    // 2:1 is wider: full width, bars above and below.
    expect(ortho.box.width).toBeCloseTo(1);
    expect(ortho.box.y).toBeCloseTo((1 - ortho.box.height) / 2);
  });

  it("draws each entry only on the view it is pinned to, inside the frame, every one facing", () => {
    const [n, ortho] = views;
    expect(n.markers).toEqual([]);
    expect(ortho.markers.map((m) => m.entry.id)).toEqual(f1.entries.map((e) => e.id));
    for (const m of ortho.markers) {
      expect(m.facing).toBe(true);
      for (const v of [m.x, m.y, m.labelX, m.labelY]) {
        expect(v, m.entry.id).toBeGreaterThan(0);
        expect(v, m.entry.id).toBeLessThan(1);
      }
    }
    const dock = live.entries.find((e) => e.id === "dock-N")!;
    const marker = ortho.markers.find((m) => m.entry.id === "dock-N")!;
    expect(marker.x).toBeCloseTo((dock.x! * 0.8) / FRAME.width);
  });

  it("skips a view without an image", () => {
    expect(buildImageViews({ views: [{ dir: "N", width: 10, height: 10 }], entries: [] })).toEqual([]);
  });
});

describe("the render", () => {
  it("draws walls and a roof from tokens only", () => {
    const view = all[0].views[0];
    const html = renderToStaticMarkup(<MassingSvg view={view} />);
    expect(html.match(/data-testid="massing-wall"/g)).toHaveLength(view.walls.length);
    expect(html).toContain('data-testid="massing-roof"');
    expect(html).not.toMatch(/#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/i);
    expect(html).toContain("var(--n-");
  });

  it("opens on a skeleton in the aerial's frame, with the CoStar facts and 'Plan the job' already there", () => {
    const f1 = FIXTURE_BUILDINGS.find((b) => b.id === "F1")!;
    const html = renderToStaticMarkup(<ScoutScreen building={f1} />);
    expect(html).toContain('data-testid="aerial-frame"');
    expect(html).toContain('data-testid="aerial-skeleton"');
    expect(html).not.toContain('data-testid="aerial-canvas"');
    expect(html.match(/data-testid="entry-row-skeleton"/g)).toHaveLength(5);
    expect(html).toContain("Halvorsen Tower");
    expect(html).toContain("1974");
    expect(html).toMatch(/<a[^>]*href="\/b\/F1\/dossier"[^>]*>Plan the job<\/a>/);
  });

  it("after a failed aerial load, the panel says so with Retry and keeps no skeleton", () => {
    const f1 = FIXTURE_BUILDINGS.find((b) => b.id === "F1")!;
    const panel = (load: Parameters<typeof ScoutPanel>[0]["load"]) =>
      renderToStaticMarkup(
        <ScoutPanel building={f1} load={load} selected={null} onPick={() => {}} onRetry={() => {}} />,
      );
    // While it loads, the height and the entries shimmer.
    expect(panel({ status: "loading" })).toContain('data-testid="height-skeleton"');

    const html = panel({ status: "error", message: "upstream timed out" });
    expect(html).not.toContain("animate-pulse");
    expect(html).not.toContain("skeleton");
    expect(html).toContain('data-testid="height-unavailable"');
    expect(html).toContain("Not loaded");
    expect(html).not.toContain("Tagging");
    expect(html).toMatch(/data-testid="entries-error"[\s\S]*<button[^>]*>Retry<\/button>/);
  });
});

describe("the Scout on a live aerial", () => {
  const f1 = FIXTURE_BUILDINGS.find((b) => b.id === "F1")!;
  const massing = FIXTURE_AERIALS.get("F1")!;
  // Vexcel had no west oblique here: four views, the entries pinned on the ortho.
  const ortho = { width: 1600, height: 1000 };
  const live = Aerial.parse({
    views: [
      ...(["N", "E", "S"] as const).map((dir) => ({ dir, url: `/api/buildings/F1/aerial/${dir}`, width: 960, height: 700 })),
      { dir: "ortho", url: "/api/buildings/F1/aerial/ortho", ...ortho },
    ],
    entries: placeOnOrtho(massing.entries, orthoBounds(massing.footprint), ortho, () => {}),
    footprint: massing.footprint,
    heightM: massing.heightM,
    source: "vexcel",
  });
  const render = (failed?: ("N" | "E" | "S" | "W" | "ortho")[]) =>
    renderToStaticMarkup(<ScoutScreen building={f1} initialLoad={{ status: "ready", aerial: live, live: true, failed }} />);
  const chip = (html: string, dir: string) => new RegExp(`<button[^>]*data-dir="${dir}"[^>]*>`).exec(html)![0];

  it("opens on the ortho, with a photo per view Vexcel has, each described, and the missing direction's chip disabled", () => {
    const html = render();
    expect(html).toContain('data-view="ortho"');
    expect(html.match(/data-testid="aerial-photo"/g)).toHaveLength(4);
    for (const face of ["north face", "east face", "south face", "straight down"]) expect(html).toContain(`alt="Vexcel aerial, ${face}"`);
    expect(html).not.toContain("west face");
    expect(html).not.toContain('data-testid="massing-wall"');
    expect(chip(html, "W")).toContain(' disabled=""');
    for (const dir of ["N", "E", "S", "ortho"]) expect(chip(html, dir), dir).not.toContain(' disabled=""');
    // Every entry is drawn once, on the ortho.
    expect(html.match(/data-testid="entry-marker"/g)).toHaveLength(massing.entries.length);
    expect(html).toContain("Vexcel · aerial");
  });

  it("draws the massing instead once every photo has failed to load", () => {
    expect(scoutViews(live, f1.stories, ["N", "E", "S"]).every((v) => v.kind === "image")).toBe(true);
    expect(scoutViews(live, f1.stories, ["N", "E", "S", "ortho"]).every((v) => v.kind === "massing")).toBe(true);

    const html = render(["N", "E", "S", "ortho"]);
    expect(html).not.toContain('data-testid="aerial-photo"');
    expect(html).not.toContain("didn&#x27;t load");
    expect(html).toContain('data-testid="massing-wall"');
    // The massing has all five views again, and opens on its north face.
    expect(html.match(/data-testid="aerial-view"/g)).toHaveLength(5);
    expect(html).toContain('data-view="N"');
    expect(html).toContain("Vexcel · massing");
  });

  /** The Scout panel for a building of `source`, with `aerial` loaded live. */
  const panelWith = (source: "costar" | "fixture", aerial: typeof live) =>
    renderToStaticMarkup(
      <ScoutPanel
        building={{ ...f1, id: "900001", source }}
        load={{ status: "ready", aerial, live: true }}
        selected={null}
        onPick={() => {}}
        onRetry={() => {}}
      />,
    );
  const derived = { ...live, entries: [], derived: true as const };

  it("says a derived massing tags no entries, and a hand-made one's untagged aerial keeps its own line", () => {
    const kit = panelWith("costar", derived);
    expect(kit).toContain('data-testid="entries-untagged"');
    expect(kit).toContain("No entries are tagged for this building");
    expect(kit).toContain("A level built for it offers the");
    expect(kit).toContain("0 tagged");
    const untagged = { ...live, entries: [] };
    for (const source of ["fixture", "costar"] as const) {
      expect(panelWith(source, untagged), source).not.toContain('data-testid="entries-untagged"');
      expect(panelWith(source, untagged), source).toContain("The aerial tags no entries on this building.");
    }
  });

  it("shows a derived massing's height as a CoStar estimate, and a measured one as Vexcel's", () => {
    const height = (html: string) => {
      const [, layer, value] = /data-layer="(\w+)"[^>]*><\/span>Height<\/dt><dd[^>]*>([^<]*)<\/dd>/.exec(html)!;
      return { layer, value };
    };
    expect(height(panelWith("costar", derived))).toEqual({ layer: "costar", value: `~${Math.round(live.heightM)} m` });
    expect(height(panelWith("fixture", live))).toEqual({ layer: "vexcel", value: `${Math.round(live.heightM)} m` });
  });
});

describe("fetchAerial and the mode chip", () => {
  const answer = (body: unknown) => vi.fn(async () => Response.json(body));
  const f1 = structuredClone(FIXTURE_AERIALS.get("F1")!);
  const photos = { ...f1, entries: [], views: [{ dir: "ortho", url: "/api/buildings/F1/aerial/ortho", width: 1600, height: 1000 }], source: "vexcel" };

  afterEach(() => {
    vi.unstubAllGlobals();
    resetStatus();
  });

  it("switches Vexcel to fixtures for a massing served live, and back to live when photos come", async () => {
    vi.stubGlobal("fetch", answer({ mode: "live", aerial: f1, fallback: noCoverageFallback("F1") }));
    const massing = await fetchAerial("F1", new AbortController().signal);
    expect(massing).toMatchObject({ status: "ready", live: false });
    expect(getStatus().fellBack.has("vexcel")).toBe(true);

    vi.stubGlobal("fetch", answer({ mode: "live", aerial: photos }));
    expect(await fetchAerial("F2", new AbortController().signal)).toMatchObject({ status: "ready", live: true });
    expect(getStatus().fellBack.has("vexcel")).toBe(false);
  });
});
