import { expect, test } from "@playwright/test";

// The production build serves the fixture buildings (SPEC §7) in fake mode.
test("GET /api/buildings?city=LA returns the three LA fixture buildings", async ({ request }) => {
  const response = await request.get("/api/buildings?city=LA");
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { mode: string; buildings: { id: string; source: string }[] };
  expect(body.mode).toBe("fake");
  expect(body.buildings.map((b) => b.id)).toEqual(["F1", "F2", "F3"]);
  expect(body.buildings.every((b) => b.source === "fixture")).toBe(true);
});
