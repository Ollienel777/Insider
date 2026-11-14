import { expect, test, type Page } from "@playwright/test";

// The Run screen (SPEC §2 beat 5, issue #18), on the production build in fake
// mode: F1's floor as the isometric board, played by number keys, W, Space
// and clicks, and the wow beat: stepping into C2's cover raises the alarm to
// Alert.

const board = (page: Page) => page.getByTestId("run-board");
const banner = (page: Page) => page.getByTestId("alarm-banner");
const player = (page: Page) => page.getByTestId("player-piece");
const choice = (page: Page, nodeId: string) => page.locator(`[data-testid="choice"][data-node="${nodeId}"]`);

async function open(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/b/F1/run");
  await expect(board(page)).toBeVisible();
}

/** Presses the number the board shows on the neighbour `nodeId`. */
async function pressFor(page: Page, nodeId: string) {
  const key = await choice(page, nodeId).getAttribute("data-key");
  expect(key, `${nodeId} is numbered`).toMatch(/^[1-9]$/);
  await page.keyboard.press(key!);
}

const guardNodes = (page: Page) =>
  page.getByTestId("guard-piece").evaluateAll((els) => els.map((el) => el.getAttribute("data-node")));

test("/b/F1/run renders F1's floor with 4 guards and its cameras, filling the board at readable size", async ({
  page,
}) => {
  await open(page);
  await expect(page.getByTestId("board-node")).toHaveCount(30);
  await expect(page.getByTestId("guard-piece")).toHaveCount(4);
  await expect(page.getByTestId("camera-piece")).toHaveCount(2);
  await expect(page.getByTestId("camera-piece")).toHaveText(["C1", "C2"]);
  await expect(player(page)).toHaveAttribute("data-node", "fl-car");

  const box = (await board(page).boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(0.65 * 1440);
  for (const id of ["player-piece", "guard-piece", "camera-piece"]) {
    for (const piece of await page.getByTestId(id).all()) {
      await expect(piece).toBeVisible();
      const b = (await piece.boundingBox())!;
      expect(b.width, id).toBeGreaterThanOrEqual(28);
      expect(b.height, id).toBeGreaterThanOrEqual(28);
      expect(b.x).toBeGreaterThanOrEqual(box.x);
      expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width);
    }
  }

  await expect(banner(page)).toHaveAttribute("data-state", "calm");
  await expect(page.getByTestId("objective")).toHaveText("Take the files from the records room");
  await expect(page.locator('[data-testid="plan"] li[data-state="next"]')).toHaveText(/Pick the records room door/);
  await expect(page.getByRole("link", { name: "See the debrief" })).toHaveCount(0);
});

test("pressing a neighbour's number moves the player, and then the guards", async ({ page }) => {
  await open(page);
  const before = await guardNodes(page);
  await expect(choice(page, "fl-lobby")).toHaveAttribute("data-key", "1");

  // The player's hop takes --t-base; the guards' hop takes --t-slow and waits for it.
  const timing = (el: Element) => {
    const s = getComputedStyle(el);
    return [s.transitionDuration, s.transitionDelay];
  };
  expect(await player(page).evaluate(timing)).toEqual(["0.2s", "0s"]);
  for (const guard of await page.getByTestId("guard-piece").all()) {
    expect(await guard.evaluate(timing)).toEqual(["0.3s", "0.2s"]);
  }

  await page.keyboard.press("1");
  await expect(player(page)).toHaveAttribute("data-node", "fl-lobby");
  await expect(page.getByTestId("turn")).toHaveText("1");
  expect(await guardNodes(page)).not.toEqual(before);
  await expect(page.getByTestId("run-status")).toHaveText("You move to the Freight Lift Lobby.");

  // W waits where you stand; the guards still move.
  const waited = await guardNodes(page);
  await page.keyboard.press("w");
  await expect(page.getByTestId("turn")).toHaveText("2");
  await expect(player(page)).toHaveAttribute("data-node", "fl-lobby");
  expect(await guardNodes(page)).not.toEqual(waited);

  // A click on a numbered neighbour moves there too.
  await choice(page, "fl-car").click();
  await expect(player(page)).toHaveAttribute("data-node", "fl-car");
  await expect(page.getByTestId("turn")).toHaveText("3");
});

test("the cones show the nodes each camera and guard covers this turn", async ({ page }) => {
  await open(page);
  await expect(page.locator('[data-testid="cone"]')).toHaveCount(6);
  for (const id of ["C1", "C2", "G1", "G2", "G3", "G4"]) {
    await expect(page.locator(`[data-testid="cone"][data-watcher="${id}"]`)).toHaveCount(1);
  }
  // C2 sweeps the two halves of its cover: dc-mid on turn 0, dc-west on turn 1.
  const c2 = page.locator('[data-testid="cone"][data-watcher="C2"]');
  await expect(c2).toHaveAttribute("data-nodes", "dc-mid");
  await expect(page.locator('[data-testid="board-node"][data-node="dc-mid"]')).toHaveAttribute("data-watched-by", /\bC2\b/);
  await page.keyboard.press("1");
  await expect(c2).toHaveAttribute("data-nodes", "dc-west");
  await expect(page.locator('[data-testid="board-node"][data-node="dc-west"]')).toHaveAttribute("data-watched-by", /\bC2\b/);
  await expect(page.locator('[data-testid="board-node"][data-node="dc-mid"]')).not.toHaveAttribute("data-watched-by", /\bC2\b/);
  // Each guard's cone starts where the guard stands.
  for (const guard of await page.getByTestId("guard-piece").all()) {
    const id = await guard.getAttribute("data-id");
    const node = await guard.getAttribute("data-node");
    await expect(page.locator(`[data-testid="board-node"][data-node="${node}"]`)).toHaveAttribute(
      "data-watched-by",
      new RegExp(`\\b${id}\\b`),
    );
  }
});

