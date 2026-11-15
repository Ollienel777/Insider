import { expect, test, type Page } from "@playwright/test";

// The first-person view (issue 115), on the production build in fake mode.
// First person plays in real time: the turn clock runs whether or not the
// player acts, walking into a neighbouring node's area plays that move, and
// holding E at a locked door picks it a turn at a time until the engine opens
// it. Everything is checked against the engine's own state as the view
// exposes it (`data-node`, `data-turn`, `data-locked`) and the run log.
//
// Headless Chromium draws WebGL in software (SwiftShader); the flag keeps
// that on where a newer Chromium would switch it off. Where no WebGL context
// can be made at all, the view falls back to the board with a one-line
// notice, and the tests assert that instead.
test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader"] } });

const view = (page: Page) => page.locator('[data-testid="fp-view"][data-ready="true"]');
const turnOf = async (page: Page) => Number(await view(page).getAttribute("data-turn"));

/** Switches to first person. False when this browser has no WebGL, after checking the fallback. */
async function firstPerson(page: Page): Promise<boolean> {
  await page.getByTestId("run-view-first-person").click();
  const notice = page.getByTestId("run-status").filter({ hasText: "First person needs WebGL" });
  await expect(view(page).or(notice)).toBeVisible({ timeout: 30_000 });
  if (await notice.isVisible()) {
    test.info().annotations.push({ type: "fallback", description: "no WebGL here: only the fallback was checked" });
    await expect(page.getByTestId("run-board")).toBeVisible();
    await expect(page.getByTestId("run-view-first-person")).toBeDisabled();
    return false;
  }
  return true;
}

async function open(page: Page, building: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/b/${building}/run`);
  await expect(page.getByTestId("run-board")).toBeVisible();
  await expect(page.getByTestId("run-view")).toHaveAttribute("data-view", "board");
}

test("first person runs in real time, and walking into the next node's area plays the engine's move", async ({ page }) => {
  await open(page, "F1");
  if (!(await firstPerson(page))) return;

  await expect(page.getByTestId("run-board")).toHaveCount(0);
  await expect(view(page)).toHaveAttribute("data-node", "fl-car");
  await expect(page.getByTestId("fp-hint")).toContainText("hold");
  // The clock runs on its own: turns pass while the player stands still, and they stay put.
  const start = await turnOf(page);
  await expect.poll(() => turnOf(page), { timeout: 5_000 }).toBeGreaterThan(start + 1);
  await expect(view(page)).toHaveAttribute("data-node", "fl-car");
  // No turn timer or play mode switch in first person; Details answers to I, since D strafes.
  await expect(page.getByTestId("turn-timer")).toHaveCount(0);
  await expect(page.getByTestId("details-toggle")).toHaveAttribute("aria-keyshortcuts", "I");

  // The lobby node is straight ahead: walking into its area is the move.
  const before = await turnOf(page);
  await page.keyboard.down("w");
  await expect(view(page)).toHaveAttribute("data-node", "fl-lobby", { timeout: 10_000 });
  await page.keyboard.up("w");
  expect(await turnOf(page)).toBeGreaterThan(before);

  // The run log is the one the Debrief replays: the walk is a move among the clock's waits.
  const log = await page.evaluate(
    () => JSON.parse(localStorage.getItem("heist:run-log:F1:romaine-1974") ?? "null") as { turns: { player: { kind: string; nodeId: string } }[] },
  );
  const kinds = log.turns.map((t) => `${t.player.kind}:${t.player.nodeId}`);
  expect(kinds).toContain("move:fl-lobby");
  expect(kinds.filter((k) => !k.startsWith("wait:")).length).toBeGreaterThanOrEqual(1);

  // Back on the board, the same run, played turn by turn again: the piece stands where first person walked it.
  await page.getByTestId("run-view-board").click();
  await expect(page.getByTestId("run-board")).toBeVisible();
  await expect(page.getByTestId("player-piece")).toHaveAttribute("data-node", "fl-lobby");

  // The choice is remembered for the next visit.
  await page.getByTestId("run-view-first-person").click();
  await page.reload();
  await expect(page.getByTestId("run-view")).toHaveAttribute("data-view", "first-person", { timeout: 15_000 });
});

test("first person: holding E at a locked door picks it until the engine opens it", async ({ page }) => {
  // The turn and the walk up to the door go a tap at a time, each waiting on drawn frames, which on CI's
  // software WebGL takes longer than the default: the demo path's 90 s.
  test.setTimeout(90_000);
  await open(page, "F3");
  // On the board, to the suite's south-west corner beside the server room's locked door.
  for (const nodeId of ["sl-door", "s1-nw", "s1-sw"]) {
    const key = await page.locator(`[data-testid="choice"][data-node="${nodeId}"]`).getAttribute("data-key");
    expect(key, `${nodeId} is numbered`).toMatch(/^[1-9]$/);
    await page.keyboard.press(key!);
    await expect(page.getByTestId("player-piece")).toHaveAttribute("data-node", nodeId);
  }
  if (!(await firstPerson(page))) return;
  await expect(view(page)).toHaveAttribute("data-node", "s1-sw");
  await expect(view(page)).toHaveAttribute("data-locked", /d-server/);

  // Paused the whole way to the door, so no turn passes and nothing on the floor moves meanwhile: turn
  // until the view's line is on the door, then step up to it in short taps of W, reading the
  // prompt after each. The view moves the body however few frames a slow machine draws, so a key held
  // down could carry it past the door's reach, or slide it along the wall off the door; a tap at a time
  // stops it where the prompt first says to pick. Walking along the line of view keeps that line on the
  // same point of the door, and the door's side of the room is all one node's area.
  await page.keyboard.press("p");
  await expect(page.getByTestId("fp-paused")).toBeVisible();
  const prompt = page.getByTestId("fp-prompt");
  // The view reads the keys once a frame: a tap is held for at least one drawn frame, however slow they come.
  const frames = (n: number) =>
    page.evaluate((count) => new Promise<void>((done) => {
      const next = (left: number) => (left === 0 ? done() : requestAnimationFrame(() => next(left - 1)));
      next(count);
    }), n);
  const tap = async (key: string, settle: number) => {
    await page.keyboard.down(key);
    await Promise.all([frames(1), page.waitForTimeout(50)]);
    await page.keyboard.up(key);
    await frames(settle);
  };
  // A turn stops the moment the key is up: a frame for the HUD to catch up is enough.
  for (let i = 0; i < 200 && !(await prompt.isVisible()); i++) await tap("ArrowRight", 1);
  await expect(prompt).toHaveAttribute("data-kind", /far|pick/);
  for (let i = 0; i < 40 && (await prompt.getAttribute("data-kind")) === "far"; i++) {
    // A step: long enough after for the body to stop (a frame or two even on a slow machine) and the HUD to catch up.
    await tap("w", 3);
    await expect(view(page), "the step stays on the door's node").toHaveAttribute("data-node", "s1-sw");
  }
  await expect(prompt).toHaveAttribute("data-kind", "pick");
  await expect(prompt).toContainText("Hold E to pick the lock");
  await expect(page.getByTestId("fp-paused")).toBeVisible();

  // Only now the clock runs again. Hold E: a pick a turn, then the door is open.
  await page.keyboard.press("p");
  await expect(page.getByTestId("fp-paused")).toHaveCount(0);
  await page.keyboard.down("e");
  await expect(prompt).toContainText("Picking");
  await expect(view(page)).not.toHaveAttribute("data-locked", /d-server/, { timeout: 15_000 });
  await page.keyboard.up("e");
  await expect(view(page)).toHaveAttribute("data-node", "s1-sw");
});
