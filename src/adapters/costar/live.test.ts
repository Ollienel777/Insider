// The live adapter on a stubbed fetch. The responses are hand-written in the
// shape mapping.ts assumes (Q1 is unanswered), not recorded from CoStar.
import { describe, expect, it } from "vitest";
import { CoStarNotConfiguredError, createLiveCoStar } from "./live";
import { REQUESTED_FIELDS, REQUESTED_SPACE_FIELDS } from "./mapping";

const BASE = "https://costar.invalid/api/";

const PROPERTY = {
  propertyId: 48213,
  propertyName: "Sample Plaza",
  city: "Los Angeles",
  submarket: "Downtown Los Angeles",
  latitude: "34.0489",
  longitude: -118.2551,
  yearBuilt: 1986,
  buildingClass: "a",
  numberOfStories: 34,
  rentableBuildingArea: 702318,
  typicalFloorSize: 21460,
};

const SPACES = {
  items: [
    { floor: "12", suite: "1210", availableSf: 3874 },
    { floor: 30, suite: 3005, availableSf: "2216" },
    { floor: "LL", suite: "LL02", availableSf: 1430 },
  ],
};

function stub(routes: Record<string, unknown>) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const body = routes[url.pathname];
    if (body === undefined) return new Response("{}", { status: 404 });
    if (typeof body === "number") return new Response("{}", { status: body });
    return Response.json(body);
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

const TENANT = /tenant|occupant|lessee|leaseholder|company/i;

describe("the live CoStar adapter (stubbed fetch, no key)", () => {
  it("refuses to start without a base and a key", () => {
    expect(() => createLiveCoStar({ key: "k" })).toThrow(CoStarNotConfiguredError);
    expect(() => createLiveCoStar({ base: BASE })).toThrow("COSTAR_API_KEY missing");
  });

  it("maps a property and its spaces onto Building, marked costar", async () => {
    const { fetch } = stub({
      "/api/properties": { items: [PROPERTY] },
      "/api/properties/48213/spaces": SPACES,
    });
    const costar = createLiveCoStar({ base: BASE, key: "test-key", fetch });
    expect(await costar.listBuildings("LA")).toEqual([
      {
        id: "48213",
        name: "Sample Plaza",
        city: "LA",
        neighbourhood: "Downtown Los Angeles",
        lat: 34.0489,
        lng: -118.2551,
        yearBuilt: 1986,
        buildingClass: "A",
        stories: 34,
        rbaSf: 702318,
        typicalFloorSf: 21460,
        availableSpace: [
          { floor: 12, suite: "1210", sf: 3874 },
          { floor: 30, suite: "3005", sf: 2216 },
        ],
        layers: { costar: true, vexcel: false, matterport: false },
        source: "costar",
      },
    ]);
  });

  it("requests only the listed fields, none of them a tenant field, with the key as a bearer token", async () => {
    const { fetch, calls } = stub({
      "/api/properties": [PROPERTY],
      "/api/properties/48213": { item: PROPERTY },
      "/api/properties/48213/spaces": SPACES,
    });
    const costar = createLiveCoStar({ base: BASE, key: "test-key", fetch });
    await costar.listBuildings("Houston");
    await costar.getBuilding("48213");
    await costar.getAvailableSpace("48213");

    expect(calls.length).toBe(5);
    for (const { url, init } of calls) {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
      const fields = url.searchParams.get("fields")?.split(",") ?? [];
      expect(fields.length).toBeGreaterThan(0);
      expect(fields.filter((f) => TENANT.test(f))).toEqual([]);
      expect([...REQUESTED_FIELDS, ...REQUESTED_SPACE_FIELDS]).toEqual(expect.arrayContaining(fields));
      expect(url.search).not.toMatch(TENANT);
    }
    const list = calls[0].url.searchParams;
    expect([list.get("city"), list.get("state")]).toEqual(["Houston", "TX"]);
    expect(calls.find((c) => c.url.pathname.endsWith("/spaces"))?.url.searchParams.get("status")).toBe("available");
  });

  it("returns null for an unknown id and names the status on any other failure", async () => {
    const { fetch } = stub({ "/api/properties": 503 });
    const costar = createLiveCoStar({ base: BASE, key: "test-key", fetch });
    expect(await costar.getBuilding("nope")).toBeNull();
    expect(await costar.getAvailableSpace("nope")).toBeNull();
    await expect(costar.listBuildings("LA")).rejects.toThrow("answered 503");
  });

  it("rejects a property in a city the game does not stage", async () => {
    const { fetch } = stub({ "/api/properties/7": { ...PROPERTY, propertyId: 7, city: "Dallas" } });
    const costar = createLiveCoStar({ base: BASE, key: "test-key", fetch });
    await expect(costar.getBuilding("7")).rejects.toThrow('city "Dallas"');
  });
});
