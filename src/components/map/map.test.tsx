import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FIXTURE_BUILDINGS } from "@/adapters/costar/fake";
import { FIXTURE_FLOORS, createFakeMatterport } from "@/adapters/matterport/fake";
import { buildingsWithLevel } from "@/lib/levels";
import { ATTRIBUTION, BASEMAPS, project } from "./basemap";
import { cardPlacement } from "./building-card";
import { MapPin } from "./map-pin";
import { MapScreen } from "./map-screen";
import { MapSkeleton } from "./map-skeleton";
import { toMapBuilding, type MapBuilding } from "./types";

const root = path.resolve(import.meta.dirname, "../../..");
const ready = buildingsWithLevel();
const buildings: MapBuilding[] = FIXTURE_BUILDINGS.map((b) => toMapBuilding(b, ready.has(b.id)));

const pins = (html: string) => [...html.matchAll(/<div data-testid="map-pin"[^>]*data-building="(\w+)"/g)].map((m) => m[1]);
const rows = (html: string) =>
  [...html.matchAll(/<button[^>]*data-testid="building-row"[^>]*data-building="(\w+)"/g)].map((m) => m[1]);
/** The markup of one pin, from its wrapper to the next pin (or the map's caption, after the last). */
function pinMarkup(html: string, id: string): string {
  const start = html.indexOf(`data-testid="map-pin" data-building="${id}"`);
  expect(start, `no pin for ${id}`).toBeGreaterThanOrEqual(0);
  const next = html.indexOf('data-testid="map-pin"', start + 1);
  return html.slice(start, next < 0 ? html.indexOf('data-testid="map-caption"') : next);
}

describe("project", () => {
  const bounds = { west: -118.3, east: -118.2, south: 34.0, north: 34.1 };

  it("maps the bounds' corners to the image's corners", () => {
    expect(project(bounds, 34.1, -118.3)).toEqual({ x: 0, y: 0 });
    const se = project(bounds, 34.0, -118.2);
    expect(se.x).toBeCloseTo(1, 10);
    expect(se.y).toBeCloseTo(1, 10);
  });

  it("is Web Mercator, not linear in latitude: on wide bounds the two clearly differ", () => {
    // From the equator to 60°N, Mercator puts 30°N at y ≈ 0.583 of the height;
    // a linear projection would put it at 0.5.
    const wide = { west: 0, east: 60, south: 0, north: 60 };
    const { x, y } = project(wide, 30, 30);
    expect(x).toBeCloseTo(0.5, 10);
    expect(y).toBeCloseTo(0.5829, 4);
  });

  it("agrees with an independent Mercator formula on every city's basemap", () => {
    // y = atanh(sin φ) is the same projection as the render script's
    // ln(tan(π/4 + φ/2)), written another way, so a broken copy fails here.
    const merc = (lat: number) => Math.atanh(Math.sin((lat * Math.PI) / 180));
    for (const b of FIXTURE_BUILDINGS) {
      const { north, south } = BASEMAPS[b.city].bounds;
      const expected = (merc(north) - merc(b.lat)) / (merc(north) - merc(south));
      const linear = (north - b.lat) / (north - south);
      const { y } = project(BASEMAPS[b.city].bounds, b.lat, b.lng);
      expect(y, b.id).toBeCloseTo(expected, 9);
      // The test can tell the two apart: the gap is far wider than the tolerance.
      expect(Math.abs(expected - linear), b.id).toBeGreaterThan(1e-6);
    }
  });

  it("puts every fixture building on its city's basemap, clear of the edges", () => {
    for (const b of FIXTURE_BUILDINGS) {
      const { x, y } = project(BASEMAPS[b.city].bounds, b.lat, b.lng);
      expect(x, b.id).toBeGreaterThan(0.15);
      expect(x, b.id).toBeLessThan(0.85);
      expect(y, b.id).toBeGreaterThan(0.15);
      expect(y, b.id).toBeLessThan(0.85);
    }
  });
});

describe("the basemap images", () => {
  it.each(Object.entries(BASEMAPS))("%s exists at the size basemaps.json gives", (_city, basemap) => {
    const file = readFileSync(path.join(root, "public", basemap.file));
    expect(file.subarray(0, 4).toString()).toBe("RIFF");
    expect(file.subarray(8, 16).toString()).toBe("WEBPVP8X");
    // VP8X: canvas width - 1 and height - 1, 24-bit little-endian, at bytes 24 and 27.
    expect(file.readUIntLE(24, 3) + 1).toBe(basemap.width);
    expect(file.readUIntLE(27, 3) + 1).toBe(basemap.height);
  });

  it("are credited to OpenStreetMap", () => {
    expect(ATTRIBUTION.text).toBe("© OpenStreetMap contributors");
    expect(ATTRIBUTION.href).toBe("https://www.openstreetmap.org/copyright");
  });
});

describe("buildingsWithLevel", () => {
  it("is the buildings with a floor fixture: only F1 until the other floors land", () => {
    expect([...ready]).toEqual(["F1"]);
  });

  it("is exactly the floors the Matterport fake can load", async () => {
    const matterport = createFakeMatterport();
    expect([...ready].sort()).toEqual(Object.keys(FIXTURE_FLOORS).sort());
    for (const id of ready) expect(await matterport.loadFloor({ id }), id).not.toBeNull();
  });

  it("follows the registry it is given, and is empty for none", () => {
    expect([...buildingsWithLevel({ F4: {} })]).toEqual(["F4"]);
    expect(buildingsWithLevel({}).size).toBe(0);
  });
});

