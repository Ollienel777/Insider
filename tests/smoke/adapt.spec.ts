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

test("a second run of F1 by the dock: G3 starts posted nearer it, the Chief says so, and Forget restores the default", async ({ page }) => {
  await open(page);
  await expect(page.getByTestId("forget-history")).toHaveCount(0);
  const defaultG3 = await g3(page).getAttribute("data-node");
  await trip(page);
  const rationale = page.getByTestId("chief-rationale");
  await expect(rationale).toHaveAttribute("data-done", "true", { timeout: 4_000 });
  await expect(rationale).not.toContainText("starts there tonight");
  for (let i = 0; i < 12 && (await page.getByTestId("run-outcome").count()) === 0; i++) await page.keyboard.press("w");
  await expect(page.getByTestId("run-outcome")).toHaveAttribute("data-status", "caught");

  // The second run: G3 stands elsewhere, and the first rationale names the dock and G3.
  await open(page);
  await expect(page.getByTestId("forget-history")).toHaveText("Forget 1 earlier run");
  const adaptedG3 = await g3(page).getAttribute("data-node");
  expect(adaptedG3).not.toBe(defaultG3);
  await trip(page);
  await expect(rationale).toHaveAttribute("data-done", "true", { timeout: 4_000 });
  await expect(rationale).toContainText("They used the loading dock before. G3 starts there tonight.");

  // Forgetting the history places the level again in its default posture.
  await page.getByTestId("forget-history").click();
  await expect(page.getByTestId("forget-history")).toHaveCount(0);
  await expect(page.getByTestId("turn")).toHaveText("0");
  await expect(g3(page)).toHaveAttribute("data-node", defaultG3!);
});
