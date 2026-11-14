import { expect, test, type Page } from "@playwright/test";

// The recorded kit path (#95): a CoStar kit building walked Scout → Dossier →
// Plan → Run → Debrief in fake mode, with no kit and no keys. The building is
// the fictional test kit's (src/adapters/costar/test-kit.ts, invented
// records read through the real kit mapping; the smoke server sets
// HEIST_TEST_KIT=1), and its level is the Level Builder's recorded run,
// fixtures/llm/scripts/builder-900101-romaine-1974.json, built through the
// same on-demand route a player's "Build this level" uses and kept in server
// memory. In fake mode Matterport has no scan to load, so the board is the
// stand-in floor: the Dossier names the record alone, and the Run says stand-in
// instead of claiming a real scan.

const KIT = "900101";
const MISSION = "romaine-1974";
const STAND_IN = "Real CoStar record · stand-in floor plan";

test.use({ viewport: { width: 1440, height: 900 } });

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/kit-path/${name}.png` });

/** Presses the number the board shows on the neighbour `nodeId`, and waits for the turn it plays. */
async function moveTo(page: Page, nodeId: string) {
  const turn = Number(await page.getByTestId("turn").textContent());
  const key = await page.locator(`[data-testid="choice"][data-node="${nodeId}"]`).getAttribute("data-key");
  expect(key, `${nodeId} is numbered`).toMatch(/^[1-9]$/);
  await page.keyboard.press(key!);
  await expect(page.getByTestId("turn")).toHaveText(String(turn + 1));
}

test("a kit building, Scout to Debrief, on its recorded build and the stand-in floor, labelled as such", async ({ page, request }) => {
  test.setTimeout(90_000);

  // Its level is built on the server from the recorded run, in memory only.
  const built = await request.post(`/api/levels/${KIT}/generate?m=${MISSION}`, { timeout: 60_000 });
  expect(built.status(), await built.text()).toBe(200);
  expect(await built.json()).toEqual({ built: true });

  // Scout: the kit building, no aerial (the kit has none), and the job to plan now its level exists.
  await page.goto(`/b/${KIT}/scout?m=${MISSION}`);
  await expect(page.getByTestId("building-slot")).toHaveText("Testwood Exchange · Los Angeles");
  // Kit data stored before #95 (a crew plan, run history and run log): no screen reads it, and the walk
  // removes it, which the storage scan at the end checks.
  await page.evaluate(
    ({ kit, mission }) => {
      const plan = { steps: [{ zoneId: "dock", action: "Wait at the dock" }], pushback: "", confidence: 0.8 };
      localStorage.setItem(`heist:crew-plan:${kit}:${mission}`, JSON.stringify({ plan, recorded: true }));
      localStorage.setItem(`heist:run-history:${kit}:${mission}`, JSON.stringify([{ outcome: "caught", entryZone: "dock-N", detectedZones: [], noise: 1 }]));
      localStorage.setItem(`heist:run-log:${kit}:${mission}`, "{}");
    },
    { kit: KIT, mission: MISSION },
  );
  await expect(page.getByTestId("facts-only")).toHaveCount(0);
  // No aerial; and no promise of a scan, which Scout can't know will load.
  await expect(page.getByTestId("aerial-missing")).toBeVisible();
  await expect(page.getByTestId("aerial-missing")).not.toContainText(/scan/i);
  await shot(page, "scout");
  await page.getByRole("link", { name: "Plan the job" }).click();

  // Dossier: the record label, which names no floor (only the Run knows it), and a Data → Level table read from the kit record's own fields.
  await expect(page).toHaveURL(new RegExp(`/b/${KIT}/dossier\\?m=${MISSION}$`));
  await expect(page.getByTestId("record-label")).toHaveText("Real CoStar record");
  await expect(page.getByTestId("record-label")).toBeInViewport();
  await shot(page, "dossier-top");
  await expect(page.getByTestId("dossier")).toHaveAttribute("data-done", "true", { timeout: 10_000 });
  const table = page.getByTestId("data-to-level");
  await expect(table.locator('[data-rule="era"]')).toContainText("1968");
  await expect(table.locator('[data-rule="era"]')).toContainText("Analog era");
  await expect(table.locator('[data-rule="guards"]')).toContainText("3 guards");
  await expect(page.getByTestId("briefing")).toContainText("Testwood Exchange");
  await shot(page, "dossier");
  await page.getByRole("link", { name: "Brief the crew" }).click();

  // Plan: the board on the stand-in floor, and the crew briefed from its recorded reply (fixtures/llm/crew-900101.json).
  await expect(page).toHaveURL(new RegExp(`/b/${KIT}/plan\\?m=${MISSION}$`));
  await expect(page.getByTestId("plan-board")).toBeVisible();
  await page.getByTestId("crew-order").fill("Down through the roof");
  await page.getByRole("button", { name: "Brief the crew" }).click();
  await expect(page.getByTestId("crew-step").first()).toBeVisible({ timeout: 5_000 });
  await page.getByRole("link", { name: "Start the run" }).click();

  // Run: the label names the stand-in floor, never a scan; three guards from Class B.
  await expect(page).toHaveURL(new RegExp(`/b/${KIT}/run\\?m=${MISSION}$`), { timeout: 15_000 });
  await expect(page.getByTestId("run-board")).toBeVisible();
  const label = page.getByTestId("record-label");
  await expect(label).toHaveText(STAND_IN);
  await expect(label).not.toContainText(/scan/i);
  // Whole at the demo's width, not cut to "stand-in flo…".
  expect(await label.evaluate((el) => [el, ...el.querySelectorAll("span")].every((e) => e.scrollWidth <= e.clientWidth))).toBe(true);
  await expect(page.getByTestId("guard-piece")).toHaveCount(3);
  // The crew's plan reached the Run from memory (#95), not from storage.
  await expect(page.getByTestId("plan")).toHaveAttribute("data-source", "crew");

  // The Why card cites the real record's field the guard came from.
  await page.locator('[data-why-target="guard:G3"]').click();
  const card = page.getByTestId("why-card");
  await expect(card).toBeVisible();
  await expect(card.locator('[data-testid="why-row"][data-role="guard:G3"]')).toHaveAttribute("data-field", "buildingClass");
  await expect(card.locator('[data-testid="why-row"][data-role="guard:G3"]')).toHaveAttribute("data-value", "B");
  await expect(card.getByTestId("why-record")).toHaveText("From its real CoStar record: buildingClass");
  await shot(page, "run-why-card");
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);

  // Into C1's corridor from the roof hatch, then wait for the guards.
  await moveTo(page, "mc-e");
  await expect(page.getByTestId("alarm-banner")).not.toHaveAttribute("data-state", "calm");
  for (let i = 0; i < 20 && (await page.getByTestId("run-outcome").count()) === 0; i++) {
    const turn = Number(await page.getByTestId("turn").textContent());
    await page.keyboard.press("w");
    await expect(page.getByTestId("turn")).toHaveText(String(turn + 1));
  }
  await expect(page.getByTestId("run-outcome")).toHaveAttribute("data-status", "caught");
  await page.getByRole("link", { name: "See the debrief" }).click();

  // Debrief: the replay and the grade.
  await expect(page).toHaveURL(new RegExp(`/b/${KIT}/debrief\\?m=${MISSION}$`), { timeout: 15_000 });
  await expect(page.getByTestId("replay-board")).toBeVisible();
  await expect(page.getByTestId("debrief-outcome")).toHaveAttribute("data-status", "caught");
  await expect(page.getByTestId("debrief-grade")).toBeVisible();
  await shot(page, "debrief");

  // Nothing derived from the kit record was stored on the way (#93, #95), and what was stored before is
  // gone: no run log, run history or crew plan, so no browser storage key or value names the building.
  // sessionStorage's `heist:seen-fallbacks` holds the toast ids already shown this session, and a toast id
  // may carry the bare building id (no record data; cleared with the session): each entry must be one.
  const stored = await page.evaluate(() =>
    (["localStorage", "sessionStorage"] as const).flatMap((area) => {
      const s = window[area];
      return Array.from({ length: s.length }, (_, i) => s.key(i)!).map((key) => ({ area, key, value: s.getItem(key) ?? "" }));
    }),
  );
  const seen = stored.find((e) => e.area === "sessionStorage" && e.key === "heist:seen-fallbacks");
  // The shapes `src/adapters/{matterport,vexcel}/index.ts` and `newFallback` (src/lib/fallback.ts) give.
  const toastId = /^(?:(?:matterport|vexcel)-no-scan|matterport-unplaceable)-[A-Za-z0-9]+$|^(?:llm|costar|vexcel|matterport)-[0-9a-z]+-\d+$/;
  for (const id of seen ? (JSON.parse(seen.value) as unknown[]) : []) expect(String(id)).toMatch(toastId);
  expect(stored.filter((e) => e !== seen).map((e) => `${e.area} ${e.key}=${e.value}`).filter((entry) => entry.includes(KIT))).toEqual([]);
});
