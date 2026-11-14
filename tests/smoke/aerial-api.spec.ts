import { expect, test } from "@playwright/test";

// The production build serves F1's massing (SPEC §4.5) in fake mode.
test("GET /api/buildings/F1/aerial returns F1's massing with its tagged entries", async ({ request }) => {
  const response = await request.get("/api/buildings/F1/aerial");
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    mode: string;
    aerial: { source: string; footprint: unknown[]; heightM: number; entries: { id: string; note: string }[] };
  };
  expect(body.mode).toBe("fake");
  expect(body.aerial.source).toBe("fixture");
  expect(body.aerial.footprint.length).toBeGreaterThanOrEqual(3);
  expect(body.aerial.heightM).toBeGreaterThan(0);
  expect(body.aerial.entries.map((e) => e.id)).toEqual(["dock-N", "garage-E", "lobby-S", "exit-W", "roof"]);
  expect(body.aerial.entries.every((e) => e.note.length > 0)).toBe(true);

  expect((await request.get("/api/buildings/F9/aerial")).status()).toBe(404);
});
