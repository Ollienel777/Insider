// The live adapter on a stubbed fetch. The collections answer is hand-written
// in the shape Vexcel's `oriented/collections` returned on 2026-11-14; the
// images are bare headers, enough for their size to be read. No key, no
// network, and no real imagery anywhere.
import { describe, expect, it, vi } from "vitest";
import { Aerial } from "@/domain";
import { FIXTURE_AERIALS } from "./fake";
import { imageSize } from "./image-size";
import { createLiveVexcel, imageUrl, MAX_IMAGE_BYTES, VexcelNotConfiguredError } from "./live";
import {
  centreOf,
  collectionsRequest,
  obliqueBufferM,
  obliqueRequest,
  orthoBounds,
  orthoPixel,
  orthoRequest,
  placeOnOrtho,
  toObliques,
} from "./mapping";

const BASE = "https://vexcel.invalid/v2/";
const F1 = FIXTURE_AERIALS.get("F1")!;
const massing = async (id: string) => (id === "F1" ? structuredClone(F1) : null);

/** A PNG's signature and IHDR: all `imageSize` reads. */
function png(width: number, height: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(b.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return b;
}

/** A JPEG's start, an APP0 segment to skip, and a baseline start-of-frame. */
function jpeg(width: number, height: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03,
  ]);
}

const COLLECTIONS = {
  type: "FeatureCollection",
  features: [
    ["us-ca-losangeles-2025", "oblique-north"],
    ["us-ca-losangeles-2025", "oblique-west"],
    ["us-ca-losangeles-2025", "oblique-south"],
    ["us-ca-losangeles-2025", "oblique-east"],
    ["us-ca-losangeles-2024", "oblique-north"],
  ].map(([collection, type]) => ({
    type: "Feature",
    properties: { collection, layer: "urban", "product-type": type, "last-capture-date": "2025-12-10T21:03:34" },
  })),
};

/**
 * The stub ortho's size. Vexcel's live ortho for F1's frame came back
 * 1038x651 (aspect 1.5945) on 2026-11-14; the stub keeps the asked-for 16:10.
 */
const ORTHO = { width: 1600, height: 1000 };

/**
 * A fetch that answers like Vexcel, logs every call, and fails what `fail`
 * names. `oversize` names calls whose answer declares more bytes than allowed.
 */
function stub({
  fail = {} as Record<string, number>,
  collections = COLLECTIONS as unknown,
  ortho = ORTHO,
  oversize = [] as string[],
} = {}) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const path = url.pathname.replace(/^\/v2\//, "");
    const which = path === "oriented/extract" ? url.searchParams.get("product-type")! : path;
    if (fail[which]) return new Response("{}", { status: fail[which] });
    if (path === "oriented/collections") return Response.json(collections);
    const headers: Record<string, string> = oversize.includes(which) ? { "content-length": String(MAX_IMAGE_BYTES + 1) } : {};
    if (path === "ortho/extract") {
      return new Response(jpeg(ortho.width, ortho.height), { headers: { "content-type": "image/jpeg", ...headers } });
    }
    return new Response(png(960, 700), { headers: { "content-type": "image/png", ...headers } });
  });
  return { fetch: fetch as typeof globalThis.fetch, calls, mock: fetch };
}

function live(fetch: typeof globalThis.fetch, extra: Partial<Parameters<typeof createLiveVexcel>[0]> = {}) {
  return createLiveVexcel({ base: BASE, key: "test-key", massing, fetch, warn: () => {}, ...extra });
}

