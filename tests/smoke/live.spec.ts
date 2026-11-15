import { expect, test, type Page } from "@playwright/test";

// Live mode on the Run screen (issue 99), on the production build in fake
// mode: the Tactical / Live switch, and in Live the turn clock, which plays
// the turn the player lets run out. The page's timers are in the test's hand
// (Playwright's clock): once the board is up time stands still, and `tick`
// moves it, so a turn runs out on the millisecond the test says.

/** The turn's length (`LIVE_TURN_MS`, src/components/run/turn-clock.ts); the timer's bar is checked against it below. */
const LIVE_TURN_MS = 1100;
const RUN_LOG = "heist:run-log:F1:romaine-1974";
const PLAY_MODE = "heist:play-mode";

const board = (page: Page) => page.getByTestId("run-board");
const turn = (page: Page) => page.getByTestId("turn");
const player = (page: Page) => page.getByTestId("player-piece");
const modeSwitch = (page: Page) => page.getByTestId("play-mode");
const timer = (page: Page) => page.getByTestId("turn-timer");
const choice = (page: Page, nodeId: string) => page.locator(`[data-testid="choice"][data-node="${nodeId}"]`);
const tick = (page: Page, ms: number) => page.clock.runFor(ms);
const turnKinds = (page: Page) =>
  page.evaluate(
    (key) => (JSON.parse(localStorage.getItem(key) ?? "null")?.turns ?? []).map((t: { player: { kind: string } }) => t.player.kind),
    RUN_LOG,
  );

/** Opens F1's Run screen, in Tactical as every browser starts, and stops the page's clock. */
async function open(page: Page) {
  await page.clock.install();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/b/F1/run");
  await expect(board(page)).toBeVisible();
  await expect(modeSwitch(page)).toHaveAttribute("data-mode", "tactical");
  // A second ahead, so the timers the page set while loading have run; from here only `tick` moves time.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
}

/** Switches to Live: the clock starts with a whole turn. */
async function goLive(page: Page) {
  await page.getByTestId("play-mode-live").click();
  await expect(timer(page)).toHaveAttribute("data-state", "running");
}

/** Presses the number the board shows on the neighbour `nodeId`. */
async function pressFor(page: Page, nodeId: string) {
  const key = await choice(page, nodeId).getAttribute("data-key");
  expect(key, `${nodeId} is numbered`).toMatch(/^[1-9]$/);
  await page.keyboard.press(key!);
}

test("Tactical is the default: the switch shows, there is no timer, and nothing moves until the player does", async ({ page }) => {
  await open(page);
  await expect(page.getByTestId("play-mode-tactical")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("play-mode-live")).toHaveAttribute("aria-pressed", "false");
  await expect(timer(page)).toHaveCount(0);

  await tick(page, LIVE_TURN_MS * 5);
  await expect(turn(page)).toHaveText("0");
  // P is not a key in Tactical, and the keys that are still play.
  await page.keyboard.press("p");
  await expect(timer(page)).toHaveCount(0);
  await page.keyboard.press("1");
  await expect(turn(page)).toHaveText("1");
  await tick(page, LIVE_TURN_MS * 5);
  await expect(turn(page)).toHaveText("1");
  expect(await turnKinds(page)).toEqual(["move"]);
});

test("Live: with no input a wait passes every LIVE_TURN_MS, and the player's own turn starts the countdown over", async ({ page }) => {
  await open(page);
  await goLive(page);
  await expect(page.getByTestId("play-mode-live")).toHaveAttribute("aria-pressed", "true");

  await tick(page, LIVE_TURN_MS - 1);
  await expect(turn(page)).toHaveText("0");
  await tick(page, 1);
  await expect(turn(page)).toHaveText("1");
  await expect(page.getByTestId("run-status")).toHaveText("You wait in the Freight Lift Lobby.");
  await expect(player(page)).toHaveAttribute("data-node", "fl-car");
  await tick(page, LIVE_TURN_MS);
  await expect(turn(page)).toHaveText("2");

  // 600 ms into the third turn the player moves: the next one is a whole turn away again.
  await tick(page, 600);
  await pressFor(page, "fl-lobby");
  await expect(turn(page)).toHaveText("3");
  await expect(player(page)).toHaveAttribute("data-node", "fl-lobby");
  await tick(page, LIVE_TURN_MS - 1);
  await expect(turn(page)).toHaveText("3");
  await tick(page, 1);
  await expect(turn(page)).toHaveText("4");

  // The clock's turns are in the run log beside the player's, for the Debrief's replay.
  expect(await turnKinds(page)).toEqual(["wait", "wait", "move", "wait"]);
});

