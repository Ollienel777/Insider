import { expect, test, type Page } from "@playwright/test";

// The Chief adapts between runs (#35), on the production build in fake mode:
// a caught run of F1 leaves a record, the next visit starts G3 posted near the
// dock, and the Chief's first rationale says so; forgetting the history puts
// the guards back on their default rounds.

const choice = (page: Page, nodeId: string) => page.locator(`[data-testid="choice"][data-node="${nodeId}"]`);
const g3 = (page: Page) => page.locator('[data-testid="guard-piece"][data-id="G3"]');

async function open(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/b/F1/run");
  await expect(page.getByTestId("run-board")).toBeVisible();
  await expect(page.getByTestId("turn")).toHaveText("0");
}

async function pressFor(page: Page, nodeId: string) {
  const key = await choice(page, nodeId).getAttribute("data-key");
  expect(key, `${nodeId} is numbered`).toMatch(/^[1-9]$/);
  await page.keyboard.press(key!);
}

/** Beat 5's keys: through the freight lift lobby into C2's cover. */
async function trip(page: Page) {
  await pressFor(page, "fl-lobby");
  await pressFor(page, "dc-west");
  await expect(page.getByTestId("alarm-banner")).toHaveAttribute("data-state", "alert");
}

/** Waits out the alarm until the guards catch the player. */
async function caught(page: Page) {
  for (let i = 0; i < 12 && (await page.getByTestId("run-outcome").count()) === 0; i++) await page.keyboard.press("w");
  await expect(page.getByTestId("run-outcome")).toHaveAttribute("data-status", "caught");
}

test("a second run of F1 by the dock: G3 starts posted nearer it, the Chief says so, and Forget restores the default", async ({ page }) => {
  await open(page);
  await expect(page.getByTestId("forget-history")).toHaveCount(0);
  const defaultG3 = await g3(page).getAttribute("data-node");
  await trip(page);
  const rationale = page.getByTestId("chief-rationale");
  await expect(rationale).toHaveAttribute("data-done", "true", { timeout: 4_000 });
  await expect(rationale).not.toContainText("starts in the secure room");
  await caught(page);
  // The run that just ended counts at once, before any reload (R1-M1).
  await expect(page.getByTestId("forget-history")).toHaveText("Forget 1 earlier run");
  // Kept per building and mission, as the run log is: its zones belong to that level.
  const stored = await page.evaluate(() => [localStorage.getItem("heist:run-history:F1:romaine-1974"), localStorage.getItem("heist:run-history:F1")]);
  expect(stored[0]).not.toBeNull();
  expect(stored[1]).toBeNull();

  // The second run: G3 stands in the secure room off the dock corridor, one door from dc-west.
  await open(page);
  await expect(page.getByTestId("forget-history")).toHaveText("Forget 1 earlier run");
  const adaptedG3 = await g3(page).getAttribute("data-node");
  expect(adaptedG3).not.toBe(defaultG3);
  // Nearer the dock than any guard starts on a first run.
  expect(adaptedG3).toBe("sc-rack");

  // Mid-run, forgetting would throw the run away: it waits for the start or the end.
  await pressFor(page, "fl-lobby");
  await expect(page.getByTestId("forget-history")).toBeDisabled();
  await pressFor(page, "dc-west");
  await expect(page.getByTestId("alarm-banner")).toHaveAttribute("data-state", "alert");
  // C2 trips as on the first run, and G3 is out of the closet on them that turn: the adaptation, on the board.
  await expect(page.getByTestId("run-outcome")).toHaveAttribute("data-status", "caught");
  await expect(rationale).toHaveAttribute("data-done", "true", { timeout: 4_000 });
  await expect(rationale).toContainText("They used the loading dock before. G3 starts in the secure room off the dock corridor tonight.");
  await expect(page.getByTestId("forget-history")).toHaveText("Forget 2 earlier runs");
  await page.getByRole("button", { name: "Restart" }).click();
  await expect(page.getByTestId("turn")).toHaveText("0");
  await expect(g3(page)).toHaveAttribute("data-node", "sc-rack");

  // Forgetting the history places the level again in its default posture.
  await page.getByTestId("forget-history").click();
  await expect(page.getByTestId("forget-history")).toHaveCount(0);
  await expect(page.getByTestId("turn")).toHaveText("0");
  await expect(g3(page)).toHaveAttribute("data-node", defaultG3!);
});

