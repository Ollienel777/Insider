// The massing derived from a building's CoStar facts, for live Vexcel to aim
// at a kit building. Every building here is made up; no kit record is used.
import { afterEach, describe, expect, it, vi } from "vitest";
import { Aerial, type Building, type LngLat } from "@/domain";
import { deriveMassing, M_PER_STOREY, MAX_SIDE_M, MIN_SIDE_M, SHAPE_SLACK } from "./derived-massing";
import { FIXTURE_AERIALS } from "./fake";
import { massingFor, selectVexcel } from "./index";
import { createLiveVexcel } from "./live";
import { mPerDegLng, M_PER_DEG_LAT, orthoBounds } from "./mapping";

/** A made-up kit building: a point in open country, 12 stories of 10,000 sf. */
const KIT: Building = {
  id: "900001",
  name: "Test Tower",
  city: "Houston",
  neighbourhood: "Testville",
  lat: 30,
  lng: -95,
  yearBuilt: 1985,
  buildingClass: "B",
  stories: 12,
  rbaSf: 120_000,
  typicalFloorSf: 10_000,
  availableSpace: [],
  layers: { costar: true, vexcel: false, matterport: false },
  source: "costar",
};

/** The footprint's side for a 10,000 sf floor, in metres: the floor's square, widened for an unknown shape. */
const SIDE_M = Math.sqrt(10_000 * 0.09290304) * SHAPE_SLACK;

/** The footprint's width (east-west) and depth (north-south), in metres. */
function sizeM(footprint: LngLat[]) {
  const lngs = footprint.map(([x]) => x);
  const lats = footprint.map(([, y]) => y);
  const lat = (Math.max(...lats) + Math.min(...lats)) / 2;
  return {
    width: (Math.max(...lngs) - Math.min(...lngs)) * 111_320 * Math.cos((lat * Math.PI) / 180),
    depth: (Math.max(...lats) - Math.min(...lats)) * 111_132,
  };
}

describe("deriveMassing", () => {
  it("centres a square sized from the typical floor on the CoStar point", () => {
    const aerial = deriveMassing(KIT)!;
    expect(Aerial.safeParse(aerial).error).toBeUndefined();
    expect(aerial.footprint).toHaveLength(4);
    const { width, depth } = sizeM(aerial.footprint);
    expect(width).toBeCloseTo(SIDE_M, 1);
    expect(depth).toBeCloseTo(SIDE_M, 1);
    const lng = aerial.footprint.reduce((s, [x]) => s + x, 0) / 4;
    const lat = aerial.footprint.reduce((s, [, y]) => s + y, 0) / 4;
    expect(lng).toBeCloseTo(KIT.lng, 9);
    expect(lat).toBeCloseTo(KIT.lat, 9);
  });

  it("sizes from the typical floor, not the building's area over its stories, when CoStar gives one", () => {
    const { width } = sizeM(deriveMassing({ ...KIT, typicalFloorSf: 40_000 })!.footprint);
    expect(width).toBeCloseTo(SIDE_M * 2, 1);
  });

  it("falls back to the building's area over its stories with no typical floor", () => {
    for (const typicalFloorSf of [null, undefined, 0]) {
      const { width, depth } = sizeM(deriveMassing({ ...KIT, typicalFloorSf, rbaSf: 240_000 })!.footprint);
      expect(width).toBeCloseTo(SIDE_M * Math.SQRT2, 1);
      expect(depth).toBeCloseTo(SIDE_M * Math.SQRT2, 1);
    }
  });

  it("frames a 3:1 slab of the floor's area in the ortho, whichever way it runs", () => {
    expect(SHAPE_SLACK).toBeCloseTo(Math.sqrt(3), 9);
    const box = orthoBounds(deriveMassing(KIT)!.footprint);
    const areaM2 = 10_000 * 0.09290304;
    const [long, short] = [Math.sqrt(areaM2 * 3), Math.sqrt(areaM2 / 3)];
    for (let deg = 0; deg < 180; deg += 15) {
      const a = (deg * Math.PI) / 180;
      for (const [u, v] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        // A corner of the slab, turned `deg` from east, in metres from the centre.
        const x = (u * long * Math.cos(a)) / 2 - (v * short * Math.sin(a)) / 2;
        const y = (u * long * Math.sin(a)) / 2 + (v * short * Math.cos(a)) / 2;
        const lng = KIT.lng + x / mPerDegLng(KIT.lat);
        const lat = KIT.lat + y / M_PER_DEG_LAT;
        expect(lng, `${deg}°`).toBeGreaterThan(box.west);
        expect(lng, `${deg}°`).toBeLessThan(box.east);
        expect(lat, `${deg}°`).toBeGreaterThan(box.south);
        expect(lat, `${deg}°`).toBeLessThan(box.north);
      }
    }
  });

  it("holds the side between its bounds, so one mis-entered area can't size the request", () => {
    expect(sizeM(deriveMassing({ ...KIT, typicalFloorSf: 5_000_000 })!.footprint).width).toBeCloseTo(MAX_SIDE_M, 0);
    expect(sizeM(deriveMassing({ ...KIT, typicalFloorSf: 3 })!.footprint).width).toBeCloseTo(MIN_SIDE_M, 0);
  });

  it("marks itself derived", () => {
    expect(deriveMassing(KIT)!.derived).toBe(true);
  });

  it("takes its height from the stories", () => {
    expect(M_PER_STOREY).toBe(4);
    expect(deriveMassing(KIT)!.heightM).toBe(48);
    expect(deriveMassing({ ...KIT, stories: 3 })!.heightM).toBe(12);
  });

  it("tags no entries: nothing in CoStar's facts marks a dock or a door", () => {
    expect(deriveMassing(KIT)!.entries).toEqual([]);
  });

  it("derives nothing without coordinates, stories or any floor area", () => {
    expect(deriveMassing({ ...KIT, lat: null })).toBeNull();
    expect(deriveMassing({ ...KIT, lng: undefined })).toBeNull();
    expect(deriveMassing({ ...KIT, lat: Number.NaN })).toBeNull();
    expect(deriveMassing({ ...KIT, stories: 0 })).toBeNull();
    expect(deriveMassing({ ...KIT, typicalFloorSf: null, rbaSf: null })).toBeNull();
  });
});