describe("MapScreen", () => {
  const la = renderToStaticMarkup(<MapScreen buildings={buildings} initialCity="LA" />);

  it("shows the three LA buildings as pins and rows", () => {
    expect(pins(la)).toEqual(["F1", "F2", "F3"]);
    expect(rows(la)).toEqual(["F1", "F2", "F3"]);
    expect(la).toContain('src="/basemaps/la.webp"');
  });

  it("shows the two Houston buildings on the Houston tab", () => {
    const houston = renderToStaticMarkup(<MapScreen buildings={buildings} initialCity="Houston" />);
    expect(pins(houston)).toEqual(["F4", "F5"]);
    expect(rows(houston)).toEqual(["F4", "F5"]);
    expect(houston).toMatch(/<button[^>]*role="tab"[^>]*id="tab-Houston"[^>]*aria-selected="true"/);
  });

  it("gives every pin three layer dots", () => {
    for (const id of ["F1", "F2", "F3"]) {
      expect(pinMarkup(la, id).match(/data-layer="(costar|vexcel|matterport)"/g), id).toHaveLength(3);
    }
  });

  it("disables every building without a level and marks it level in prep", () => {
    expect(pinMarkup(la, "F1")).not.toContain("aria-disabled");
    expect(pinMarkup(la, "F1")).toContain('aria-label="Halvorsen Tower"');
    for (const id of ["F2", "F3"]) {
      expect(pinMarkup(la, id)).toContain('aria-disabled="true"');
      expect(pinMarkup(la, id)).toContain("level in prep");
    }
    const inPrepRows = la.match(/<button[^>]*data-testid="building-row"[^>]*aria-disabled="true"/g) ?? [];
    expect(inPrepRows).toHaveLength(2);
    expect(la.match(/Level in prep/g)).toHaveLength(2);
  });

  it("starts with nothing selected and Scout this building disabled", () => {
    expect(la).toMatch(/<button[^>]*disabled=""[^>]*>Scout this building<\/button>/);
    expect(la).not.toContain('href="/b/F1/scout"');
  });

  it("shows the basemap's attribution", () => {
    expect(la).toMatch(/<a href="https:\/\/www.openstreetmap.org\/copyright"[^>]*>© OpenStreetMap contributors<\/a>/);
  });

  it("says so when a city has no buildings, and offers the other city", () => {
    const html = renderToStaticMarkup(<MapScreen buildings={buildings.filter((b) => b.city === "LA")} initialCity="Houston" />);
    expect(pins(html)).toEqual([]);
    expect(html).toContain('data-testid="empty-city"');
    expect(html).toContain("No buildings are staged in Houston yet.");
    expect(html).toMatch(/<button[^>]*>Show Los Angeles<\/button>/);
  });
});

describe("MapPin", () => {
  const f1 = buildings.find((b) => b.id === "F1")!;
  const render = (building: MapBuilding, props: Partial<{ selected: boolean; showCard: boolean }> = {}) =>
    renderToStaticMarkup(
      <MapPin building={building} x={0.5} y={0.6} selected={false} showCard={false} onSelect={() => {}} onHover={() => {}} {...props} />,
    );

  it("dims the dot of a layer the building lacks", () => {
    const html = render({ ...f1, layers: { costar: true, vexcel: false, matterport: true } });
    const dot = (layer: string) => html.match(new RegExp(`<span data-layer="${layer}"[^>]*>`))![0];
    expect(dot("vexcel")).toContain("border-border-strong");
    expect(dot("vexcel")).not.toContain("bg-layer-vexcel");
    expect(dot("costar")).toContain("bg-layer-costar");
    expect(dot("matterport")).toContain("bg-layer-matterport");
  });

  it("shows the hover card with name, neighbourhood, built, class and stories", () => {
    const html = render(f1, { showCard: true });
    const card = html.slice(html.indexOf('data-testid="building-card"')).replace(/<[^>]+>/g, " ");
    for (const value of ["Halvorsen Tower", "Bunker Hill", "Built", "1974", "Class", "A", "Stories", "42"]) {
      expect(card).toContain(value);
    }
    expect(render(f1)).not.toContain("building-card");
  });

  it("marks the selected pin in the accent", () => {
    const html = render(f1, { selected: true });
    expect(html).toContain("data-selected");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("bg-accent");
  });
});

describe("cardPlacement", () => {
  it("keeps the card on the map near each edge", () => {
    expect(cardPlacement(0.5, 0.6)).toEqual({ vertical: "above", horizontal: "centre" });
    expect(cardPlacement(0.1, 0.2)).toEqual({ vertical: "below", horizontal: "start" });
    expect(cardPlacement(0.9, 0.5)).toEqual({ vertical: "above", horizontal: "end" });
  });
});

describe("MapSkeleton", () => {
  it("holds the loaded layout: the panel title, three rows and the action", () => {
    const html = renderToStaticMarkup(<MapSkeleton />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Pick a building");
    expect(html.match(/data-testid="skeleton-row"/g)).toHaveLength(3);
    expect(html).toContain("animate-pulse");
  });
});
