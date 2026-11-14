import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Aerial, type AerialEntry, type LngLat } from "@/domain";
import { createFakeVexcel, FIXTURE_AERIALS, fixtureLocation } from "./fake";
import { selectVexcel } from "./index";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FIXTURE_DIR = path.join(ROOT, "fixtures/vexcel");
/** The fixture buildings of SPEC §7. */
const BUILDING_IDS = ["F1", "F2", "F3", "F4", "F5"];

const files = readdirSync(FIXTURE_DIR).sort();
const read = (file: string): unknown => JSON.parse(readFileSync(path.join(FIXTURE_DIR, file), "utf8"));

// ---- a little plane geometry, in metres around the footprint ----------------

type XY = [number, number];

function toMetres(footprint: LngLat[]) {
  const n = footprint.length;
  const lng0 = footprint.reduce((s, [x]) => s + x, 0) / n;
  const lat0 = footprint.reduce((s, [, y]) => s + y, 0) / n;
  const mLat = 111_132;
  const mLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  return ([lng, lat]: LngLat): XY => [(lng - lng0) * mLng, (lat - lat0) * mLat];
}

function signedArea(ring: XY[]): number {
  let a = 0;
  ring.forEach(([x1, y1], i) => {
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  });
  return a / 2;
}

function inside([px, py]: XY, ring: XY[]): boolean {
  let hit = false;
  ring.forEach(([x1, y1], i) => {
    const [x2, y2] = ring[(i + 1) % ring.length];
    if (y1 > py !== y2 > py && px < ((x2 - x1) * (py - y1)) / (y2 - y1) + x1) hit = !hit;
  });
  return hit;
}

/** The compass bearing (0 = N, 90 = E) the face nearest `p` looks out to, and how far `p` is from it. */
function nearestFace(p: XY, ring: XY[]): { bearing: number; distance: number } {
  const ccw = signedArea(ring) > 0;
  let best = { bearing: NaN, distance: Infinity };
  ring.forEach(([x1, y1], i) => {
    const [x2, y2] = ring[(i + 1) % ring.length];
    const [dx, dy] = [x2 - x1, y2 - y1];
    const t = Math.max(0, Math.min(1, ((p[0] - x1) * dx + (p[1] - y1) * dy) / (dx * dx + dy * dy)));
    const distance = Math.hypot(p[0] - (x1 + t * dx), p[1] - (y1 + t * dy));
    if (distance < best.distance) {
      const [nx, ny] = ccw ? [dy, -dx] : [-dy, dx];
      best = { bearing: ((Math.atan2(nx, ny) * 180) / Math.PI + 360) % 360, distance };
    }
  });
  return best;
}

const BEARING = { N: 0, E: 90, S: 180, W: 270 } as const;
const angleBetween = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/** Which compass face an entry sits on, or "roof". Throws when it is on neither. */
function placement(aerial: Aerial, entry: AerialEntry): string {
  const metres = toMetres(aerial.footprint);
  const ring = aerial.footprint.map(metres);
  const at = entry.at!;
  const p = metres(at.lngLat);
  if (at.elevM === aerial.heightM && inside(p, ring)) return "roof";
  const face = nearestFace(p, ring);
  if (face.distance > 1) throw new Error(`${entry.id} is ${face.distance.toFixed(1)} m off the nearest face`);
  return (Object.keys(BEARING) as (keyof typeof BEARING)[]).find(
    (dir) => angleBetween(face.bearing, BEARING[dir]) < 45,
  )!;
}

// ---- the fixtures -------------------------------------------------------------

