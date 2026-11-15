// The route against a stubbed Model API: no call leaves the test, and every
// id, key and link is made up.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const CDN = "https://cdn-2.matterport.com/models/aaaa/assets";
const MODEL = {
  assets: { meshes: [{ status: "available", format: "obj", resolution: "50k", url: `${CDN}/small.obj?t=sig` }] },
  panoLocations: [
    {
      id: "p1",
      position: { x: 0, y: 0, z: 1.4 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      anchor: { position: { x: 0, y: 0, z: 0 } },
      skyboxes: [
        {
          status: "available",
          resolution: "2k",
          children: [0, 1, 2, 3, 4, 5].map((i) => `${CDN}/pan/2k/~/sky${i}.jpg?t=sig`),
          validUntil: "2026-01-01T00:05:00Z",
        },
      ],
    },
  ],
};

// The tests keep writing options as a query string; the route takes them as a JSON body.
const get = (query: string) =>
  POST(
    new Request("http://localhost/api/scan-mesh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new URLSearchParams(query.replace(/^\?/, "")))),
    }),
  );

function live() {
  vi.stubEnv("NEXT_PUBLIC_MATTERPORT_MODE", "live");
  vi.stubEnv("MATTERPORT_API_KEY", "key-abc");
  vi.stubEnv("MATTERPORT_API_TOKEN", "token-xyz");
}

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  for (const name of ["HEIST_MODE", "NEXT_PUBLIC_MATTERPORT_MODE", "MATTERPORT_API_KEY", "MATTERPORT_API_TOKEN"]) {
    vi.stubEnv(name, "");
  }
  fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: { model: MODEL } }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/scan-mesh", () => {
  it.each(["", "?m=", "?m=abc", "?m=abc/def12", "?m=" + "a".repeat(21), "?m=abc%22%29%7Bx%7D"])(
    "answers 400 to a bad model id (%s) without calling anything",
    async (query) => {
      live();
      const response = await get(query);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("bad-model-id");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("answers 400 to an unknown option", async () => {
    live();
    expect((await get("?m=abcDEF12345&faces=8k")).status).toBe(400);
    expect((await get("?m=abcDEF12345&mesh=5m")).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 503 in fake mode, with a line for the page, and calls nothing", async () => {
    vi.stubEnv("MATTERPORT_API_KEY", "key-abc");
    vi.stubEnv("MATTERPORT_API_TOKEN", "token-xyz");
    const response = await get("?m=abcDEF12345");
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("fake-mode");
    expect(body.message).toMatch(/fixtures/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 503 without the key, and calls nothing", async () => {
    vi.stubEnv("NEXT_PUBLIC_MATTERPORT_MODE", "live");
    const response = await get("?m=abcDEF12345");
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("no-key");
    expect(body.message).toMatch(/key isn't set/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("relays the manifest, uncached, with one call and no key in it", async () => {
    live();
    const response = await get("?m=abcDEF12345");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(text).not.toMatch(/key-abc|token-xyz/);
    const body = JSON.parse(text);
    expect(body.mesh).toEqual({ url: `${CDN}/small.obj?t=sig`, resolution: "50k" });
    expect(body.panos).toHaveLength(1);
    expect(body.panos[0].position).toEqual([0, 1.4, 0]);
    expect(body.panos[0].faces).toHaveLength(6);
    expect(body.validUntil).toBe("2026-01-01T00:05:00Z");
    expect(body.detail).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("relays the Matterpak's link with its length, read from one byte", async () => {
    live();
    const pak = `${CDN}/bundles/pak.zip?t=sig`;
    const bundles = [{ name: "Matterpak", availability: "unlocked", assets: [{ format: "zip", status: "available", url: pak }] }];
    fetchMock.mockResolvedValueOnce(Response.json({ data: { model: { ...MODEL, bundles } } }));
    fetchMock.mockResolvedValueOnce(new Response("P", { status: 206, headers: { "content-range": "bytes 0-0/123456" } }));
    const body = await (await get("?m=abcDEF12345")).json();
    expect(body.detail).toEqual({ url: pak, bytes: 123456 });
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(pak);
    expect((init?.headers as Record<string, string>).Range).toBe("bytes=0-0");
    expect(init?.cache).toBe("no-store");
  });

  it("drops the Matterpak when its length can't be read", async () => {
    live();
    const bundles = [{ name: "Matterpak", availability: "unlocked", assets: [{ format: "zip", status: "available", url: `${CDN}/p.zip` }] }];
    fetchMock.mockResolvedValueOnce(Response.json({ data: { model: { ...MODEL, bundles } } }));
    fetchMock.mockResolvedValueOnce(new Response("no", { status: 403 }));
    expect((await (await get("?m=abcDEF12345")).json()).detail).toBeNull();
  });

  it("says a scan has no mesh by relaying none", async () => {
    live();
    fetchMock.mockResolvedValueOnce(Response.json({ data: { model: { ...MODEL, assets: { meshes: [] } } } }));
    const body = await (await get("?m=abcDEF12345")).json();
    expect(body.mesh).toBeNull();
    expect(body.panos).toHaveLength(1);
  });

  it("answers 404 when the API has no such scan", async () => {
    live();
    fetchMock.mockResolvedValueOnce(Response.json({ data: { model: null } }));
    const response = await get("?m=abcDEF12345");
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("no-model");
  });

  it("answers 502 with a fixed line when the API fails, and logs no link, id or key", async () => {
    live();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(new Response(`{"errors":[{"message":"${CDN}/x key-abc"}]}`, { status: 500 }));
    const response = await get("?m=abcDEF12345");
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toEqual({ error: "api-failed", message: "The Model API didn't answer. Try again." });
    const lines = logged.mock.calls.flat().map(String).join(" ");
    expect(lines).not.toMatch(/matterport\.com|key-abc|token-xyz|abcDEF12345/);
  });
});