describe("the Vexcel requests (mapping.ts)", () => {
  const at = { lat: 34.0523, lng: -118.2529 };

  it("asks oriented/collections for the urban layer's obliques at the point", () => {
    const { path, params } = collectionsRequest(at);
    expect(path).toBe("oriented/collections");
    expect(params.get("wkt")).toBe("POINT(-118.2529 34.0523)");
    expect(params.get("srid")).toBe("4326");
    expect(params.get("layer")).toBe("urban");
    expect(params.get("product-type")).toBe("oblique");
    expect(params.get("metadata-format")).toBe("JSON");
    expect(params.get("order-by")).toBe("first-capture-date-desc");
  });

  it("clips the ortho to a WKT polygon, closed, in lng-lat order", () => {
    const { path, params } = orthoRequest({ west: -1, south: 2, east: 3, north: 4 });
    expect(path).toBe("ortho/extract");
    expect(params.get("wkt")).toBe("POLYGON((-1 2,3 2,3 4,-1 4,-1 2))");
    expect(params.get("layer")).toBe("urban");
    expect(params.get("srid")).toBe("4326");
    expect(params.get("image-format")).toBe("jpeg");
  });

  it("extracts one oblique by collection and direction, cropped round the point", () => {
    const oblique = { dir: "S" as const, layer: "urban", collection: "us-ca-losangeles-2025", productType: "oblique-north" };
    const { path, params } = obliqueRequest(oblique, at, 90);
    expect(path).toBe("oriented/extract");
    expect(Object.fromEntries(params)).toMatchObject({
      layer: "urban",
      collection: "us-ca-losangeles-2025",
      "product-type": "oblique-north",
      wkt: "POINT(-118.2529 34.0523)",
      "buffer-meter": "90",
      crop: "bounding_box",
      rotation: "natural",
    });
  });

  it("reads the newest collection's obliques, one per direction, named for the side they show", () => {
    const obliques = toObliques(COLLECTIONS);
    // A camera looking north sees the south face.
    expect(obliques.map((o) => [o.productType, o.dir])).toEqual([
      ["oblique-north", "S"],
      ["oblique-west", "E"],
      ["oblique-south", "N"],
      ["oblique-east", "W"],
    ]);
    expect(new Set(obliques.map((o) => o.collection))).toEqual(new Set(["us-ca-losangeles-2025"]));
    expect(toObliques({ features: [] })).toEqual([]);
    expect(() => toObliques({ nope: true })).toThrow();
  });

  it("frames the ortho at 16:10 round the whole footprint", () => {
    const box = orthoBounds(F1.footprint);
    const { lat } = centreOf(F1.footprint);
    const w = (box.east - box.west) * 111_320 * Math.cos((lat * Math.PI) / 180);
    const h = (box.north - box.south) * 111_132;
    expect(w / h).toBeCloseTo(1.6, 5);
    for (const corner of F1.footprint) expect(orthoPixel(corner, box, { width: 1600, height: 1000 })).not.toBeNull();
    expect(orthoPixel([box.west - 0.001, box.north], box, { width: 1600, height: 1000 })).toBeNull();
    expect(orthoPixel([box.west, box.north], box, { width: 1600, height: 1000 })).toEqual({ x: 0, y: 0 });
  });

  it("crops the obliques wide enough for a tall building's roof", () => {
    expect(obliqueBufferM(F1)).toBeGreaterThan(F1.heightM * 0.8);
    expect(obliqueBufferM({ ...F1, heightM: 5_000 })).toBe(250);
  });

  it("drops and logs an entry it cannot place, and keeps the rest", () => {
    const warn = vi.fn();
    const box = orthoBounds(F1.footprint);
    const [first, second] = F1.entries;
    const placed = placeOnOrtho(
      [first, { ...second, at: undefined }, { ...second, id: "far", at: { lngLat: [0, 0], elevM: 0 } }],
      box,
      { width: 1600, height: 1000 },
      warn,
    );
    expect(placed.map((e) => e.id)).toEqual([first.id]);
    expect(placed[0]).toMatchObject({ view: "ortho", at: first.at });
    expect(warn.mock.calls.map(([m]) => m)).toEqual([
      `Vexcel: entry "${second.id}" dropped (no anchor to place it by)`,
      'Vexcel: entry "far" dropped (off the ortho)',
    ]);
  });
});