test("Restart after a caught run places the guards from it, as a reload would, and Forget then restores the default", async ({ page }) => {
  await open(page);
  const defaultG3 = await g3(page).getAttribute("data-node");
  await trip(page);
  await caught(page);

  // No reload: Restart starts the second run from the history the first just joined.
  await page.getByRole("button", { name: "Restart" }).click();
  await expect(page.getByTestId("turn")).toHaveText("0");
  await expect(page.getByTestId("forget-history")).toHaveText("Forget 1 earlier run");
  await expect(g3(page)).toHaveAttribute("data-node", "sc-rack");

  // A Restart mid-run records nothing and keeps the board it was on.
  await pressFor(page, "fl-lobby");
  await page.getByRole("button", { name: "Restart" }).click();
  await expect(page.getByTestId("turn")).toHaveText("0");
  await expect(page.getByTestId("forget-history")).toHaveText("Forget 1 earlier run");
  await expect(g3(page)).toHaveAttribute("data-node", "sc-rack");

  await trip(page);
  await expect(page.getByTestId("run-outcome")).toHaveAttribute("data-status", "caught");
  const rationale = page.getByTestId("chief-rationale");
  await expect(rationale).toHaveAttribute("data-done", "true", { timeout: 4_000 });
  await expect(rationale).toContainText("They used the loading dock before. G3 starts in the secure room off the dock corridor tonight.");
  await expect(page.getByTestId("forget-history")).toHaveText("Forget 2 earlier runs");
  // Restart after this finished run re-places from both runs: G3 is still posted.
  await page.getByRole("button", { name: "Restart" }).click();
  await expect(page.getByTestId("turn")).toHaveText("0");
  await expect(g3(page)).toHaveAttribute("data-node", "sc-rack");

  // After Forget, the level is placed again on the default posture, and a Restart keeps it.
  await page.getByTestId("forget-history").click();
  await expect(page.getByTestId("forget-history")).toHaveCount(0);
  await expect(page.getByTestId("turn")).toHaveText("0");
  await expect(g3(page)).toHaveAttribute("data-node", defaultG3!);
  await trip(page);
  await page.getByRole("button", { name: "Restart" }).click();
  await expect(page.getByTestId("turn")).toHaveText("0");
  await expect(g3(page)).toHaveAttribute("data-node", defaultG3!);
});

test("the Plan board and the Debrief's replay stand the guards where the second run placed them", async ({ page }) => {
  await open(page);
  const defaultG3 = await g3(page).getAttribute("data-node");
  await trip(page);
  await caught(page);

  await open(page);
  const adaptedG3 = await g3(page).getAttribute("data-node");
  expect(adaptedG3).not.toBe(defaultG3);
  // The secure room off the dock corridor: nearer the dock than any guard starts on a first run.
  expect(adaptedG3).toBe("sc-rack");
  await trip(page);
  await caught(page);

  // The Debrief replays the board the run was played on, from its first frame.
  await page.goto("/b/F1/debrief");
  await expect(page.getByTestId("replay-board")).toBeVisible();
  await page.getByTestId("replay-slider").fill("0");
  await expect(page.getByTestId("replay-board")).toHaveAttribute("data-frame", "0");
  await expect(g3(page)).toHaveAttribute("data-node", adaptedG3!);

  // The crew plans on the board they will run.
  await page.goto("/b/F1/plan");
  await expect(page.getByTestId("plan-board")).toBeVisible();
  await expect(g3(page)).toHaveAttribute("data-node", adaptedG3!);
});
