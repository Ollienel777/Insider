import { expect, test, type Page } from "@playwright/test";

// Fullscreen on the Run screen's board (issue 212), on the production build in
// fake mode. Fullscreen shows the stage alone, so it is offered only where the
// stage carries the alarm and the clock itself (Live; first person has its own
// test in first-person.spec.ts), and it never leaves the side panel, the
// toasts or the demo settings open behind it.

const button = (page: Page) => page.getByTestId("fullscreen-toggle");
const details = (page: Page) => page.getByTestId("details-toggle");
const fullscreen = (page: Page) => page.evaluate(() => document.fullscreenElement?.hasAttribute("data-fullscreen-root") ?? false);
/** Whether the toasts' live region is inside the stage: only what is inside the fullscreen element shows. */
const toastsInStage = (page: Page) => page.evaluate(() => Boolean(document.querySelector('[data-testid="toasts"]')?.closest("[data-fullscreen-root]")));

async function open(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/b/F1/run");
  await expect(page.getByTestId("run-board")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("play-mode")).toHaveAttribute("data-mode", "tactical");
}

/** Switches to Live and holds its clock, so no turn runs out under the test. */
async function goLive(page: Page) {
  await page.getByTestId("play-mode-live").click();
  await expect(page.getByTestId("play-hud")).toBeVisible();
  await page.keyboard.press("p");
}

test("Tactical has no Fullscreen: its alarm and its Chief are in the side panel, which fullscreen leaves behind", async ({ page }) => {
  await open(page);
  await expect(button(page)).toHaveCount(0);
  await page.keyboard.press("f");
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
});

test("Live: Fullscreen takes the stage and the toasts with it, and Details, Tactical and the demo settings each bring the page back", async ({ page }) => {
  await open(page);
  await goLive(page);
  await expect(button(page)).toHaveAttribute("aria-pressed", "false");
  expect(await toastsInStage(page)).toBe(false);

  await button(page).click();
  await expect(button(page)).toHaveAttribute("aria-pressed", "true");
  expect(await fullscreen(page)).toBe(true);
  expect(await page.evaluate(() => Boolean(document.fullscreenElement?.querySelector('[data-testid="play-hud"]')))).toBe(true);
  // A fallback toast would show: its region has moved into the stage.
  await expect.poll(() => toastsInStage(page)).toBe(true);

  // Details opens the side panel, which is outside the stage: the page leaves fullscreen to show it.
  await page.keyboard.press("d");
  await expect(button(page)).toHaveAttribute("aria-pressed", "false");
  await expect(details(page)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => toastsInStage(page)).toBe(false);

  // Going fullscreen over an open panel closes it, so nothing is left open behind the stage.
  await page.keyboard.press("f");
  await expect(button(page)).toHaveAttribute("aria-pressed", "true");
  await expect(details(page)).toHaveAttribute("aria-pressed", "false");
  expect(await fullscreen(page)).toBe(true);

  // The demo settings open under the mode chip, outside the stage.
  await page.keyboard.press("Shift+?");
  await expect(button(page)).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("demo-settings-status-costar")).toBeVisible();
  await page.keyboard.press("Shift+?");

  // Tactical's panel is always open: switching to it leaves fullscreen, and the button goes.
  await page.keyboard.press("f");
  await expect(button(page)).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("play-mode-tactical").click();
  await expect(button(page)).toHaveCount(0);
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
});