describe("the Vexcel fixtures", () => {
  it("has exactly one aerial per fixture building, and the fake serves each", () => {
    expect(files).toEqual(BUILDING_IDS.map((id) => `${id}.json`));
    expect([...FIXTURE_AERIALS.keys()].sort()).toEqual(BUILDING_IDS);
  });

  it.each(BUILDING_IDS)("%s validates against Aerial", (id) => {
    const result = Aerial.safeParse(read(`${id}.json`));
    expect(result.error).toBeUndefined();
  });

  it("holds no imagery: only JSON, no view url, source fixture", () => {
    expect(files.every((f) => f.endsWith(".json"))).toBe(true);
    for (const [id, aerial] of FIXTURE_AERIALS) {
      expect(aerial.source, id).toBe("fixture");
      expect(aerial.views.filter((v) => v.url !== undefined), id).toEqual([]);
      expect(JSON.stringify(read(`${id}.json`)), id).not.toMatch(/"url"|https?:\/\//);
    }
  });

  it("commits no image file anywhere under fixtures/", () => {
    const images = (readdirSync(path.join(ROOT, "fixtures"), { recursive: true }) as string[]).filter((f) =>
      /\.(png|jpe?g|webp|tiff?|gif|jp2)$/i.test(f),
    );
    expect(images).toEqual([]);
  });

  it.each(BUILDING_IDS)("%s has all five views and four or five entries, each with a note", (id) => {
    const aerial = FIXTURE_AERIALS.get(id)!;
    expect(aerial.views.map((v) => v.dir).sort()).toEqual(["E", "N", "S", "W", "ortho"]);
    expect(aerial.entries.length).toBeGreaterThanOrEqual(4);
    expect(aerial.entries.length).toBeLessThanOrEqual(5);
    for (const entry of aerial.entries) expect(entry.note.trim(), entry.id).not.toBe("");
  });

  it.each(BUILDING_IDS)("%s has a plausible floor plate and every entry on the face its view names", (id) => {
    const aerial = FIXTURE_AERIALS.get(id)!;
    const area = Math.abs(signedArea(aerial.footprint.map(toMetres(aerial.footprint))));
    expect(area).toBeGreaterThan(1_500);
    expect(area).toBeLessThan(3_000);
    for (const entry of aerial.entries) {
      const where = placement(aerial, entry);
      expect(where, entry.id).toBe(entry.kind === "roof" ? "roof" : entry.view);
      if (entry.kind === "roof") expect(entry.view, entry.id).toBe("ortho");
    }
  });

  it("puts F1's dock on the north face, the garage ramp on the east, the lobby on the south, and a roof hatch", () => {
    const f1 = FIXTURE_AERIALS.get("F1")!;
    const on = (kind: AerialEntry["kind"]) => f1.entries.filter((e) => e.kind === kind).map((e) => placement(f1, e));
    expect(on("dock")).toEqual(["N"]);
    expect(on("garage")).toEqual(["E"]);
    expect(on("lobby")).toEqual(["S"]);
    expect(on("roof")).toEqual(["roof"]);
    expect(f1.entries.find((e) => e.kind === "dock")!.note).toMatch(/only truck-height door/);
  });

  it("would notice an entry on the wrong face", () => {
    const f1 = FIXTURE_AERIALS.get("F1")!;
    const dock = f1.entries.find((e) => e.kind === "dock")!;
    const lobby = f1.entries.find((e) => e.kind === "lobby")!;
    expect(placement(f1, { ...dock, at: lobby.at })).toBe("S");
  });
});

// ---- the fake ---------------------------------------------------------------------

describe("the fake Vexcel adapter", () => {
  it("returns F1's massing, and null for an unknown building", async () => {
    const fake = createFakeVexcel();
    const f1 = await fake.getAerial("F1");
    expect(f1?.heightM).toBe(160);
    expect(await fake.getAerial("F9")).toBeNull();
  });

  it("has no image for any view: a massing is drawn, not fetched", async () => {
    expect(await createFakeVexcel().getImage("F1", "N")).toBeNull();
  });

  it("hands out copies, so a caller cannot change the fixtures", async () => {
    const fake = createFakeVexcel();
    const first = (await fake.getAerial("F1"))!;
    first.entries.length = 0;
    first.footprint[0][0] = 0;
    const second = (await fake.getAerial("F1"))!;
    expect(second.entries.length).toBeGreaterThanOrEqual(4);
    expect(second.footprint[0][0]).not.toBe(0);
  });

  it("locates a fixture building at the middle of its footprint", () => {
    const at = fixtureLocation("F1")!;
    expect(at.lat).toBeCloseTo(34.05226, 4);
    expect(at.lng).toBeCloseTo(-118.25287, 4);
    expect(fixtureLocation("F9")).toBeNull();
  });
});

// ---- the mode switch ------------------------------------------------------------

describe("selectVexcel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const KEYS = { VEXCEL_API_BASE: "https://vexcel.invalid/v1", VEXCEL_API_KEY: "test-key" };

  it("is fake with an empty environment", async () => {
    const selection = selectVexcel({});
    expect(selection.mode).toBe("fake");
    expect(selection.reason).toBe("Vexcel: fixtures (fake mode)");
    expect((await selection.adapter.getAerial("F1"))?.source).toBe("fixture");
  });

  it("stays fake when VEXCEL_MODE=fake overrides HEIST_MODE=live, even with keys", () => {
    expect(selectVexcel({ HEIST_MODE: "live", VEXCEL_MODE: "fake", ...KEYS }).mode).toBe("fake");
  });

  it("falls back to fixtures in live mode when a key is missing, and names it", async () => {
    const none = selectVexcel({ VEXCEL_MODE: "live" });
    expect(none.mode).toBe("fake");
    expect(none.reason).toBe("Vexcel: fixtures (live mode, but VEXCEL_API_BASE and VEXCEL_API_KEY not set)");
    expect((await none.adapter.getAerial("F1"))?.source).toBe("fixture");

    const noKey = selectVexcel({ HEIST_MODE: "live", VEXCEL_API_BASE: KEYS.VEXCEL_API_BASE });
    expect(noKey.mode).toBe("fake");
    expect(noKey.reason).toContain("VEXCEL_API_KEY not set");
  });

  it("goes live with the mode and both variables, asking Vexcel at the building's block", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 404 }));
    vi.stubGlobal("fetch", fetch);

    const selection = selectVexcel({ HEIST_MODE: "live", ...KEYS });
    expect(selection.mode).toBe("live");
    expect(selection.reason).toBe("Vexcel: live");

    // A 404 from Vexcel is a failure (the index's breaker turns it into the massing).
    await expect(selection.adapter.getAerial("F1")).rejects.toThrow("answered 404");
    expect(fetch).toHaveBeenCalledOnce();
    const url = new URL(String((fetch.mock.calls[0] as unknown[])[0]));
    expect(url.origin + url.pathname).toBe("https://vexcel.invalid/v1/oriented/collections");
    const [lng, lat] = /POINT\((\S+) (\S+)\)/.exec(url.searchParams.get("wkt")!)!.slice(1).map(Number);
    expect(lat).toBeCloseTo(34.05226, 4);
    expect(lng).toBeCloseTo(-118.25287, 4);
  });

  it("asks Vexcel nothing for a building with no massing", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    expect(await selectVexcel({ HEIST_MODE: "live", ...KEYS }).adapter.getAerial("F9")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
