import { expect, test, type Page } from "@playwright/test";

// The Plan screen (SPEC §2 beat 4, issue #19), on the production build in
// fake mode: the demo order gets the crew's numbered plan within 3 s, a
// warning that names camera C2 and a turn, the ghost path on the board, and
// the recorded chip.

const DEMO_ORDER = "Go in through the dock, wait for the 2 am round to pass, take the records room";

async function open(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/b/F1/plan");
  await expect(page.getByTestId("plan-board")).toBeVisible();
}

test("beat 4: the demo order gets numbered steps, a C2 warning with its turn, and a ghost path", async ({ page }) => {
  await open(page);
  await expect(page.getByTestId("ghost-path")).toHaveCount(0);
  const order = page.getByTestId("crew-order");
  await expect(order).toHaveAttribute("placeholder", "Tell the crew how you want to play it");
  await order.fill(DEMO_ORDER);

  const started = Date.now();
  await page.getByRole("button", { name: "Brief the crew" }).click();
  await expect(page.getByTestId("crew-step").first()).toBeVisible({ timeout: 3_000 });
  expect(Date.now() - started).toBeLessThan(3_000);

  await expect(page.getByTestId("crew-step")).toHaveCount(4);
  await expect(page.getByTestId("recorded-chip")).toHaveText("Recorded");
  const warning = page.getByTestId("plan-warning");
  await expect(warning).toContainText(/Camera C2 sees you in the Dock Corridor on turn \d+/);
  await expect(warning).toHaveAttribute("data-by", "C2");
  await expect(page.getByTestId("crew-pushback")).toContainText("C2");
  await expect(page.getByTestId("advice-wait")).toHaveCount(2);
  await expect(page.locator('[data-testid="advice-wait"][data-outbound="true"]')).toContainText("On the way out");

  const ghost = page.getByTestId("ghost-path");
  await expect(ghost).toHaveCount(1);
  await expect(ghost).toHaveAttribute("stroke-opacity", "0.5");
  await expect(ghost).toHaveCSS("stroke", "rgb(242, 169, 59)");
  await expect(page.getByTestId("ghost-sighting")).toHaveCount(1);

  await page.getByRole("link", { name: "Start the run" }).click();
  await expect(page).toHaveURL(/\/b\/F1\/run\?m=romaine-1974$/, { timeout: 15_000 });
});

test("Enter sends the order, and a lobby plan's off-floor zones are dropped and noted", async ({ page }) => {
  await open(page);
  await page.getByTestId("crew-order").fill("Walk in through the lobby");
  await page.getByTestId("crew-order").press("Enter");
  await expect(page.getByTestId("dropped-steps")).toContainText('Dropped step 1: "lobby-S" is not a zone on this floor.');
  await expect(page.locator('[data-testid="crew-step"][data-dropped="true"]')).toHaveCount(2);
});

test("a building with no level yet says so", async ({ page }) => {
  await page.goto("/b/F2/plan");
  await expect(page.getByTestId("board-empty")).toContainText("This building's level isn't ready yet.");
});