test("Live: P pauses and resumes with the time that was left, and is left alone while typing", async ({ page }) => {
  await open(page);
  await goLive(page);
  const pause = page.getByTestId("turn-pause");
  await expect(pause).toHaveAccessibleName("Pause the clock");

  await tick(page, 500);
  await page.keyboard.press("p");
  await expect(timer(page)).toHaveAttribute("data-state", "paused");
  await expect(page.getByTestId("turn-timer-state")).toHaveText("Paused");
  await expect(pause).toHaveAccessibleName("Resume the clock");
  await tick(page, LIVE_TURN_MS * 5);
  await expect(turn(page)).toHaveText("0");

  // Resumed, the turn has the 600 ms it had left, not a whole one.
  await page.keyboard.press("P");
  await expect(timer(page)).toHaveAttribute("data-state", "running");
  await tick(page, LIVE_TURN_MS - 500 - 1);
  await expect(turn(page)).toHaveText("0");
  await tick(page, 1);
  await expect(turn(page)).toHaveText("1");

  // The button does what the key does.
  await pause.click();
  await expect(timer(page)).toHaveAttribute("data-state", "paused");
  await tick(page, LIVE_TURN_MS * 2);
  await expect(turn(page)).toHaveText("1");
  await pause.click();
  await expect(timer(page)).toHaveAttribute("data-state", "running");

  // A P typed into a field is a letter, not the pause.
  await page.evaluate(() => {
    const field = document.createElement("input");
    field.setAttribute("data-testid", "scratch-field");
    document.body.append(field);
    field.focus();
  });
  await page.keyboard.press("p");
  await expect(page.getByTestId("scratch-field")).toHaveValue("p");
  await expect(timer(page)).toHaveAttribute("data-state", "running");
});

test("Live: the clock holds while a Why card is open and while the tab is hidden", async ({ page }) => {
  await open(page);
  await goLive(page);
  await tick(page, 700);

  await page.locator('[data-why-target="guard:G4"]').click();
  await expect(page.getByTestId("why-card")).toBeVisible();
  await expect(timer(page)).toHaveAttribute("data-state", "held");
  await expect(page.getByTestId("turn-timer-state")).toHaveText("On hold");
  await tick(page, LIVE_TURN_MS * 5);
  await expect(turn(page)).toHaveText("0");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("why-card")).toHaveCount(0);
  await expect(timer(page)).toHaveAttribute("data-state", "running");
  // It runs on from the 400 ms that were left.
  await tick(page, LIVE_TURN_MS - 700 - 1);
  await expect(turn(page)).toHaveText("0");
  await tick(page, 1);
  await expect(turn(page)).toHaveText("1");

  const setHidden = (hidden: boolean) =>
    page.evaluate((state) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden ? "hidden" : "visible");
  await setHidden(true);
  await expect(timer(page)).toHaveAttribute("data-state", "held");
  await tick(page, LIVE_TURN_MS * 5);
  await expect(turn(page)).toHaveText("1");
  await setHidden(false);
  await expect(timer(page)).toHaveAttribute("data-state", "running");
  await tick(page, LIVE_TURN_MS);
  await expect(turn(page)).toHaveText("2");
});

test("Live: a pick in progress goes on by the clock, and Space takes the files as ever and starts the countdown over", async ({
  page,
}) => {
  // Nine keys along the quiet route, and the clock's turns between them: about 3 s alone. 60 s is for a loaded VM.
  test.setTimeout(60_000);
  await open(page);
  await goLive(page);
  // The crew's quiet route to the records room door. Time stands still, so no clock turn falls between the keys.
  await pressFor(page, "fl-lobby");
  await page.keyboard.press("w");
  for (const node of ["dc-west", "dc-mid", "dc-east"]) await pressFor(page, node);
  const pick = page.locator('[data-testid="choice"][data-kind="pick"]');
  await expect(pick).toContainText("PICK 0/2");
  await page.keyboard.press((await pick.getAttribute("data-key"))!);
  await expect(pick).toContainText("PICK 1/2");
  await expect(page.getByTestId("locked-door")).toHaveCount(2);

  // The player lets the turn run out: the clock plays the second pick, where a wait would have lost the first.
  await tick(page, LIVE_TURN_MS);
  await expect(turn(page)).toHaveText("7");
  await expect(page.getByTestId("locked-door")).toHaveCount(1);
  await expect(page.getByTestId("run-status")).toHaveText("The door is open.");

  // In to the files. Space is the take it always was, 600 ms into the turn, and a turn like any other:
  // the next one is a whole turn away.
  await pressFor(page, "rr-door");
  await pressFor(page, "rr-files");
  await tick(page, 600);
  await page.keyboard.press(" ");
  await expect(page.getByTestId("objective")).toContainText("Taken");
  await expect(turn(page)).toHaveText("10");
  await tick(page, LIVE_TURN_MS - 1);
  await expect(turn(page)).toHaveText("10");
  // With no pick in progress the clock is back to waiting.
  await tick(page, 1);
  await expect(turn(page)).toHaveText("11");
  expect((await turnKinds(page)).slice(-6)).toEqual(["pick", "pick", "move", "move", "take", "wait"]);
  await expect(page.getByTestId("alarm-banner")).toHaveAttribute("data-state", "calm");
});

