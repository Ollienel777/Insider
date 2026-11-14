import { expect, test } from "@playwright/test";

// The production build serves F1's cached level (SPEC §4.4): the manifest and
// the Level Builder's trace, for the Dossier's beat 3.
test("GET /api/levels/F1 returns the cached manifest and trace", async ({ request }) => {
  const response = await request.get("/api/levels/F1");
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    manifest: { buildingId: string; securityProfile: { era: string; guardCount: number }; mission: { id: string } };
    trace: { events: { kind: string; agent: string }[] };
  };
  expect(body.manifest.buildingId).toBe("F1");
  expect(body.manifest.securityProfile).toMatchObject({ era: "analog", guardCount: 4 });
  expect(body.manifest.mission.id).toBe("romaine-1974");
  expect(body.trace.events.some((e) => e.kind === "todo")).toBe(true);
  expect(body.trace.events.filter((e) => e.kind === "subagent").map((e) => e.agent)).toEqual([
    "data-analyst",
    "game-master",
  ]);

  expect((await request.get("/api/levels/F9")).status()).toBe(404);
});
