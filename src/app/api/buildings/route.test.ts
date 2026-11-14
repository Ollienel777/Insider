import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Building } from "@/domain";
import { GET } from "./route";

const get = (query: string) => GET(new Request(`http://localhost/api/buildings${query}`));

describe("GET /api/buildings", () => {
  beforeAll(() => {
    // Whatever the shell says, this file tests fake mode; the adapter reads
    // the environment on its first use, below.
    vi.stubEnv("HEIST_MODE", "fake");
    vi.stubEnv("COSTAR_MODE", "fake");
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("returns the three LA buildings for city=LA, from the fixtures", async () => {
    const response = await get("?city=LA");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { mode: string; buildings: Building[] };
    expect(body.mode).toBe("fake");
    expect(body.buildings.map((b) => [b.id, b.name])).toEqual([
      ["F1", "Halvorsen Tower"],
      ["F2", "Figueroa Exchange"],
      ["F3", "Meridian on Wilshire"],
    ]);
    expect(body.buildings.every((b) => b.source === "fixture")).toBe(true);
  });

  it("returns F4 and F5 for city=Houston, and all five with no city", async () => {
    const houston = (await (await get("?city=Houston")).json()) as { buildings: Building[] };
    expect(houston.buildings.map((b) => b.id)).toEqual(["F4", "F5"]);
    const all = (await (await get("")).json()) as { buildings: Building[] };
    expect(all.buildings.map((b) => b.id)).toEqual(["F1", "F2", "F3", "F4", "F5"]);
  });

  it("answers 400 for a city it does not know", async () => {
    const response = await get("?city=Dallas");
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain('unknown city "Dallas"');
  });
});