test("Live: a clock turn raises the alarm and calls the Chief, whose re-plan lands while the turns pass; the clock stops when the run ends, and the Debrief replays its turns", async ({
  page,
}) => {
  // Three keys, up to a dozen clock turns, two Chief calls and the Debrief: about 5 s alone. 90 s is for a loaded VM.
  test.setTimeout(90_000);
  let calls = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/chief", async (route) => {
    calls += 1;
    await held;
    await route.continue();
  });
  await open(page);
  await goLive(page);
  // Into C2's half of the dock corridor on a turn it looks the other way.
  await pressFor(page, "fl-lobby");
  await page.keyboard.press("w");
  await pressFor(page, "dc-west");
  await expect(turn(page)).toHaveText("3");
  await expect(page.getByTestId("alarm-banner")).toHaveAttribute("data-state", "calm");
  expect(calls).toBe(0);

  // Nobody presses anything: the clock's wait is the turn C2 looks back.
  await tick(page, LIVE_TURN_MS);
  await expect(turn(page)).toHaveText("4");
  await expect(page.getByTestId("alarm-banner")).toHaveAttribute("data-state", "alert");
  await expect(page.getByTestId("run-status")).toHaveText("C2 saw you in the Dock Corridor. The guards are converging.");
  await expect(page.getByTestId("chief-panel")).toHaveAttribute("data-state", "pending");
  expect(calls).toBe(1);

  // The clock does not hold for the Chief: with his call still out, the next turn passes.
  await tick(page, LIVE_TURN_MS);
  await expect(turn(page)).toHaveText("5");
  await expect(page.getByTestId("chief-panel")).toHaveAttribute("data-state", "pending");

  // He answers 600 ms into turn 5. His orders are a new state of the same turn: the countdown runs on.
  await tick(page, 600);
  release();
  await expect(page.getByTestId("chief-panel")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  await expect(turn(page)).toHaveText("5");
  await tick(page, LIVE_TURN_MS - 600 - 1);
  await expect(turn(page)).toHaveText("5");
  await tick(page, 1);
  await expect(turn(page)).toHaveText("6");
  // The orders applied on the turn they landed: the clock's turn 5 carries them in the log.
  const log = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), RUN_LOG);
  expect(log.turns.map((t: { chief?: unknown }) => Boolean(t.chief))).toEqual([false, false, false, false, false, true]);
  expect(log.turns[5].player.kind).toBe("wait");
  expect(log.turns[5].chief.orders.length).toBeGreaterThan(0);

  // Left alone the guards close in. The run ends on a clock turn, and the clock with it.
  for (let i = 0; i < 12 && (await page.getByTestId("run-outcome").count()) === 0; i++) await tick(page, LIVE_TURN_MS);
  await expect(page.getByTestId("run-outcome")).toHaveAttribute("data-status", "caught");
  await expect(timer(page)).toHaveCount(0);
  const ended = await turn(page).textContent();
  await tick(page, LIVE_TURN_MS * 5);
  await expect(turn(page)).toHaveText(ended!);

  // The Debrief replays the run from its log: three turns by the player, then the clock's waits, each
  // with every piece where that turn left it.
  const final = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), RUN_LOG);
  expect(final.turns).toHaveLength(Number(ended));
  expect(final.turns.map((t: { player: { kind: string } }) => t.player.kind)).toEqual([
    "move",
    "wait",
    "move",
    ...Array.from({ length: final.turns.length - 3 }, () => "wait"),
  ]);
  await page.clock.resume();
  await page.getByRole("link", { name: "See the debrief" }).click();
  await expect(page).toHaveURL(/\/b\/F1\/debrief\?m=romaine-1974$/, { timeout: 15_000 });
  const replay = page.getByTestId("replay-board");
  await expect(replay).toBeVisible();
  await expect(page.getByTestId("replay-slider")).toHaveAttribute("max", String(final.turns.length));
  // The clock's first turn (the one C2 saw), the one that carried the Chief's orders, and its last.
  for (const frame of [4, 6, final.turns.length]) {
    await page.getByTestId("replay-slider").fill(String(frame));
    await expect(replay).toHaveAttribute("data-frame", String(frame));
    const logged = final.turns[frame - 1] as { player: { nodeId: string }; guards: { guardId: string; nodeId: string }[] };
    await expect(replay.getByTestId("player-piece")).toHaveAttribute("data-node", logged.player.nodeId);
    for (const guard of logged.guards) {
      await expect(replay.locator(`[data-testid="guard-piece"][data-id="${guard.guardId}"]`), `${guard.guardId} on frame ${frame}`).toHaveAttribute(
        "data-node",
        guard.nodeId,
      );
    }
  }
});

