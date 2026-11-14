import { expect, test } from "@playwright/test";

// The wow beat's step 2 (DESIGN.md the hero screen): the player steps into
// C2's cone, and on the next frames the cone that saw them is `--danger` and
// the banner reads Alert in `--danger`, with no fade between.

test.use({ viewport: { width: 1440, height: 900 } });

test("the trip turns C2's cone and the banner --danger at once", async ({ page }) => {
  await page.goto("/b/F1/run");
  const board = page.getByTestId("run-board");
  await expect(board).toBeVisible();
  await expect(page.getByTestId("cone-tripped")).toHaveCount(0);
  for (const [node, turn] of [["fl-lobby", 1], ["dc-west", 2]] as const) {
    const key = await page.locator(`[data-testid="choice"][data-node="${node}"]`).getAttribute("data-key");
    await page.keyboard.press(key!);
    await expect(board).toHaveAttribute("data-turn", String(turn));
  }
  const danger = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--danger").trim());
  // The cone that tripped is C2's, and the whole wedge is in the alarm colour.
  const cone = page.locator('[data-testid="cone"][data-watcher="C2"] [data-testid="cone-tripped"]');
  await expect(cone).toHaveCount(1);
  // Read the colours in the same frame the turn landed in: nothing transitions to them.
  const colours = await page.evaluate(() => {
    const css = (el: Element | null, prop: string) => (el ? getComputedStyle(el).getPropertyValue(prop) : "");
    return {
      cone: css(document.querySelector('[data-testid="cone-tripped"]'), "fill"),
      banner: css(document.querySelector('[data-testid="alarm-state"]'), "color"),
      transition: css(document.querySelector('[data-testid="alarm-state"]'), "transition-duration"),
    };
  });
  const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
  expect(colours.cone).toBe(rgb(danger));
  expect(colours.banner).toBe(rgb(danger));
  expect(colours.transition).toBe("0s");
  await expect(page.getByTestId("alarm-state")).toHaveText("Alert");
});