describe("massingFor", () => {
  it("keeps a fixture building's hand-made massing, without asking CoStar", async () => {
    const lookup = vi.fn(async () => KIT);
    expect(await massingFor("F1", lookup)).toEqual(FIXTURE_AERIALS.get("F1"));
    expect(lookup).not.toHaveBeenCalled();
  });

  it("derives a kit building's massing from its CoStar facts", async () => {
    expect(await massingFor(KIT.id, async (id) => (id === KIT.id ? KIT : null))).toEqual(deriveMassing(KIT));
  });

  it("has none for a building CoStar doesn't know, or when CoStar fails", async () => {
    expect(await massingFor("900002", async () => null)).toBeNull();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      await massingFor(KIT.id, async () => {
        throw new Error("kit unreadable");
      }),
    ).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe("live Vexcel on a kit building (stubbed fetch, no key)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const KEYS = { VEXCEL_API_BASE: "https://vexcel.invalid/v2", VEXCEL_API_KEY: "test-key" };

  it("asks Vexcel at the building's CoStar point", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    const selection = selectVexcel({ HEIST_MODE: "live", ...KEYS }, { building: async (id) => (id === KIT.id ? KIT : null) });
    // A 404 is no coverage: no aerial, and nothing throws.
    expect(await selection.adapter.getAerial(KIT.id)).toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
    const url = new URL(String((fetch.mock.calls[0] as unknown[])[0]));
    expect(url.pathname).toBe("/v2/oriented/collections");
    const [lng, lat] = /POINT\((\S+) (\S+)\)/.exec(url.searchParams.get("wkt")!)!.slice(1).map(Number);
    expect(lat).toBeCloseTo(KIT.lat, 9);
    expect(lng).toBeCloseTo(KIT.lng, 9);
  });

  it("serves the imagery through the proxy, with the derived footprint and height and no entries", async () => {
    // No obliques there, and a 16:10 ortho: a JPEG header is all the size reader needs.
    const ortho = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 1000 >> 8, 1000 & 0xff, 1600 >> 8, 1600 & 0xff, 0x03]);
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("oriented/collections")) return Response.json({ features: [] });
      return new Response(ortho, { headers: { "content-type": "image/jpeg" } });
    });
    const live = createLiveVexcel({
      base: KEYS.VEXCEL_API_BASE,
      key: KEYS.VEXCEL_API_KEY,
      massing: (id) => massingFor(id, async () => KIT),
      fetch: fetch as typeof globalThis.fetch,
      warn: () => {},
    });
    const aerial = (await live.getAerial(KIT.id))!;
    const derived = deriveMassing(KIT)!;
    expect(aerial).toMatchObject({ source: "vexcel", derived: true, entries: [], footprint: derived.footprint, heightM: 48 });
    expect(aerial.views).toEqual([{ dir: "ortho", url: `/api/buildings/${KIT.id}/aerial/ortho`, width: 1600, height: 1000 }]);
    expect((await live.getImage(KIT.id, "ortho"))?.contentType).toBe("image/jpeg");
  });
});

describe("the breaker and a derived massing", () => {
  it("never counts a derived-massing building's failure towards the breaker, but a fixture's still does", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 503 }));
    const kit = (id: string) => ({ ...KIT, id });
    const live = createLiveVexcel({
      base: "https://vexcel.invalid/v2",
      key: "test-key",
      massing: (id) => massingFor(id, async (k) => (k.startsWith("9") ? kit(k) : null)),
      fetch: fetch as typeof globalThis.fetch,
      warn: () => {},
      failureLimit: 2,
    });
    for (const id of ["900001", "900002", "900003", "900004"]) expect(await live.getAerial(id)).toBeNull();
    // Fixtures fail on the same service: the second in a row trips it.
    expect(await live.getAerial("F1")).toBeNull();
    await expect(live.getAerial("F2")).rejects.toThrow("503");
  });

  it("still trips at once on a network failure, derived or not", async () => {
    const live = createLiveVexcel({
      base: "https://vexcel.invalid/v2",
      key: "test-key",
      massing: (id) => massingFor(id, async () => KIT),
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof globalThis.fetch,
      warn: () => {},
    });
    await expect(live.getAerial(KIT.id)).rejects.toThrow("fetch failed");
  });
});