test("Live: Restart starts the countdown over, sprinting stays on through a clock turn, and Tactical stops the clock and its pause", async ({
  page,
}) => {
  await open(page);
  await goLive(page);
  await tick(page, LIVE_TURN_MS);
  await expect(turn(page)).toHaveText("1");

  await tick(page, 800);
  await page.getByRole("button", { name: "Restart" }).click();
  await expect(turn(page)).toHaveText("0");
  await tick(page, LIVE_TURN_MS - 1);
  await expect(turn(page)).toHaveText("0");
  await tick(page, 1);
  await expect(turn(page)).toHaveText("1");

  // S arms a sprint 600 ms into the turn. It is not an action, so the countdown runs on; and the turn the
  // clock then plays is not the player's, so the sprint stays armed and the numbers stay on its targets.
  const hint = page.getByTestId("sprint-hint");
  await tick(page, 600);
  await page.keyboard.press("s");
  await expect(hint).toHaveAttribute("data-on", "true");
  await expect(page.getByTestId("choice").first()).toHaveAttribute("data-kind", "sprint");
  await tick(page, LIVE_TURN_MS - 600 - 1);
  await expect(turn(page)).toHaveText("1");
  await tick(page, 1);
  await expect(turn(page)).toHaveText("2");
  await expect(hint).toHaveAttribute("data-on", "true");
  await expect(page.getByTestId("choice").first()).toHaveAttribute("data-kind", "sprint");

  // Paused 700 ms into a turn, then back to Tactical: no clock, and the keys play as ever.
  await tick(page, 700);
  await page.keyboard.press("p");
  await expect(timer(page)).toHaveAttribute("data-state", "paused");
  await page.getByTestId("play-mode-tactical").click();
  await expect(timer(page)).toHaveCount(0);
  await tick(page, LIVE_TURN_MS * 5);
  await expect(turn(page)).toHaveText("2");
  // Choosing Live again starts the clock: running, not paused, with a whole turn, not the 400 ms that were left.
  await goLive(page);
  await tick(page, LIVE_TURN_MS - 1);
  await expect(turn(page)).toHaveText("2");
  await tick(page, 1);
  await expect(turn(page)).toHaveText("3");
});

test("the timer's bar drains in the accent over one turn, stops when the clock does, and stands still under prefers-reduced-motion", async ({
  page,
}) => {
  await open(page);
  await goLive(page);
  const bar = page.getByTestId("turn-timer-bar");
  const drawn = () =>
    bar.evaluate((el) => {
      const s = getComputedStyle(el);
      return { name: s.animationName, duration: s.animationDuration, state: s.animationPlayState, colour: s.backgroundColor };
    });
  // DESIGN.md's --accent (#f0bd4a), for LIVE_TURN_MS.
  expect(await drawn()).toEqual({ name: "turn-drain", duration: `${LIVE_TURN_MS / 1000}s`, state: "running", colour: "rgb(240, 189, 74)" });
  await page.keyboard.press("p");
  await expect(timer(page)).toHaveAttribute("data-state", "paused");
  expect(await drawn()).toMatchObject({ name: "turn-drain", state: "paused" });
  expect((await drawn()).colour).not.toBe("rgb(240, 189, 74)");
  await page.screenshot({ path: "test-results/run-live/paused.png" });
  await page.keyboard.press("p");
  await expect(timer(page)).toHaveAttribute("data-state", "running");

  // Each turn gets a new bar, so the drain starts from full again.
  await bar.evaluate((el) => el.setAttribute("data-seen", ""));
  await tick(page, LIVE_TURN_MS);
  await expect(turn(page)).toHaveText("1");
  await expect(bar).not.toHaveAttribute("data-seen", /.*/);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(timer(page)).toHaveAttribute("data-state", "running");
  expect((await drawn()).name).toBe("none");
  await expect(page.getByTestId("turn-timer-state")).toHaveText("Running");
  // The clock still runs: only the bar stands still.
  await tick(page, LIVE_TURN_MS);
  await expect(turn(page)).toHaveText("2");
  expect((await drawn()).name).toBe("none");
  await page.keyboard.press("p");
  await expect(page.getByTestId("turn-timer-state")).toHaveText("Paused");
});