describe("imageSize", () => {
  it("reads a PNG's and a JPEG's size from the header, and refuses anything else", () => {
    expect(imageSize(png(960, 705))).toEqual({ width: 960, height: 705, contentType: "image/png" });
    expect(imageSize(jpeg(970, 609))).toEqual({ width: 970, height: 609, contentType: "image/jpeg" });
    expect(imageSize(new TextEncoder().encode('{"error":"nope"}'))).toBeNull();
    expect(imageSize(new Uint8Array([0xff, 0xd8, 0x00]))).toBeNull();
    // A zero side is no image, in a PNG as in a JPEG.
    expect(imageSize(png(0, 705))).toBeNull();
    expect(imageSize(png(960, 0))).toBeNull();
    expect(imageSize(jpeg(0, 609))).toBeNull();
  });

  it("walks past 0xFF fill bytes and the markers that carry no length", () => {
    const frame = jpeg(970, 609).slice(2);
    const padded = new Uint8Array([
      0xff, 0xd8,
      // Fill bytes before a marker, then TEM and a restart marker, neither with a length.
      0xff, 0xff, 0xff, 0x01,
      0xff, 0xd3,
      ...frame.slice(0, 6),
      0xff, 0xff, ...frame.slice(6),
    ]);
    expect(imageSize(padded)).toEqual({ width: 970, height: 609, contentType: "image/jpeg" });
    // A segment that claims less than its own length field is refused, not looped on.
    expect(imageSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0xff, 0xc0]))).toBeNull();
  });
});

