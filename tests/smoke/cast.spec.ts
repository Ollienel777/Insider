import { expect, test } from "@playwright/test";

// The cast screen (SPEC §2 beat 2, #118), on the production build in fake
// mode: the Casting Director's recorded run for romaine-1974 replays in about
// eight seconds over the fixture inventory (61 properties).

const COUNTS = ["61", "32", "14", "11", "8", "5", "4", "3"];
const shown = '[data-testid="funnel-row"][data-shown="true"]';

test("the cast screen replays to three finalists, F1 first, with the pins dimming as it goes", async ({ page }) => {
  // The replay itself takes about 8 s; Playwright's default 30 s holds it
  // with room, but a gate beside another on the 2-vCPU VM ran #82's walk out
  // of 30 s. Outcome waits below still fail on the beat that breaks.
  test.setTimeout(60_000);
  await page.goto("/m/romaine-1974/cast");
  await expect(page.getByTestId("finalists")).toHaveAttribute("data-shown", "false");
  await expect(page.getByTestId("skip")).toBeVisible();

  // Mid-replay: some rows have landed, not all, and some pins are already out.
  await expect(page.locator(shown)).not.toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator('[data-testid="cast-pin"][data-state="out"]')).not.toHaveCount(0);
  await expect(page.locator('[data-testid="cast-pin"][data-state="in"]')).not.toHaveCount(3);

  // The end, without Skip: the funnel 61 → 3, three cards, 29 of 32 LA pins out.
  await expect(page.getByTestId("finalists")).toHaveAttribute("data-shown", "true", { timeout: 15_000 });
  await expect(page.locator(shown)).toHaveCount(8);
  await expect(page.getByTestId("funnel-count")).toHaveText(COUNTS);
  await expect(page.getByTestId("funnel-left")).toHaveText("3 left");
  await expect(page.locator('[data-testid="cast-pin"][data-state="out"]')).toHaveCount(29);
  await expect(page.locator('[data-testid="cast-pin"][data-state="in"]')).toHaveCount(3);
  const cards = page.getByTestId("finalist-card");
  await expect(cards).toHaveCount(3);
  await expect(cards.first()).toHaveAttribute("data-building", "F1");
  await expect(cards.first()).toContainText("Halvorsen Tower");
  await expect(cards.first()).toContainText("Floor 22 · 23,341 SF suites 2202–2210");
  await expect(cards.first().locator("[data-layer]")).toHaveCount(3);
  await expect(cards.first().getByTestId("finalist-reason")).toContainText("1974 tower");
  await expect(cards.first()).toContainText("Casting Director · scripted");
  await expect(page.getByTestId("trace-header")).toContainText("ScriptedChatModel");
  await expect(page.getByTestId("replay-notice")).toHaveText("A replay of a run recorded on fixtures. Nothing on this screen calls a model.");
  await expect(page.getByTestId("replay")).toBeVisible();
});

test("Skip shows the final state at once, and Replay starts again", async ({ page }) => {
  await page.goto("/m/romaine-1974/cast");
  await page.getByTestId("skip").click();
  await expect(page.locator(shown)).toHaveCount(8);
  await expect(page.getByTestId("finalist-card")).toHaveCount(3);
  await expect(page.getByTestId("finalists")).toHaveAttribute("data-shown", "true");
  await expect(page.locator('[data-testid="cast-pin"][data-state="out"]')).toHaveCount(29);

  await page.getByTestId("replay").click();
  await expect(page.getByTestId("finalists")).toHaveAttribute("data-shown", "false");
  await expect(page.locator(shown)).not.toHaveCount(8);
  await expect(page.getByTestId("skip")).toBeVisible();
});

test("under reduced motion the cast screen starts at its end", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/m/romaine-1974/cast");
  await expect(page.getByTestId("finalists")).toHaveAttribute("data-shown", "true");
  await expect(page.locator(shown)).toHaveCount(8);
});

test("picking F1 and Scout it opens its scout with the mission", async ({ page }) => {
  await page.goto("/m/romaine-1974/cast");
  await page.getByTestId("skip").click();
  await expect(page.getByRole("button", { name: "Scout it" })).toBeDisabled();
  await page.getByRole("button", { name: /^Halvorsen Tower, finalist 1/ }).click();
  await expect(page.locator('[data-testid="finalist-card"][data-building="F1"]')).toHaveAttribute("data-selected", "true");
  await expect(page.locator('[data-testid="cast-pin"][data-building="F1"]')).toHaveAttribute("data-selected", "true");
  await page.getByRole("link", { name: "Scout it" }).click();
  await expect(page).toHaveURL(/\/b\/F1\/scout\?m=romaine-1974$/);
  await expect(page.getByTestId("building-slot")).toHaveText("Halvorsen Tower · Los Angeles");
});

test("a finalist with no level shows Level in prep when picked, and cannot be scouted", async ({ page }) => {
  await page.goto("/m/romaine-1974/cast");
  await page.getByTestId("skip").click();
  await page.getByRole("button", { name: "Lancaster Building, finalist 2, level in prep" }).click();
  await expect(page.getByTestId("selection")).toContainText("Level in prep");
  await expect(page.getByRole("button", { name: "Scout it" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Scout it" })).toHaveCount(0);
});

test("a city tab on the cast screen keeps the address on the cast route", async ({ page }) => {
  await page.goto("/m/romaine-1974/cast");
  await page.getByTestId("skip").click();
  await page.getByRole("tab", { name: /Houston/ }).click();
  await expect(page).toHaveURL(/\/m\/romaine-1974\/cast\?city=Houston$/);
  await expect(page.getByRole("tab", { name: /Houston/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-testid="cast-pin"][data-state="in"]')).toHaveCount(0);
  await page.getByRole("tab", { name: /Los Angeles/ }).click();
  await expect(page).toHaveURL(/\/m\/romaine-1974\/cast$/);
  await expect(page.locator('[data-testid="cast-pin"][data-state="in"]')).toHaveCount(3);
});

test("an unknown mission shows the error state with a way back", async ({ page }) => {
  await page.goto("/m/no-such-mission/cast");
  const error = page.getByTestId("cast-unavailable");
  await expect(error).toHaveAttribute("data-reason", "unknown");
  await expect(error).toContainText("There is no mission called no-such-mission.");
  await page.getByRole("link", { name: "Pick a mission" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("mission-card")).toHaveCount(5);
});
