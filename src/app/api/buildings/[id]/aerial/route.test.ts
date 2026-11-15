import { beforeAll, describe, expect, it, vi } from "vitest";
import { Aerial } from "@/domain";
import { GET } from "./route";

const get = (id: string) =>
  GET(new Request(`http://localhost/api/buildings/${id}/aerial`), { params: Promise.resolve({ id }) });

describe("GET /api/buildings/[id]/aerial", () => {
  beforeAll(() => {
    // Whatever the shell says, this file tests fake mode; the adapter reads
    // the environment on its first use, below.
    vi.stubEnv("HEIST_MODE", "fake");
    vi.stubEnv("VEXCEL_MODE", "fake");
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("returns F1's Aerial: a footprint, a height and at least four entries, each with a note", async () => {
    const response = await get("F1");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { mode: string; aerial: unknown };
    expect(body.mode).toBe("fake");
    const aerial = Aerial.parse(body.aerial);
    expect(aerial.source).toBe("fixture");
    expect(aerial.footprint.length).toBeGreaterThanOrEqual(3);
    expect(aerial.heightM).toBeGreaterThan(0);
    expect(aerial.entries.length).toBeGreaterThanOrEqual(4);
    for (const entry of aerial.entries) expect(entry.note.trim(), entry.id).not.toBe("");
  });

  it("serves no aerial for a kit building while CoStar is forced to fixtures, and still serves F1", async () => {
    const forcedGet = (id: string) =>
      GET(new Request(`http://localhost/api/buildings/${id}/aerial`, { headers: { cookie: "heist-fixtures=costar" } }), {
        params: Promise.resolve({ id }),
      });
    expect((await forcedGet("900001")).status).toBe(404);
    expect((await forcedGet("F1")).status).toBe(200);
  });

  it("answers 404 for a building it does not know", async () => {
    const response = await get("F9");
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toContain('"F9"');
  });
});