describe("the live Vexcel adapter (stubbed fetch, no key)", () => {
  it("refuses to start without a base and a key", () => {
    expect(() => createLiveVexcel({ key: "k", massing })).toThrow(VexcelNotConfiguredError);
    expect(() => createLiveVexcel({ base: BASE, massing })).toThrow("VEXCEL_API_KEY missing");
  });

  it("sends the key in X-API-KEY on every call, and asks at the massing's middle", async () => {
    const { fetch, calls } = stub();
    await live(fetch).getAerial("F1");
    // The collections, then the ortho and four obliques.
    expect(calls.map((c) => c.url.pathname)).toEqual([
      "/v2/oriented/collections",
      "/v2/ortho/extract",
      ...Array(4).fill("/v2/oriented/extract"),
    ]);
    for (const { url, init } of calls) {
      expect(url.origin).toBe("https://vexcel.invalid");
      expect(new Headers(init?.headers).get("X-API-KEY")).toBe("test-key");
      expect(url.search).not.toContain("test-key");
    }
    const { lat, lng } = centreOf(F1.footprint);
    expect(calls[0].url.searchParams.get("wkt")).toBe(`POINT(${lng} ${lat})`);
  });

  it("maps the imagery onto a valid live Aerial: five views through the proxy, entries pinned on the ortho", async () => {
    const { fetch } = stub();
    const aerial = (await live(fetch).getAerial("F1"))!;
    expect(Aerial.safeParse(aerial).error).toBeUndefined();
    expect(aerial.source).toBe("vexcel");
    expect(aerial.views.map((v) => v.dir)).toEqual(["N", "E", "S", "W", "ortho"]);
    expect(aerial.views.at(-1)).toEqual({ dir: "ortho", url: imageUrl("F1", "ortho"), width: 1600, height: 1000 });
    expect(aerial.views[0]).toMatchObject({ url: "/api/buildings/F1/aerial/N", width: 960, height: 700 });
    // No view points at Vexcel: the browser only ever sees the proxy.
    expect(JSON.stringify(aerial)).not.toContain("vexcel.invalid");
    // The massing's footprint, height and every hand-placed entry carry over.
    expect(aerial.footprint).toEqual(F1.footprint);
    expect(aerial.heightM).toBe(F1.heightM);
    expect(aerial.entries.map((e) => e.id)).toEqual(F1.entries.map((e) => e.id));
    for (const entry of aerial.entries) {
      expect(entry.view).toBe("ortho");
      expect(entry.x).toBeGreaterThan(0);
      expect(entry.x).toBeLessThan(1600);
      expect(entry.y).toBeGreaterThan(0);
      expect(entry.y).toBeLessThan(1000);
    }
  });

  it("keeps the directions Vexcel has, skipping one that fails", async () => {
    const warn = vi.fn();
    const { fetch } = stub({ fail: { "oblique-east": 500 } });
    const aerial = (await live(fetch, { warn }).getAerial("F1"))!;
    expect(aerial.views.map((v) => v.dir)).toEqual(["N", "E", "S", "ortho"]);
    expect(warn).toHaveBeenCalledWith("Vexcel: W view of F1 skipped (Vexcel: GET oriented/extract answered 500)");
  });

  it("drops the entries, logged, when only the obliques came back", async () => {
    const warn = vi.fn();
    const { fetch } = stub({ fail: { "ortho/extract": 502 } });
    const aerial = (await live(fetch, { warn }).getAerial("F1"))!;
    expect(aerial.views.map((v) => v.dir)).toEqual(["N", "E", "S", "W"]);
    expect(aerial.entries).toEqual([]);
    expect(warn).toHaveBeenCalledWith(`Vexcel: ${F1.entries.length} entries of F1 dropped (no ortho to place them on)`);
  });

  it("answers null, logged, when one building fails on its own: its massing stands in, Vexcel stays live", async () => {
    const warn = vi.fn();
    expect(await live(stub({ fail: { "oriented/collections": 503 } }).fetch, { warn }).getAerial("F1")).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("F1 failed (Vexcel: GET oriented/collections answered 503)"));
    const broken = stub({ fail: { "ortho/extract": 500 }, collections: { features: [] } });
    expect(await live(broken.fetch, { warn }).getAerial("F1")).toBeNull();
    // A collections answer in a shape the mapping refuses is that building's too.
    expect(await live(stub({ collections: { features: "nope" } }).fetch, { warn }).getAerial("F1")).toBeNull();
  });

  it("does not hold a building's failure: the next ask tries Vexcel again", async () => {
    let failing = true;
    const ok = stub();
    const fetch = (async (input: string | URL | Request, init?: RequestInit) =>
      failing ? new Response("{}", { status: 503 }) : ok.fetch(input, init)) as typeof globalThis.fetch;
    const adapter = live(fetch);
    expect(await adapter.getAerial("F1")).toBeNull();
    failing = false;
    expect((await adapter.getAerial("F1"))?.source).toBe("vexcel");
  });

  it("throws, so the breaker trips, once several buildings fail in a row", async () => {
    const any = async (id: string) => (["F1", "F2", "F3"].includes(id) ? structuredClone(F1) : null);
    const adapter = live(stub({ fail: { "oriented/collections": 503 } }).fetch, { massing: any });
    expect(await adapter.getAerial("F1")).toBeNull();
    // The same building again is not a second failure of the service.
    expect(await adapter.getAerial("F1")).toBeNull();
    expect(await adapter.getAerial("F2")).toBeNull();
    await expect(adapter.getAerial("F3")).rejects.toThrow("Vexcel: GET oriented/collections answered 503");
  });

  it("starts the count again once a building loads", async () => {
    const any = async (id: string) => (id === "BAD1" || id === "BAD2" || id === "F1" ? structuredClone(F1) : null);
    let bad = true;
    const ok = stub();
    const fetch = (async (input: string | URL | Request, init?: RequestInit) =>
      bad ? new Response("{}", { status: 500 }) : ok.fetch(input, init)) as typeof globalThis.fetch;
    const adapter = live(fetch, { massing: any, failureLimit: 2 });
    expect(await adapter.getAerial("BAD1")).toBeNull();
    bad = false;
    expect((await adapter.getAerial("F1"))?.source).toBe("vexcel");
    bad = true;
    expect(await adapter.getAerial("BAD2")).toBeNull();
  });

  it("throws at once, so the breaker trips, when the network fails or times out", async () => {
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof globalThis.fetch;
    await expect(live(down).getAerial("F1")).rejects.toThrow("fetch failed");
    const slow = (async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }) as typeof globalThis.fetch;
    await expect(live(slow).getAerial("F1")).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("throws, so the breaker trips, when every view failed on the network", async () => {
    const ok = stub();
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (new URL(String(input)).pathname.endsWith("oriented/collections")) return ok.fetch(input, init);
      throw new TypeError("fetch failed");
    }) as typeof globalThis.fetch;
    await expect(live(fetch).getAerial("F1")).rejects.toThrow("fetch failed");
  });

  it("answers null for a building Vexcel has no coverage for, without throwing", async () => {
    const warn = vi.fn();
    expect(await live(stub({ fail: { "oriented/collections": 404 } }).fetch, { warn }).getAerial("F1")).toBeNull();
    const empty = stub({ fail: { "ortho/extract": 404 }, collections: { features: [] } });
    expect(await live(empty.fetch, { warn }).getAerial("F1")).toBeNull();
    expect(warn).toHaveBeenCalledWith("Vexcel: no coverage for F1; it gets the massing");
  });

  it("drops the entries, logged, when the ortho is not the 16:10 frame asked for", async () => {
    const warn = vi.fn();
    const aerial = (await live(stub({ ortho: { width: 1600, height: 900 } }).fetch, { warn }).getAerial("F1"))!;
    expect(aerial.views.map((v) => v.dir)).toEqual(["N", "E", "S", "W", "ortho"]);
    expect(aerial.entries).toEqual([]);
    expect(warn).toHaveBeenCalledWith(`Vexcel: ${F1.entries.length} entries of F1 dropped (the ortho came back 1600×900, not 16:10)`);
    // Vexcel's own 1038x651 is within the tolerance.
    const real = (await live(stub({ ortho: { width: 1038, height: 651 } }).fetch).getAerial("F1"))!;
    expect(real.entries.map((e) => e.id)).toEqual(F1.entries.map((e) => e.id));
  });

  it("never follows a redirect: asks with redirect manual, and a 3xx fails without a second request", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(null, { status: 302, headers: { location: "https://elsewhere.invalid/steal" } });
    }) as typeof globalThis.fetch;
    // A redirect is the service's problem, not one building's: it throws, and the breaker trips.
    await expect(live(fetch).getAerial("F1")).rejects.toThrow("redirects are refused");
    expect(calls).toHaveLength(1);
    expect(calls[0].init?.redirect).toBe("manual");
    expect(calls.some((c) => c.url.includes("elsewhere"))).toBe(false);
  });

  it("refuses a redirect on an image too, and every view redirected trips the breaker", async () => {
    const ok = stub();
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (new URL(String(input)).pathname.endsWith("oriented/collections")) return ok.fetch(input, init);
      return new Response(null, { status: 307, headers: { location: "https://elsewhere.invalid/" } });
    }) as typeof globalThis.fetch;
    await expect(live(fetch).getAerial("F1")).rejects.toThrow("redirects are refused");
  });

  it("carries no key to another host when a real server redirects (Node's own fetch)", async () => {
    const { createServer } = await import("node:http");
    const seen: (string | undefined)[] = [];
    const other = createServer((req, res) => {
      seen.push(req.headers["x-api-key"] as string | undefined);
      res.end("{}");
    });
    await new Promise<void>((done) => other.listen(0, "127.0.0.1", done));
    const otherPort = (other.address() as { port: number }).port;
    const first = createServer((_req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${otherPort}/v2/oriented/collections` });
      res.end();
    });
    await new Promise<void>((done) => first.listen(0, "localhost", done));
    const firstPort = (first.address() as { port: number }).port;
    try {
      const adapter = createLiveVexcel({ base: `http://localhost:${firstPort}/v2/`, key: "test-key", massing, warn: () => {} });
      await expect(adapter.getAerial("F1")).rejects.toThrow("redirects are refused");
      expect(seen).toEqual([]);
    } finally {
      await new Promise((done) => first.close(done));
      await new Promise((done) => other.close(done));
    }
  });

  it("stops reading an image with no declared length once it passes 8 MB, and cancels the download", async () => {
    const MB = 1024 * 1024;
    let pulled = 0;
    let cancelled = false;
    const head = png(960, 700);
    const ok = stub();
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.searchParams.get("product-type") !== "oblique-north") return ok.fetch(input, init);
      // 64 MB on offer, a megabyte at a time, with no content-length.
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (pulled === 64) return controller.close();
          controller.enqueue(pulled === 0 ? Uint8Array.from({ length: MB }, (_, i) => head[i] ?? 0) : new Uint8Array(MB));
          pulled += 1;
        },
        cancel() {
          cancelled = true;
        },
      });
      return new Response(body, { headers: { "content-type": "image/png" } });
    }) as typeof globalThis.fetch;
    const warn = vi.fn();
    const aerial = (await live(fetch, { warn }).getAerial("F1"))!;
    expect(aerial.views.map((v) => v.dir)).toEqual(["N", "E", "W", "ortho"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("over the limit"));
    expect(cancelled).toBe(true);
    // Read past the limit by at most the stream's read-ahead, never the whole 64 MB.
    expect(pulled).toBeLessThanOrEqual(MAX_IMAGE_BYTES / MB + 3);
  });

  it("ignores a malformed content-length and still holds the limit by counting", async () => {
    const ok = stub();
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const response = await ok.fetch(input, init);
      if (!new URL(String(input)).pathname.endsWith("ortho/extract")) return response;
      return new Response(await response.arrayBuffer(), { headers: { "content-type": "image/jpeg", "content-length": "abc" } });
    }) as typeof globalThis.fetch;
    expect((await live(fetch).getAerial("F1"))!.views.map((v) => v.dir)).toContain("ortho");
  });

  it("refuses an image that declares more than 8 MB", async () => {
    const warn = vi.fn();
    const aerial = (await live(stub({ oversize: ["oblique-north"] }).fetch, { warn }).getAerial("F1"))!;
    expect(aerial.views.map((v) => v.dir)).toEqual(["N", "E", "W", "ortho"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("S view of F1 skipped"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("over the limit"));
  });

  it("answers null for a building with no massing, without calling Vexcel", async () => {
    const { fetch, calls } = stub();
    const adapter = live(fetch);
    expect(await adapter.getAerial("nowhere")).toBeNull();
    expect(await adapter.getImage("nowhere", "N")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("serves each view's image from memory, fetching the building once however many ask", async () => {
    const { fetch, mock } = stub();
    const adapter = live(fetch);
    const [a, b] = await Promise.all([adapter.getAerial("F1"), adapter.getAerial("F1")]);
    expect(a).toEqual(b);
    const image = (await adapter.getImage("F1", "ortho"))!;
    expect(image.contentType).toBe("image/jpeg");
    expect(imageSize(new Uint8Array(image.bytes))).toMatchObject({ width: 1600, height: 1000 });
    expect((await adapter.getImage("F1", "N"))!.contentType).toBe("image/png");
    expect(mock).toHaveBeenCalledTimes(6);
  });

  it("serves images only from memory: never a fetch, a miss is null", async () => {
    const { fetch, mock } = stub();
    const adapter = live(fetch);
    expect(await adapter.getImage("F1", "ortho")).toBeNull();
    expect(mock).not.toHaveBeenCalled();
  });

  it("keeps a building's images while its aerial is being asked for, and fetches again once it is stale", async () => {
    let clock = 0;
    const { fetch, mock } = stub();
    const adapter = live(fetch, { now: () => clock, cacheMs: 1_000 });
    await adapter.getAerial("F1");
    clock = 999;
    // Asking for the aerial again refreshes it, so the page's images outlive the first load.
    await adapter.getAerial("F1");
    clock = 1_500;
    expect(await adapter.getImage("F1", "ortho")).not.toBeNull();
    expect(mock).toHaveBeenCalledTimes(6);
    clock = 2_000;
    expect(await adapter.getImage("F1", "ortho")).toBeNull();
    await adapter.getAerial("F1");
    expect(mock).toHaveBeenCalledTimes(12);
  });

  it("hands out copies of the aerial, so a caller cannot change what is held", async () => {
    const adapter = live(stub().fetch);
    const first = (await adapter.getAerial("F1"))!;
    first.entries.length = 0;
    expect((await adapter.getAerial("F1"))!.entries.length).toBe(F1.entries.length);
  });
});