test("the choice is remembered by the browser: Live is still on after a reload, and its clock runs in real time", async ({ page }) => {
  // Two reloads and one real turn of 1.1 s: about 4 s alone. 60 s is for a cold server on a loaded VM.
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/b/F1/run");
  await expect(board(page)).toBeVisible();
  await expect(modeSwitch(page)).toHaveAttribute("data-mode", "tactical");
  expect(await page.evaluate((key) => localStorage.getItem(key), PLAY_MODE)).toBeNull();

  await page.getByTestId("play-mode-live").click();
  expect(await page.evaluate((key) => localStorage.getItem(key), PLAY_MODE)).toBe("live");
  await page.reload();
  await expect(board(page)).toBeVisible();
  await expect(modeSwitch(page)).toHaveAttribute("data-mode", "live");
  await expect(timer(page)).toBeVisible();
  // No fake clock here: the first turn passes by itself.
  await expect(turn(page)).not.toHaveText("0", { timeout: 10_000 });

  await page.getByTestId("play-mode-tactical").click();
  expect(await page.evaluate((key) => localStorage.getItem(key), PLAY_MODE)).toBe("tactical");
  await page.reload();
  await expect(board(page)).toBeVisible();
  await expect(turn(page)).toHaveText("0");
  await expect(modeSwitch(page)).toHaveAttribute("data-mode", "tactical");
  await expect(timer(page)).toHaveCount(0);
});

for (const [width, height] of [
  [1440, 900],
  [1280, 720],
  [390, 844],
] as const) {
  test(`at ${width}×${height} the switch and the timer cover no node of the board`, async ({ page }) => {
    await page.clock.install();
    await page.setViewportSize({ width, height });
    await page.goto("/b/F1/run");
    await expect(board(page)).toBeVisible();
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await goLive(page);
    await expect(page.getByTestId("board-node")).toHaveCount(30);
    // What a tap on each node's centre would land on.
    const covered = await page.getByTestId("board-node").evaluateAll((nodes) =>
      nodes
        .filter((node) => {
          const box = node.getBoundingClientRect();
          const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return top?.closest('[data-testid="play-mode"], [data-testid="turn-timer"]') != null;
        })
        .map((node) => node.getAttribute("data-node")),
    );
    expect(covered).toEqual([]);
  });
}

test("at 390×844 the switch and the timer fit the board's corners, and the page does not scroll sideways", async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/b/F1/run");
  await expect(board(page)).toBeVisible();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await expect(page.getByRole("button", { name: "Restart" })).toBeVisible();
  await goLive(page);

  const area = (await board(page).boundingBox())!;
  for (const id of ["play-mode", "turn-timer"]) {
    const box = (await page.getByTestId(id).boundingBox())!;
    expect(box.x, id).toBeGreaterThanOrEqual(area.x);
    expect(box.x + box.width, id).toBeLessThanOrEqual(area.x + area.width);
    expect(box.y, id).toBeGreaterThanOrEqual(area.y);
    expect(box.y + box.height, id).toBeLessThanOrEqual(area.y + area.height);
  }
  // Each control is a 40 px target, and the player can still tap the way on.
  for (const id of ["play-mode-tactical", "play-mode-live", "turn-pause"]) {
    const box = (await page.getByTestId(id).boundingBox())!;
    expect(Math.min(box.width, box.height), id).toBeGreaterThanOrEqual(40);
  }
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, "the page's width").toBeLessThanOrEqual(client);
  await choice(page, "fl-lobby").click();
  await expect(player(page)).toHaveAttribute("data-node", "fl-lobby");
  await page.screenshot({ path: "test-results/run-live/mobile.png" });
});
