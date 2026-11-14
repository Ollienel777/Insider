import { expect, test } from "@playwright/test";

// Beat 3 (SPEC §2, §6): the demo building's dossier replays the Level
// Builder's recorded run and fills in the data that made the level.

test("the dossier replays the trace and fills in 1974, Analog era and 4 guards", async ({ page }) => {
  await page.goto("/b/F1/dossier");
  await expect(page.getByTestId("trace-header")).toContainText(
    /^Recorded replay · .+ UTC · model turns: scripted \(builder-F1-romaine-1974\), no LLM ran$/,
  );
  await expect(page.getByText("Nothing on this screen calls a model.")).toBeVisible();

  // It starts under skeletons and fills as the replay plays.
  await expect(page.getByTestId("briefing")).toHaveAttribute("data-shown", "false");
  const table = page.getByTestId("data-to-level");
  const era = table.locator('[data-rule="era"]');
  await expect(era).toHaveAttribute("data-shown", "true", { timeout: 8_000 });
  await expect(era).toContainText("1974");
  await expect(era).toContainText("Analog era");
  await expect(table.locator('[data-rule="guards"]')).toContainText("4 guards");
  await expect(table.locator('[data-rule="staging"]')).toContainText("2202–2210");
  const dock = table.locator('[data-rule="dock"]');
  await expect(dock.locator("td").nth(1)).toHaveText("entries.kind");
  await expect(dock.locator("td").nth(2)).toHaveText("dock");
  await expect(dock).toContainText("Always offered as a way in and out");

  await expect(page.getByTestId("dossier")).toHaveAttribute("data-done", "true", { timeout: 8_000 });
  await expect(page.getByTestId("trace-todo").and(page.locator('[data-status="completed"]'))).toHaveCount(3);
  const briefing = page.getByTestId("briefing");
  await expect(briefing.getByRole("heading", { name: "The Romaine Street Papers" })).toBeVisible();
  await expect(briefing).toContainText("June 5, 1974");
  await expect(briefing.getByTestId("source-link")).toHaveAttribute("href", /cia\.gov/);
  await expect(briefing.getByTestId("disclaimer")).toHaveText(
    "Security shown is game fiction derived from building class and era.",
  );
  await expect(page.locator("body")).not.toContainText(/tenant/i);
});

test("Skip shows everything at once, and the skeletons held each block's height", async ({ page }) => {
  await page.goto("/b/F1/dossier");
  const table = page.getByTestId("data-to-level");
  const briefing = page.getByTestId("briefing");
  await expect(briefing).toHaveAttribute("data-shown", "false");
  const before = { table: await table.boundingBox(), briefing: await briefing.boundingBox() };

  // The replay clock is running (so the page has hydrated) and the briefing is still to come.
  await expect(page.getByTestId("trace-todo").first()).not.toHaveAttribute("data-status", "unseen");
  await expect(briefing).toHaveAttribute("data-shown", "false");
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(briefing).toHaveAttribute("data-shown", "true", { timeout: 500 });
  await expect(page.getByTestId("dossier")).toHaveAttribute("data-done", "true");
  await expect(page.locator('[data-testid="skeleton"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Replay" })).toBeVisible();

  const after = { table: await table.boundingBox(), briefing: await briefing.boundingBox() };
  expect(after.table?.height).toBe(before.table?.height);
  expect(after.briefing?.height).toBe(before.briefing?.height);
});

test("a trace row opens on its recorded input and output, by mouse and by keyboard (#79)", async ({ page }) => {
  await page.goto("/b/F1/dossier");
  await expect(page.getByTestId("trace-todo").first()).not.toHaveAttribute("data-status", "unseen");
  await page.getByRole("button", { name: "Skip" }).click();
  const steps = page.getByTestId("trace-step");
  await expect(steps.and(page.locator('[data-kind="subagent"]')).getByTestId("trace-subagent")).toHaveText([
    "data-analyst",
    "game-master",
  ]);
  await expect(page.getByTestId("trace-subagents")).toHaveText("Available: general-purpose · data-analyst · game-master");

  // By mouse: get_building opens on its arguments and the record it returned.
  const tool = steps.filter({ hasText: "get_building" }).getByTestId("trace-step-toggle");
  await expect(tool).toHaveAttribute("aria-expanded", "false");
  await tool.click();
  await expect(tool).toHaveAttribute("aria-expanded", "true");
  const detail = page.locator(`[id="${await tool.getAttribute("aria-controls")}"]`);
  await expect(detail).toContainText('"buildingId": "F1"');
  await expect(detail).toContainText('"name": "Halvorsen Tower"');
  await tool.click();
  await expect(tool).toHaveAttribute("aria-expanded", "false");
  await expect(detail).toHaveCount(0);

  // By keyboard: Enter opens the data-analyst task on its answer, Space closes it.
  const analyst = steps.filter({ hasText: "data-analyst" }).and(page.locator('[data-kind="subagent"]'));
  const task = analyst.getByTestId("trace-step-toggle");
  await task.focus();
  await page.keyboard.press("Enter");
  await expect(task).toHaveAttribute("aria-expanded", "true");
  await expect(analyst.getByTestId("trace-step-detail")).toContainText("Built 1974");
  await page.keyboard.press("Space");
  await expect(task).toHaveAttribute("aria-expanded", "false");
});

test("Replay starts again from the top, with the header and the CoStar record in view at 1440x900", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/b/F1/dossier");
  const column = page.getByTestId("dossier");
  // Played through, the column has scrolled down to the briefing.
  await expect(column).toHaveAttribute("data-done", "true", { timeout: 15_000 });
  await expect.poll(() => column.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Replay" }).click();
  await expect(column).toHaveAttribute("data-done", "false");
  await expect.poll(() => column.evaluate((el) => el.scrollTop)).toBe(0);
  await expect(column.getByRole("heading", { level: 1 })).toBeInViewport();
  await expect(page.getByTestId("costar-facts")).toBeInViewport();
});

test("Brief the crew goes to the plan", async ({ page }) => {
  await page.goto("/b/F1/dossier");
  await page.getByRole("link", { name: "Brief the crew" }).click();
  await expect(page).toHaveURL(/\/b\/F1\/plan\?m=romaine-1974$/);
});
