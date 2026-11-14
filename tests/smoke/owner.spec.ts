import { expect, test, type Page } from "@playwright/test";

// The Owner screen (Owner Mode, SPEC §13, issue 128), on the production build
// in fake mode: from the Debrief into Owner Mode, the crew's 50 attempts on the
// untouched starting point, the Chief's recorded fix, and the rerun. On F1 the
// recorded strategies and fix give 17 of 50 out before and none after, the
// same on every run. Screenshots go to test-results/owner/.

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/owner/${name}.png` });

async function toDebrief(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/b/F1/run");
  await expect(page.getByTestId("run-board")).toBeVisible();
  // One move, so the Debrief has a run to replay.
  const key = await page.locator('[data-testid="choice"]').first().getAttribute("data-key");
  await page.keyboard.press(key!);
  await expect(page.getByTestId("run-board")).toHaveAttribute("data-turn", "1");
  await page.goto("/b/F1/debrief");
  await expect(page.getByTestId("replay-board")).toBeVisible();
}

test("Debrief to Owner Mode: 50 attempts, the Chief's fix, before and after", async ({ page }) => {
  await toDebrief(page);
  await page.getByTestId("debrief-owner-mode").click();
  await expect(page).toHaveURL(/\/b\/F1\/owner$/);

  // The editor opens on the generated setup, never empty, with the made-up line.
  await expect(page.getByTestId("owner-board")).toBeVisible();
  await expect(page.getByTestId("owner-made-up")).toHaveText(
    "Made-up setup on a fixture building. Real setups stay on this device.",
  );
  await expect(page.getByTestId("owner-setup")).toHaveAttribute("data-state", "untouched");
  await expect(page.getByTestId("owner-setup-counts")).toHaveText("4 guards · 2 cameras · 2 locked doors · 0 desks");
  await expect(page.getByTestId("owner-problems-none")).toBeVisible();
  await expect(page.getByTestId("owner-saved-empty")).toBeVisible();
  await shot(page, "setup");

  // Run 50 attempts: 17 of 50 got out, strategy by strategy.
  await page.getByTestId("owner-run").click();
  const count = page.getByTestId("owner-count");
  await expect(count).toHaveAttribute("data-escaped", "17");
  await expect(count).toHaveAttribute("data-total", "50");
  await expect(page.getByTestId("owner-strip").locator("[data-outcome]")).toHaveCount(50);
  await expect(page.getByTestId("owner-strip").locator('[data-outcome="escaped"]')).toHaveCount(17);
  await expect(page.getByTestId("owner-crew-recorded")).toBeVisible();
  const escapedBy = await page
    .getByTestId("owner-strategy")
    .evaluateAll((rows) => Object.fromEntries(rows.map((r) => [r.getAttribute("data-strategy"), Number(r.getAttribute("data-escaped"))])));
  expect(escapedBy).toEqual({ "dock-patient": 9, "dock-fast": 6, "dock-in-roof-out": 2, "suite-detour": 0, "roof-quiet": 0 });
  await expect(page.getByTestId("owner-route")).toHaveAttribute("data-count", "14");
  await expect(page.getByTestId("owner-detector")).toBeVisible();
  await expect(page.getByTestId("owner-detector-ring")).toBeVisible();
  await shot(page, "batch");

  // The Chief's recorded fix: C2 over the whole dock corridor.
  await page.getByTestId("owner-ask-fix").click();
  await expect(page.getByTestId("owner-fix")).toHaveText("C2 now covers the dock corridor");
  await expect(page.getByTestId("owner-fix-recorded")).toHaveText("Recorded");

  // Apply and rerun: 17 of 50 before, none after.
  await page.getByTestId("owner-apply").click();
  await expect(page.getByTestId("owner-before-count")).toHaveAttribute("data-escaped", "17");
  await expect(page.getByTestId("owner-after-count")).toHaveAttribute("data-escaped", "0");
  await expect(page.getByTestId("owner-after-count")).toHaveAttribute("data-total", "50");
  await expect(page.getByTestId("owner-changed")).toContainText("17 fewer got out");
  await page.getByTestId("owner-compare").scrollIntoViewIfNeeded();
  await shot(page, "before-after");

  // Save the fixed setup: it stays on this device and opens in the editor.
  await page.getByTestId("owner-save-fixed").click();
  await expect(page.getByTestId("owner-fixed-saved")).toContainText("Generated security, after the fix");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("heist:owner-setups:F1") ?? "[]"));
  expect(stored.map((s: { name: string }) => s.name)).toEqual(["Generated security, after the fix"]);
  await page.getByTestId("owner-open-fixed").click();
  await expect(page.getByTestId("owner-setup")).toHaveAttribute("data-state", "saved");
});

test("the editor names a broken round, and blocks the run until it is fixed", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/b/F1/owner");
  await expect(page.getByTestId("owner-board")).toBeVisible();

  // G1 walks the main corridor; draw it a round that jumps to a node it has no edge to.
  await page.locator('[data-owner-node="mc-w"]').click({ force: true });
  await expect(page.getByTestId("owner-inspector")).toHaveAttribute("data-selected", "guard:G1");
  await page.getByTestId("owner-draw-round").click();
  await page.locator('[data-owner-node="mc-4"]').click({ force: true });
  await expect(page.getByTestId("owner-setup")).toHaveAttribute("data-state", "error");
  await expect(page.getByTestId("owner-inline-problem").first()).toContainText("not a connected loop");
  await expect(page.getByTestId("owner-run")).toBeDisabled();
  await shot(page, "editor-error");

  // Take the node back off, and the guard stands its post: no problem left.
  await page.locator('[data-owner-node="mc-4"]').click({ force: true });
  await page.getByTestId("owner-round-done").click();
  await expect(page.getByTestId("owner-problems-none")).toBeVisible();
  await expect(page.getByTestId("owner-run")).toBeEnabled();
});
