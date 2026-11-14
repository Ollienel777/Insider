// The aerial routes' failure branches, on a stand-in adapter: what fails is
// logged on the server, and the browser gets a fixed line, never the error.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VexcelAdapter } from "@/adapters/vexcel";
import { GET as getImage } from "./[dir]/route";
import { GET as getAerial } from "./route";

const adapter = vi.hoisted(() => ({ current: null as unknown as VexcelAdapter }));

vi.mock("@/adapters/vexcel", async (importActual) => ({
  noCoverageFallback: (await importActual<typeof import("@/adapters/vexcel")>()).noCoverageFallback,
  getVexcel: () => ({ adapter: adapter.current, mode: "live", reason: "Vexcel: live" }),
}));

const params = <T,>(value: T) => ({ params: Promise.resolve(value) });
const SECRET = 'entries.0.x: Invalid input: expected number, received string at "https://img.invalid/?key=abc"';

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logged = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/buildings/[id]/aerial when the adapter throws", () => {
  it("answers 502 with a fixed message and logs the cause on the server", async () => {
    adapter.current = {
      getAerial: async () => {
        throw new Error(SECRET);
      },
      getImage: async () => null,
    };
    const response = await getAerial(new Request("http://localhost/api/buildings/F1/aerial"), params({ id: "F1" }));
    expect(response.status).toBe(502);
    const body = (await response.json()) as { mode: string; error: string };
    expect(body).toEqual({ mode: "live", error: "The aerial service failed. Try again." });
    expect(JSON.stringify(body)).not.toContain("entries.0");
    expect(logged).toHaveBeenCalledOnce();
    expect(String(logged.mock.calls[0][1])).toContain(SECRET);
  });
});

describe("GET /api/buildings/[id]/aerial while Vexcel is live", () => {
  const massing = { views: [], entries: [], footprint: [], heightM: 10, source: "fixture" };
  const ask = () => getAerial(new Request("http://localhost/api/buildings/F1/aerial"), params({ id: "F1" }));

  it("carries a once-per-building no-scan fallback when the building came back as its massing", async () => {
    adapter.current = { getAerial: async () => massing as never, getImage: async () => null };
    const body = (await (await ask()).json()) as { mode: string; fallback?: { service: string; id: string; message: string } };
    expect(body.mode).toBe("live");
    expect(body.fallback).toEqual({
      service: "vexcel",
      id: "vexcel-no-scan-F1",
      message: "This building has no Vexcel scan, so the aerial is a fixture massing.",
    });
  });

  it("carries no fallback when the photos came back", async () => {
    adapter.current = { getAerial: async () => ({ ...massing, source: "vexcel" }) as never, getImage: async () => null };
    expect(await (await ask()).json()).not.toHaveProperty("fallback");
  });
});

describe("GET /api/buildings/[id]/aerial/[dir]", () => {
  const get = (dir: string) => getImage(new Request(`http://localhost/api/buildings/F1/aerial/${dir}`), params({ id: "F1", dir }));
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer;

  it("proxies the held image, uncacheable", async () => {
    const asked: string[] = [];
    adapter.current = {
      getAerial: async () => null,
      getImage: async (id, dir) => (asked.push(`${id}/${dir}`), { bytes, contentType: "image/jpeg" }),
    };
    const response = await get("ortho");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(bytes));
    expect(asked).toEqual(["F1/ortho"]);
  });

  it("answers 404 for a view with no image, and for a direction that is not a view", async () => {
    adapter.current = { getAerial: async () => null, getImage: async () => null };
    expect((await get("N")).status).toBe(404);
    expect((await get("up")).status).toBe(404);
  });

  it("answers 502 with a fixed message and logs the cause when the adapter throws", async () => {
    adapter.current = {
      getAerial: async () => null,
      getImage: async () => {
        throw new Error(SECRET);
      },
    };
    const response = await get("N");
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "The aerial image failed to load." });
    expect(String(logged.mock.calls[0][1])).toContain(SECRET);
  });
});