test("beat 5: stepping into C2's cover from the dock raises the alarm to Alert", async ({ page }) => {
  await open(page);
  const calmColour = await page.getByTestId("alarm-state").evaluate((el) => getComputedStyle(el).color);
  await expect(page.getByTestId("alarm-state")).toHaveText("Calm");

  // The scripted sequence: to the freight lift lobby, then straight into the dock corridor.
  await pressFor(page, "fl-lobby");
  await expect(banner(page)).toHaveAttribute("data-state", "calm");
  await expect(page.locator('[data-testid="cone"][data-watcher="C2"]')).toHaveAttribute("data-nodes", "dc-west");
  await pressFor(page, "dc-west");

  await expect(page.getByTestId("alarm-state")).toHaveText("Alert");
  await expect(banner(page)).toHaveAttribute("data-state", "alert");
  // In DESIGN.md's --danger (#ff5a5f), not the calm colour.
  await expect(page.getByTestId("alarm-state")).toHaveCSS("color", "rgb(255, 90, 95)");
  expect(calmColour).not.toBe("rgb(255, 90, 95)");
  await expect(page.getByTestId("run-status")).toHaveText("C2 saw you in the Dock Corridor. The guards are converging.");
  await expect(page.getByTestId("sighting")).toHaveCount(1);
  // The guards converge at once, with no Chief order: four orders, four routes.
  await expect(page.locator('[data-testid="guard-orders"] li[data-intent="converge"]')).toHaveCount(4);
  await expect(page.getByTestId("guard-route").first()).toBeVisible();
});

test("the crew's quiet route plays by keys to a clean exit, then offers the debrief", async ({ page }) => {
  await open(page);
  const pick = async () => {
    const key = await page.locator('[data-testid="choice"][data-kind="pick"]').getAttribute("data-key");
    await page.keyboard.press(key!);
  };
  await pressFor(page, "fl-lobby");
  await page.keyboard.press("w");
  for (const node of ["dc-west", "dc-mid", "dc-east"]) await pressFor(page, node);
  await expect(page.locator('[data-testid="choice"][data-kind="pick"]')).toContainText("PICK 0/2");
  await pick();
  await expect(page.locator('[data-testid="choice"][data-kind="pick"]')).toContainText("PICK 1/2");
  await pick();
  await expect(page.getByTestId("locked-door")).toHaveCount(1);
  await pressFor(page, "rr-door");
  await pressFor(page, "rr-files");
  await page.keyboard.press(" ");
  await expect(page.getByTestId("objective")).toContainText("Taken");
  await pressFor(page, "rr-door");
  await pressFor(page, "dc-east");
  await page.keyboard.press("w");
  for (const node of ["dc-mid", "dc-west", "fl-lobby", "fl-car"]) await pressFor(page, node);

  await expect(page.getByTestId("run-outcome")).toHaveAttribute("data-status", "won");
  await expect(banner(page)).toHaveAttribute("data-state", "calm");
  await expect(page.getByTestId("choice")).toHaveCount(0);
  const runLog = await page.evaluate(() => JSON.parse(localStorage.getItem("heist:run-log:F1") ?? "null"));
  expect(runLog.turns).toHaveLength(17);
  await page.getByRole("link", { name: "See the debrief" }).click();
  await expect(page).toHaveURL(/\/b\/F1\/debrief$/, { timeout: 15_000 });
});

test("Restart puts the run back at the start", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("button", { name: "Restart" })).toBeDisabled();
  await pressFor(page, "fl-lobby");
  await pressFor(page, "dc-west");
  await expect(banner(page)).toHaveAttribute("data-state", "alert");
  await page.getByRole("button", { name: "Restart" }).click();
  await expect(banner(page)).toHaveAttribute("data-state", "calm");
  await expect(page.getByTestId("turn")).toHaveText("0");
  await expect(player(page)).toHaveAttribute("data-node", "fl-car");
  // The number keys still play with the focus left on Restart.
  await page.keyboard.press("1");
  await expect(player(page)).toHaveAttribute("data-node", "fl-lobby");
});

test("a building with no level yet says so and offers the map", async ({ page }) => {
  await page.goto("/b/F2/run");
  await expect(page.getByTestId("board-empty")).toContainText("This building's level isn't ready yet.");
  await page.getByRole("link", { name: "Back to the map" }).click();
  await expect(page).toHaveURL(/\/$/);
});
