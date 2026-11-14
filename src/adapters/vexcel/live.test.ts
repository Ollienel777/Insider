// The live adapter on a stubbed fetch. The response is hand-written in the
// shape mapping.ts assumes (Q3 is unanswered), not recorded from Vexcel.
import { describe, expect, it } from "vitest";
import { Aerial } from "@/domain";
import { createLiveVexcel, VexcelNotConfiguredError } from "./live";
import { ENDPOINT, toAerial } from "./mapping";

const BASE = "https://vexcel.invalid/v1/";
const HERE = { lat: 34.0489, lng: -118.2551 };
const locate = async (id: string) => (id === "B1" ? HERE : null);

const RESPONSE = {
  images: [
    { orientation: "North", url: "https://img.vexcel.invalid/n.jpg", width: 4000, height: "2672" },
    { orientation: "east", url: "https://img.vexcel.invalid/e.jpg", width: 4000, height: 2672 },
    { orientation: "nadir", url: "https://img.vexcel.invalid/o.jpg", width: 3000, height: 3000 },
    { orientation: "forward", url: "https://img.vexcel.invalid/f.jpg", width: 10, height: 10 },
  ],
  footprint: {
    type: "Polygon",
    coordinates: [
      [
        [-118.2554, 34.0487],
        [-118.2548, 34.0487],
        [-118.2548, 34.0491],
        [-118.2554, 34.0491],
        [-118.2554, 34.0487],
      ],
    ],
  },
  heightM: "142.5",
  entries: [
    { id: 7, type: "loading_dock", label: "Dock", orientation: "north", pixel: { x: 1820, y: "1404" }, note: "Two bays" },
    { id: "r", type: "ROOF_ACCESS", label: "Hatch", orientation: "nadir", pixel: { x: 1500, y: 1500 } },
    { id: "s", type: "fire_door", label: "Side door", orientation: "east", pixel: { x: 10, y: 20 } },
    { id: "w", type: "main_entrance", label: "Lobby", orientation: "west", pixel: { x: 1, y: 1 } },
  ],
};

function stub(status: number, body: unknown = RESPONSE) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), init });
    return status === 200 ? Response.json(body) : new Response("{}", { status });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

describe("the live Vexcel adapter (stubbed fetch, no key)", () => {
  it("refuses to start without a base and a key", () => {
    expect(() => createLiveVexcel({ key: "k", locate })).toThrow(VexcelNotConfiguredError);
    expect(() => createLiveVexcel({ base: BASE, locate })).toThrow("VEXCEL_API_KEY missing");
  });

  it("asks for the building's point with the key as a bearer token", async () => {
    const { fetch, calls } = stub(200);
    await createLiveVexcel({ base: BASE, key: "k", locate, fetch }).getAerial("B1");
    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls;
    expect(url.origin + url.pathname).toBe(`https://vexcel.invalid/v1${ENDPOINT}`);
    expect(url.searchParams.get("lat")).toBe(String(HERE.lat));
    expect(url.searchParams.get("lng")).toBe(String(HERE.lng));
    expect(url.searchParams.get("views")).toBe("north,east,south,west,nadir");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer k");
  });

  it("maps the response onto a valid live Aerial", async () => {
    const { fetch } = stub(200);
    const aerial = (await createLiveVexcel({ base: BASE, key: "k", locate, fetch }).getAerial("B1"))!;
    expect(Aerial.safeParse(aerial).error).toBeUndefined();
    expect(aerial.source).toBe("vexcel");
    // Unknown orientations are dropped; every kept view has its image.
    expect(aerial.views.map((v) => v.dir)).toEqual(["N", "E", "ortho"]);
    expect(aerial.views[0]).toEqual({ dir: "N", url: "https://img.vexcel.invalid/n.jpg", width: 4000, height: 2672 });
    // The closing point of the GeoJSON ring is not repeated.
    expect(aerial.footprint).toHaveLength(4);
    expect(aerial.heightM).toBe(142.5);
    // Kinds map case-blind, unknown types become service doors, and an entry
    // on a view that was not returned is dropped.
    expect(aerial.entries.map((e) => [e.id, e.kind, e.view, e.x, e.y])).toEqual([
      ["7", "dock", "N", 1820, 1404],
      ["r", "roof", "ortho", 1500, 1500],
      ["s", "service", "E", 10, 20],
    ]);
    expect(aerial.entries[1].note).toBe("");
  });

  it("answers null for a building it cannot locate, without calling Vexcel", async () => {
    const { fetch, calls } = stub(200);
    expect(await createLiveVexcel({ base: BASE, key: "k", locate, fetch }).getAerial("nowhere")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("answers null on a 404 and throws, naming the status, on anything else", async () => {
    const missing = createLiveVexcel({ base: BASE, key: "k", locate, fetch: stub(404).fetch });
    expect(await missing.getAerial("B1")).toBeNull();
    const broken = createLiveVexcel({ base: BASE, key: "k", locate, fetch: stub(503).fetch });
    await expect(broken.getAerial("B1")).rejects.toThrow("answered 503");
  });

  it("throws rather than return a response it cannot map", async () => {
    expect(() => toAerial({ images: [], footprint: RESPONSE.footprint, heightM: 10 })).toThrow();
    expect(() => toAerial({ ...RESPONSE, heightM: "tall" })).toThrow();
  });
});
