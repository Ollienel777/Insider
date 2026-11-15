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
//
// Software WebGL draws few frames, and how few depends on the machine. The
// view moves the body and turns the view once a frame, by the time since the
// last one (at most 0.1 s), so neither a count of frames nor a wait in real
// time says how far a held key has gone. These tests never count frames:
// each key is held until the page shows the state it was held for (issue 147).
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
  // The first render places the level in the browser, which on a slow machine takes longer than an expect's 5 s.
  await expect(page.getByTestId("run-board")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("run-view")).toHaveAttribute("data-view", "board");
}

/**
 * Holds `key` down until `selector` matches, then lets go; false when it
 * already matched and nothing was held. The letting go happens in the page,
 * the moment the DOM shows the state: a MutationObserver dispatches the key's
 * keyup on `window`, where the view's own key handler takes it as it takes the
 * browser's. The DOM changes in the task after the frame that reached the
 * state, before the view's next frame, so the body or the view stops where the
 * state was reached however slowly frames come, with no round trip to the test
 * runner in between. The runner then lets go of the key too, which changes
 * nothing more.
 */
async function holdUntil(page: Page, keys: { key: string; code: string }, selector: string, timeout: number): Promise<boolean> {
  const already = await page.evaluate(
    ({ code, selector }) => {
      if (document.querySelector(selector)) return true;
      const watch = new MutationObserver(() => {
        if (!document.querySelector(selector)) return;
        watch.disconnect();
        window.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
      });
      watch.observe(document.body, { subtree: true, childList: true, attributes: true });
      return false;
    },
    { code: keys.code, selector },
  );
  if (already) return false;
  await page.keyboard.down(keys.key);
  await expect(page.locator(selector)).toHaveCount(1, { timeout });
  await page.keyboard.up(keys.key);
  return true;
}

test("first person runs in real time, and walking into the next node's area plays the engine's move", async ({ page }) => {
  // Its own waits add up past the default 30 s on a busy machine (the first render, software WebGL's
  // start, the walk), and it timed out there; the E test below has the same budget.
  test.setTimeout(90_000);
  await open(page, "F1");
  if (!(await firstPerson(page))) return;

  await expect(page.getByTestId("run-board")).toHaveCount(0);
  await expect(view(page)).toHaveAttribute("data-node", "fl-car");
  await expect(page.getByTestId("fp-hint")).toContainText("hold");
  // The clock runs on its own: turns pass while the player stands still, and they stay put.
  const start = await turnOf(page);
  await expect.poll(() => turnOf(page), { timeout: 10_000 }).toBeGreaterThan(start + 1);
  await expect(view(page)).toHaveAttribute("data-node", "fl-car");
  // No turn timer or play mode switch in first person; Details answers to I, since D strafes.
  await expect(page.getByTestId("turn-timer")).toHaveCount(0);
  await expect(page.getByTestId("details-toggle")).toHaveAttribute("aria-keyshortcuts", "I");

  // The lobby node is straight ahead: walking into its area is the move. W is let go the moment the
  // engine has the player there, so the walk ends in the lobby rather than through its far door.
  const before = await turnOf(page);
  await holdUntil(page, { key: "w", code: "KeyW" }, '[data-testid="fp-view"][data-node="fl-lobby"]', 30_000);
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
  await expect(page.getByTestId("run-view")).toHaveAttribute("data-view", "first-person", { timeout: 30_000 });
});

test("first person: holding E at a locked door picks it until the engine opens it", async ({ page }) => {
  // As above: the software WebGL's start, on a slow machine.
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

  // Paused the whole way to the door, so no turn passes and nothing on the floor moves meanwhile.
  await page.keyboard.press("p");
  await expect(page.getByTestId("fp-paused")).toBeVisible();
  const prompt = page.getByTestId("fp-prompt");

  // Turn until the view's line first meets the door (its prompt shows): the line is then within a frame's
  // turn of the door's edge. A drag of the view turns it on by a set angle, 0.004 rad a pixel whatever the
  // frame rate: 45 px, about 10 degrees, takes the line in off the edge. The door, with its frame, spans
  // about 30 degrees from here, and a frame turns the view at most 14 (0.1 s at 2.4 rad/s).
  if (await holdUntil(page, { key: "ArrowRight", code: "ArrowRight" }, '[data-testid="fp-prompt"]', 30_000)) {
    // Through the view's own drag-to-look handlers, as a mouse drag where the pointer is not locked.
    await page.evaluate((px) => {
      const surface = document.querySelector('[data-testid="fp-view"]')!;
      const at = (type: string, x: number) => surface.dispatchEvent(new PointerEvent(type, { button: 0, clientX: x, clientY: 0, pointerId: 1, bubbles: true }));
      at("pointerdown", 0);
      at("pointermove", px);
      at("pointerup", px);
    }, 45);
  }
  await expect(prompt).toHaveAttribute("data-kind", /far|pick/);

  // Walk along the line of view until the prompt says to pick, and stop there. Walking along the line
  // keeps it on the same point of the door, and the door's side of the room is all one node's area.
  await holdUntil(page, { key: "w", code: "KeyW" }, '[data-testid="fp-prompt"][data-kind="pick"]', 30_000);
  await expect(view(page), "the walk stays on the door's node").toHaveAttribute("data-node", "s1-sw");
  await expect(prompt).toContainText("Hold E to pick the lock");
  await expect(page.getByTestId("fp-paused")).toBeVisible();

  // Only now the clock runs again. Hold E: a pick a turn, then the door is open.
  await page.keyboard.press("p");
  await expect(page.getByTestId("fp-paused")).toHaveCount(0);
  await page.keyboard.down("e");
  await expect(prompt).toContainText("Picking");
  await expect(view(page)).not.toHaveAttribute("data-locked", /d-server/, { timeout: 30_000 });
  await page.keyboard.up("e");
  await expect(view(page)).toHaveAttribute("data-node", "s1-sw");
});
