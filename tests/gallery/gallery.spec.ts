import { expect, test, type Page } from "@playwright/test";

// The Devpost gallery (issue #14): the seven screens of SPEC §2, one 16:9 shot
// each at 1920×1080, walked the way the demo path walks them (romaine-1974 on
// F1), in fake mode. `npm run gallery` after `npm run build`; the shots go to
// hackathon/submission/media/. tests/smoke/demo-path.spec.ts asserts the path;
// this only waits for each screen's moment and takes it.

const DEMO_ORDER = "Go in through the dock, wait for the 2 am round to pass, take the records room.";

const shot = (page: Page, name: string) => page.screenshot({ path: `hackathon/submission/media/${name}.png` });

/** Presses the number the board shows on the neighbour `nodeId`, and waits for the turn it plays. */
async function moveTo(page: Page, nodeId: string) {
  const turn = Number(await page.getByTestId("turn").textContent());
  const key = await page.locator(`[data-testid="choice"][data-node="${nodeId}"]`).getAttribute("data-key");
  await page.keyboard.press(key!);
  await expect(page.getByTestId("turn")).toHaveText(String(turn + 1));
}

/** Waits for the board's hops and the page's fonts to settle, so no shot catches a piece mid-air. */
async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null)));
  });
}

test("the gallery: one shot per screen of the demo path", async ({ page }) => {
  test.setTimeout(120_000);

  // 1. Missions: the five mission cards.
  await page.goto("/");
  await expect(page.getByTestId("mission-card")).toHaveCount(5);
  await settle(page);
  await shot(page, "01-missions");
  await page.getByRole("link", { name: /The Romaine Street Papers/ }).click();

  // 2. Cast: the funnel narrowed to three finalists, F1 picked.
  await expect(page.getByTestId("finalists")).toHaveAttribute("data-shown", "true", { timeout: 20_000 });
  await page.getByRole("button", { name: /^Finalist 1 · F1 Halvorsen Tower/ }).click();
  await expect(page.getByTestId("finalist-card").first()).toHaveAttribute("data-selected", "true");
  await settle(page);
  await shot(page, "02-cast");
  await page.getByRole("link", { name: "Scout it" }).click();

  // 3. Scout: the aerial from the east, with its tagged entries.
  const canvas = page.getByTestId("aerial-canvas");
  await expect(canvas).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(canvas).toHaveAttribute("data-view", "E");
  await page.waitForTimeout(400); // the views cross-fade in 200 ms
  await settle(page);
  await shot(page, "03-scout");
  await page.getByRole("link", { name: "Plan the job" }).click();

  // 4. Dossier: the Level Builder's replay done, the Data → Level table filled.
  await expect(page.getByTestId("dossier")).toHaveAttribute("data-done", "true", { timeout: 20_000 });
  await page.getByTestId("dossier").evaluate((el) => el.scrollTo({ top: 0 }));
  await settle(page);
  await shot(page, "04-dossier");
  await page.getByRole("link", { name: "Brief the crew" }).click();

  // 5. Plan: the crew's numbered plan, its pushback and the C2 warning, drawn as a ghost path.
  await expect(page.getByTestId("plan-board")).toBeVisible();
  await page.getByTestId("crew-order").fill(DEMO_ORDER);
  await page.getByRole("button", { name: "Brief the crew" }).click();
  await expect(page.getByTestId("crew-step")).toHaveCount(4, { timeout: 5_000 });
  await expect(page.getByTestId("ghost-path")).toHaveCount(1);
  await settle(page);
  await shot(page, "05-plan");
  await page.getByRole("link", { name: "Start the run" }).click();

  // 6. Run: the wow beat. Into C2's cover, the alarm at Alert, the Chief's re-plan streamed in.
  await expect(page.getByTestId("run-board")).toBeVisible({ timeout: 15_000 });
  await moveTo(page, "fl-lobby");
  await settle(page);
  await moveTo(page, "dc-west");
  await expect(page.getByTestId("alarm-banner")).toHaveAttribute("data-state", "alert");
  await expect(page.getByTestId("chief-rationale")).toHaveAttribute("data-done", "true", { timeout: 6_000 });
  await settle(page);
  await shot(page, "06-run");

  // 7. Debrief: caught, graded, with the replay and the Chief's decisions.
  // Stay put (W) until the guards close in.
  for (let i = 0; i < 12 && (await page.getByTestId("run-outcome").count()) === 0; i++) {
    const turn = Number(await page.getByTestId("turn").textContent());
    await page.keyboard.press("w");
    await expect(page.getByTestId("turn")).toHaveText(String(turn + 1));
  }
  await expect(page.getByTestId("run-outcome")).toHaveAttribute("data-status", "caught", { timeout: 10_000 });
  await expect(page.getByTestId("chief-panel")).toHaveAttribute("data-late", "true", { timeout: 6_000 });
  await page.getByRole("link", { name: "See the debrief" }).click();
  await expect(page.getByTestId("debrief-grade")).toBeVisible({ timeout: 15_000 });
  await settle(page);
  await shot(page, "07-debrief");
});
