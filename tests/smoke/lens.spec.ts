import { expect, test, type Page } from "@playwright/test";

// The Layer lens (issue #33), on the production build in fake mode: `L` and
// the button toggle it on the Run and Plan boards, the legend's counts are the
// elements the board tints, and each element is drawn in its layers' colours.

const COLOUR = {
  costar: "rgb(122, 167, 255)",
  vexcel: "rgb(192, 140, 255)",
  matterport: "rgb(79, 209, 197)",
} as const;
type Layer = keyof typeof COLOUR;
const LAYERS = Object.keys(COLOUR) as Layer[];

const toggle = (page: Page) => page.getByTestId("lens-toggle");
const legend = (page: Page) => page.getByTestId("lens-legend");

async function open(page: Page, path: string, board: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(path);
  await expect(page.getByTestId(board)).toBeVisible();
  await expect(toggle(page)).toBeEnabled();
}

async function expectLens(page: Page, board: string, on: boolean) {
  await expect(toggle(page)).toHaveAttribute("aria-pressed", String(on));
  await expect(legend(page)).toHaveCount(on ? 1 : 0);
  if (!on) await expect(page.getByTestId(board).locator("[data-lens]")).toHaveCount(0);
}

test("on the Run board, L and the button toggle the lens, and its pressed state is exposed", async ({ page }) => {
  await open(page, "/b/F1/run", "run-board");
  await expectLens(page, "run-board", false);
  await expect(toggle(page)).toHaveAccessibleName(/Layer lens/);

  await page.keyboard.press("l");
  await expectLens(page, "run-board", true);
  await page.keyboard.press("Shift+L");
  await expectLens(page, "run-board", false);

  await toggle(page).click();
  await expectLens(page, "run-board", true);
  await toggle(page).click();
  await expectLens(page, "run-board", false);

  // L is not a game key: the run has not moved.
  await expect(page.getByTestId("run-board")).toHaveAttribute("data-turn", "0");
});

test("on the Plan board, L toggles the lens, but not while typing an order", async ({ page }) => {
  await open(page, "/b/F1/plan", "plan-board");
  await page.keyboard.press("L");
  await expectLens(page, "plan-board", true);

  const order = page.getByTestId("crew-order");
  await order.click();
  await order.pressSequentially("Leave by the roof, all clear");
  await expect(order).toHaveValue("Leave by the roof, all clear");
  await expectLens(page, "plan-board", true);

  await page.getByRole("heading", { level: 1 }).click();
  await page.keyboard.press("l");
  await expectLens(page, "plan-board", false);
});

test("the legend counts are the placed elements, each counted under every layer it carries", async ({ page }) => {
  await open(page, "/b/F1/run", "run-board");
  await page.keyboard.press("l");
  const board = page.getByTestId("run-board");

  // Every guard, cleaner, camera, locked door, entry and room on the board is tinted.
  await expect(board.getByTestId("cleaner-piece")).toHaveCount(1);
  const placed =
    (await board.getByTestId("guard-piece").count()) +
    (await board.getByTestId("cleaner-piece").count()) +
    (await board.getByTestId("camera-piece").count()) +
    (await board.getByTestId("locked-door").count()) +
    (await board.locator("[data-room]").count()) +
    (await board.locator('[data-testid="board-node"][data-lens^="entry:"]').count());
  const tinted = board.locator("[data-lens]");
  await expect(tinted).toHaveCount(placed);
  expect(placed).toBeGreaterThan(20);

  const rows = page.getByTestId("lens-legend-row");
  await expect(rows).toHaveCount(3);
  for (const layer of LAYERS) {
    const row = page.locator(`[data-testid="lens-legend-row"][data-layer="${layer}"]`);
    const carrying = await board.locator(`[data-lens-layers~="${layer}"]`).count();
    expect(carrying, layer).toBeGreaterThan(0);
    await expect(row).toHaveAttribute("data-count", String(carrying));
    await expect(row).toContainText(String(carrying));
  }

  // Matterport counts the rooms of the floor; F1 runs on the fixture floor, and says so.
  await expect(page.locator('[data-testid="lens-legend-row"][data-layer="matterport"]')).toHaveAttribute(
    "data-count",
    String(await board.locator("[data-room]").count()),
  );
  await expect(page.locator('[data-testid="lens-legend-row"][data-layer="matterport"]')).toContainText("fixture floor");
});

test("the elements carry their tints: the dock post both Vexcel and CoStar, a round guard CoStar, rooms Matterport", async ({
  page,
}) => {
  await open(page, "/b/F1/run", "run-board");
  await page.keyboard.press("l");
  const board = page.getByTestId("run-board");
  const strokes = (key: string) =>
    board
      .locator(`[data-lens="${key}"] [data-testid="lens-mark"]`)
      .evaluateAll((els) =>
        els.map((el) => [el.getAttribute("data-layer"), getComputedStyle(el.querySelector("rect")!).stroke]),
      );

  await expect(board.locator('[data-lens="guard:G4"]')).toHaveAttribute("data-lens-layers", "costar vexcel");
  expect(await strokes("guard:G4")).toEqual([
    ["costar", COLOUR.costar],
    ["vexcel", COLOUR.vexcel],
  ]);
  expect(await strokes("guard:G1")).toEqual([["costar", COLOUR.costar]]);
  expect(await strokes("camera:C2")).toEqual([["costar", COLOUR.costar]]);

  // Each mark's letter is in its layer's colour too, so the layer reads without the hue alone.
  const letters = await board
    .locator('[data-lens="guard:G4"] [data-testid="lens-mark"] text')
    .evaluateAll((els) => els.map((el) => [el.textContent, getComputedStyle(el).fill]));
  expect(letters).toEqual([
    ["C", COLOUR.costar],
    ["V", COLOUR.vexcel],
  ]);

  // Every entry carries Vexcel, and every tinted element has a mark, ring or room pattern per layer.
  const entries = board.locator('[data-lens^="entry:"]');
  expect(await entries.count()).toBeGreaterThan(0);
  for (const entry of await entries.all()) await expect(entry).toHaveAttribute("data-lens-layers", /vexcel/);

  const outlines = board.locator('[data-testid="lens-room"][data-layer="matterport"]');
  await expect(outlines).toHaveCount(await board.locator("[data-room]").count());
  await expect(outlines.first()).toHaveCSS("stroke", COLOUR.matterport);
  const hatched = board.locator('[data-testid="lens-room"][data-layer="costar"]');
  expect(await hatched.count()).toBeGreaterThan(0);
  expect(await hatched.first().evaluate((el) => getComputedStyle(el).fill)).toMatch(/^url\(/);
});
