import { expect, test, type Page } from "@playwright/test";

// The recorded kit path (#95): a CoStar kit building walked Scout → Dossier →
// Plan → Run → Debrief in fake mode, with no kit and no keys. The building is
// the fictional test kit's (src/adapters/costar/test-kit.ts, invented
// records read through the real kit mapping; the smoke server sets
// HEIST_TEST_KIT=1), and its level is the Level Builder's recorded run,
// fixtures/llm/scripts/builder-900101-romaine-1974.json, built through the
// same on-demand route a player's "Build this level" uses and kept in server
// memory. In fake mode Matterport has no scan to load, so the board is the
// stand-in floor, and every label says so instead of claiming a real scan.

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
  await expect(page.getByTestId("facts-only")).toHaveCount(0);
  await shot(page, "scout");
  await page.getByRole("link", { name: "Plan the job" }).click();

  // Dossier: the label, and a Data → Level table read from the kit record's own fields.
  await expect(page).toHaveURL(new RegExp(`/b/${KIT}/dossier\\?m=${MISSION}$`));
  await expect(page.getByTestId("record-label")).toHaveText(STAND_IN);
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

  // Plan: the board on the stand-in floor.
  await expect(page).toHaveURL(new RegExp(`/b/${KIT}/plan\\?m=${MISSION}$`));
  await expect(page.getByTestId("plan-board")).toBeVisible();
  await page.getByRole("link", { name: "Start the run" }).click();

  // Run: the label names the stand-in floor, never a scan; three guards from Class B.
  await expect(page).toHaveURL(new RegExp(`/b/${KIT}/run\\?m=${MISSION}$`), { timeout: 15_000 });
  await expect(page.getByTestId("run-board")).toBeVisible();
  const label = page.getByTestId("record-label");
  await expect(label).toHaveText(STAND_IN);
  await expect(label).not.toContainText(/scan/i);
  // Whole at the demo's width, not cut to "stand-in flo…".
  expect(await label.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect(page.getByTestId("guard-piece")).toHaveCount(3);

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
});
