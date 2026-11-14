import { expect, test } from "@playwright/test";

// The first-person view (issue 115), on the production build in fake mode:
// the Run screen's Board / First person switch, and one move played by
// walking. F1's run starts in the freight lift facing the lobby node, so
// holding W walks straight onto it, and the engine's turn must advance by its
// own `move`: the same turn counter, status line and board the number keys
// drive.
//
// Headless Chromium draws WebGL in software (SwiftShader); the flag keeps
// that on where a newer Chromium would switch it off. Where no WebGL context
// can be made at all, the view falls back to the board with a one-line
// notice, and this test asserts that instead.
test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader"] } });

test("first person: walking onto the next node plays the engine's move", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/b/F1/run");
  await expect(page.getByTestId("run-board")).toBeVisible();
  await expect(page.getByTestId("turn")).toHaveText("0");

  // The board is the default view, and the switch says so.
  await expect(page.getByTestId("run-view")).toHaveAttribute("data-view", "board");
  await page.getByTestId("run-view-first-person").click();

  const view = page.locator('[data-testid="fp-view"][data-ready="true"]');
  const notice = page.getByTestId("run-status").filter({ hasText: "First person needs WebGL" });
  await expect(view.or(notice)).toBeVisible({ timeout: 30_000 });
  if (await notice.isVisible()) {
    // No WebGL in this browser: the board is back, and first person is not offered again.
    await expect(page.getByTestId("run-board")).toBeVisible();
    await expect(page.getByTestId("run-view-first-person")).toBeDisabled();
    return;
  }

  await expect(page.getByTestId("run-board")).toHaveCount(0);
  await expect(view).toHaveAttribute("data-node", "fl-car");
  await expect(page.getByTestId("fp-alarm")).toHaveAttribute("data-state", "calm");
  await expect(page.getByTestId("fp-hint")).toContainText("Click to look");

  // W walks (on the board it waits). The lobby node is straight ahead: reaching its ground is the move.
  await page.keyboard.down("w");
  await expect(page.getByTestId("turn")).toHaveText("1", { timeout: 15_000 });
  await page.keyboard.up("w");
  await expect(view).toHaveAttribute("data-node", "fl-lobby");
  await expect(page.getByTestId("run-status")).toHaveText("You move to the Freight Lift Lobby.");

  // F waits a turn, as W does on the board: the player stays put and the turn passes.
  await page.keyboard.press("f");
  await expect(page.getByTestId("turn")).toHaveText("2");
  await expect(view).toHaveAttribute("data-node", "fl-lobby");

  // The run log is the one the Debrief replays: the walk is a move like any other.
  const log = await page.evaluate(
    () => JSON.parse(localStorage.getItem("heist:run-log:F1:romaine-1974") ?? "null") as { turns: { player: { kind: string; nodeId: string } }[] },
  );
  expect(log.turns.map((t) => [t.player.kind, t.player.nodeId])).toEqual([
    ["move", "fl-lobby"],
    ["wait", "fl-lobby"],
  ]);

  // Back on the board, the same run: the piece stands where first person walked it.
  await page.getByTestId("run-view-board").click();
  await expect(page.getByTestId("run-board")).toBeVisible();
  await expect(page.getByTestId("player-piece")).toHaveAttribute("data-node", "fl-lobby");
  await expect(page.getByTestId("turn")).toHaveText("2");

  // The choice is remembered for the next visit.
  await page.getByTestId("run-view-first-person").click();
  await page.reload();
  await expect(page.getByTestId("run-view")).toHaveAttribute("data-view", "first-person", { timeout: 15_000 });
});
