import { expect, test, type Page } from "@playwright/test";

// The Drill screen (SPEC §2 beat 7, issue #24), on the production build in
// fake mode: F1's floor as an evacuation drill. The playback ends inside 10
// seconds with a time to clear; the blocked stair is struck through on the
// board and named in the panel, both read from the report; the recorded
// narrative streams in with its chip; the disclaimer shows.

const time = (page: Page) => page.getByTestId("drill-time");

async function open(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/b/F1/drill");
  await expect(page.getByTestId("drill-board")).toBeVisible();
}

test("/b/F1/drill plays the evacuation in under 10 seconds, then shows the time to clear in 3xl", async ({ page }) => {
  await open(page);
  const started = Date.now();
  await expect(time(page)).toHaveAttribute("data-phase", "playing");
  await expect(page.getByTestId("occupant").first()).toBeVisible();

  await expect(time(page)).toHaveAttribute("data-phase", "done", { timeout: 10_000 });
  expect(Date.now() - started).toBeLessThan(10_000);
  await expect(time(page)).toHaveAttribute("aria-label", /^\d[\d,]* s$/);
  await expect(page.getByText("Time to clear", { exact: true })).toBeVisible();
  const size = await time(page).evaluate((el) => getComputedStyle(el).fontSize);
  expect(size).toBe("48px");
  await expect(page.getByTestId("occupant")).toHaveCount(0);
  await expect(page.locator('[data-testid="zone-row"][data-cleared="false"]')).toHaveCount(0);
});

test("the blocked stair is struck through on the board and named in the report", async ({ page }) => {
  await open(page);
  const mark = page.getByTestId("blocked-stair");
  await expect(mark).toHaveCount(1);
  const label = await mark.getAttribute("data-label");
  expect(label).toBeTruthy();
  await expect(page.getByTestId("blocked-stair-name")).toHaveText(`${label} blocked`);
  await expect(page.getByTestId("scenario-rule")).toContainText(label!);
  await expect(mark).toContainText(label!.toUpperCase());
});

test("the narrative streams in after the playback, with the recorded chip", async ({ page }) => {
  await open(page);
  const narrative = page.getByTestId("drill-narrative");
  await expect(narrative.getByTestId("narrative-skeleton")).toBeVisible();
  await expect(narrative.getByTestId("recorded-chip")).toBeVisible();
  await expect(narrative.getByTestId("narrative-text")).toHaveAttribute("data-done", "false", { timeout: 12_000 });
  await expect(narrative.getByTestId("narrative-text")).toHaveAttribute("data-done", "true", { timeout: 10_000 });
  const label = await page.getByTestId("blocked-stair").getAttribute("data-label");
  await expect(narrative).toContainText(label!);
  await expect(narrative.locator("li")).toHaveCount(3);
});

test("the disclaimer shows, and the primary action waits for the printable plan", async ({ page }) => {
  await open(page);
  await expect(page.getByTestId("drill-disclaimer")).toBeVisible();
  await expect(page.getByTestId("drill-disclaimer")).toHaveText(
    "A planning aid, not a life-safety calculation. Headcount is estimated from CoStar's occupied area.",
  );
  const print = page.getByTestId("print-drill-plan");
  await expect(print).toBeVisible();
  await expect(print).toBeDisabled();
  await expect(print).toHaveAccessibleDescription(/isn't built yet/);
});

test("Skip to the result jumps to the time to clear, and Replay plays it again", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Skip to the result" }).click();
  await expect(time(page)).toHaveAttribute("data-phase", "done");
  await page.getByRole("button", { name: "Replay" }).click();
  await expect(time(page)).toHaveAttribute("data-phase", "playing");
});

test("under reduced motion the drill shows its result at once", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto("/b/F1/drill");
  await expect(time(page)).toHaveAttribute("data-phase", "done", { timeout: 5_000 });
  await expect(page.getByTestId("narrative-text")).toHaveAttribute("data-done", "true");
  await context.close();
});
