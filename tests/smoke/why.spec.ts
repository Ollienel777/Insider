import { expect, test, type Page } from "@playwright/test";

// The Why card (SPEC §2 beat 5, issue #21), on the production build in fake
// mode: clicking a guard, a camera or a lock on F1's board draws the
// provenance thread in the first row's layer colour and opens the card with
// the element's recorded provenance. Esc and a click outside close it.

const card = (page: Page) => page.getByTestId("why-card");
const rows = (page: Page) =>
  page.getByTestId("why-row").evaluateAll((els) =>
    els.map((el) => [el.getAttribute("data-layer"), el.getAttribute("data-field"), el.getAttribute("data-value")]),
  );
const target = (page: Page, key: string) => page.locator(`[data-why-target="${key}"]`);

async function open(page: Page, path: string, board: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(path);
  await expect(page.getByTestId(board)).toBeVisible();
}

test("clicking the dock post shows Vexcel's dock entry and CoStar's Class A, with a Vexcel thread drawn in 300ms", async ({
  page,
}) => {
  await open(page, "/b/F1/run", "run-board");
  await expect(card(page)).toHaveCount(0);
  await target(page, "guard:G4").click();

  await expect(card(page)).toBeVisible();
  await expect(card(page)).toContainText("G4");
  await expect(card(page)).toContainText("Posted for the loading dock");
  expect(await rows(page)).toEqual([
    ["vexcel", "entries.kind", "dock"],
    ["costar", "buildingClass", "A"],
  ]);
  await expect(card(page)).toContainText("Class A → 4 guards; the 4th guard comes from Class A");

  const thread = page.getByTestId("provenance-thread").locator("line");
  await expect(thread).toHaveCount(1);
  const style = await thread.evaluate((el) => {
    const s = getComputedStyle(el);
    return { stroke: s.stroke, width: s.strokeWidth, duration: s.animationDuration, name: s.animationName };
  });
  expect(style).toEqual({ stroke: "rgb(192, 140, 255)", width: "1px", duration: "0.3s", name: "thread-draw" });

  // The card sits beside the board's piece, inside the board.
  const board = (await page.getByTestId("run-board").boundingBox())!;
  const box = (await card(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(board.x);
  expect(box.x + box.width).toBeLessThanOrEqual(board.x + board.width);
  expect(box.y + box.height).toBeLessThanOrEqual(board.y + board.height);

  await page.keyboard.press("Escape");
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByTestId("provenance-thread")).toHaveCount(0);
});

test("clicking the records room lock shows the year-built row and the era rule; a click outside closes it", async ({
  page,
}) => {
  await open(page, "/b/F1/run", "run-board");
  await target(page, "lock:d-records-room").click();
  await expect(card(page)).toBeVisible();
  expect((await rows(page))[0]).toEqual(["costar", "yearBuilt", "1974"]);
  await expect(card(page)).toContainText("Built 1974 (before 1980) → Analog era: key locks, pickable in 2 turns");
  const stroke = await page.getByTestId("provenance-thread").locator("line").evaluate((el) => getComputedStyle(el).stroke);
  expect(stroke).toBe("rgb(122, 167, 255)");

  // Outside the card and every piece: the board's empty corner.
  const board = (await page.getByTestId("run-board").boundingBox())!;
  await page.mouse.click(board.x + 8, board.y + board.height - 8);
  await expect(card(page)).toHaveCount(0);
});

test("C2's card after the trip names the year built, and the game keys still play with it open", async ({ page }) => {
  await open(page, "/b/F1/run", "run-board");
  await target(page, "camera:C2").click();
  expect(await rows(page)).toEqual([
    ["costar", "yearBuilt", "1974"],
    ["costar", "yearBuilt", "1974"],
  ]);
  await expect(card(page)).toContainText("camera 2 of 2");
  // Straight into C2's view, card open: the alarm still goes to Alert.
  await page.keyboard.press("1");
  await expect(page.getByTestId("player-piece")).toHaveAttribute("data-node", "fl-lobby");
  const key = await page.locator('[data-testid="choice"][data-node="dc-west"]').getAttribute("data-key");
  await page.keyboard.press(key!);
  await expect(page.getByTestId("alarm-banner")).toHaveAttribute("data-state", "alert");
  await expect(card(page)).toBeVisible();
});

test("at Alert, clicking a guard on a numbered neighbour opens its card and never moves the player", async ({ page }) => {
  await open(page, "/b/F1/run", "run-board");
  const board = page.getByTestId("run-board");
  // The wow beat: into C2's view, then wait a turn while the guards converge.
  await page.keyboard.press("1");
  await expect(page.getByTestId("player-piece")).toHaveAttribute("data-node", "fl-lobby");
  const key = await page.locator('[data-testid="choice"][data-node="dc-west"]').getAttribute("data-key");
  await page.keyboard.press(key!);
  await expect(page.getByTestId("alarm-banner")).toHaveAttribute("data-state", "alert");
  await page.keyboard.press("w");
  await expect(board).toHaveAttribute("data-turn", "3");

  // G4 now stands on dc-mid, one of the player's numbered choices.
  const g4 = page.locator('[data-testid="guard-piece"][data-id="G4"]');
  await expect(g4).toHaveAttribute("data-node", "dc-mid");
  await expect(page.locator('[data-testid="choice"][data-node="dc-mid"]')).toHaveCount(1);

  // A real click, with Playwright's hit test: nothing may sit over the guard.
  await target(page, "guard:G4").click();
  await expect(card(page)).toBeVisible();
  await expect(card(page)).toHaveAttribute("data-why", "guard:G4");
  await expect(page.getByTestId("player-piece")).toHaveAttribute("data-node", "dc-west");
  await expect(board).toHaveAttribute("data-turn", "3");
  await expect(board).toHaveAttribute("data-alarm", "alert");
  // The subtitle follows the guard's order, not the post it was given at the start.
  await expect(page.getByTestId("why-subtitle")).toHaveText(/^Posted for the loading dock at the start; now /);

  // The card leaves every numbered choice and the player in view (R3-M3).
  const box = (await card(page).boundingBox())!;
  // Each choice's ring (the badge the player reads), and the player's pawn: no overlap at all.
  const shown = [
    ...(await page.locator('[data-testid="choice"] ellipse').all()),
    page.getByTestId("player-piece"),
  ];
  expect(shown.length).toBeGreaterThan(1);
  for (const el of shown) {
    const b = (await el.boundingBox())!;
    const overlaps = b.x < box.x + box.width && b.x + b.width > box.x && b.y < box.y + box.height && b.y + b.height > box.y;
    expect(overlaps, JSON.stringify(b)).toBe(false);
  }

  // Esc after a click hands focus to the board, not the guard: Space is the run's again.
  await page.keyboard.press("Escape");
  await expect(card(page)).toHaveCount(0);
  await expect(target(page, "guard:G4")).not.toBeFocused();
});

test("after a click and Esc, the quiet route by keys still takes the files with Space and wins (R3-C1)", async ({ page }) => {
  await open(page, "/b/F1/run", "run-board");
  const board = page.getByTestId("run-board");
  await target(page, "guard:G4").click();
  await expect(card(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card(page)).toHaveCount(0);

  const keyFor = async (node: string) =>
    (await page.locator(`[data-testid="choice"][data-node="${node}"]`).getAttribute("data-key"))!;
  const step = async (key: string, turn: number) => {
    await page.keyboard.press(key);
    await expect(board).toHaveAttribute("data-turn", String(turn));
  };
  // The quiet route (SPEC §2 beat 4): in by the freight lift, wait, along the corridor, pick twice, the files.
  await step(await keyFor("fl-lobby"), 1);
  await step("w", 2);
  await step(await keyFor("dc-west"), 3);
  await step(await keyFor("dc-mid"), 4);
  await step(await keyFor("dc-east"), 5);
  await step(await keyFor("rr-door"), 6);
  await step(await keyFor("rr-door"), 7);
  await step(await keyFor("rr-door"), 8);
  await step(await keyFor("rr-files"), 9);
  await expect(page.getByTestId("player-piece")).toHaveAttribute("data-node", "rr-files");

  await expect(target(page, "guard:G4")).not.toBeFocused();
  await page.keyboard.press(" ");
  await expect(board).toHaveAttribute("data-turn", "10");
  await expect(page.getByTestId("objective")).toContainText("Taken");
  await expect(card(page)).toHaveCount(0);
  await expect(board).toHaveAttribute("data-alarm", "calm");

  // Back out the way in: the run goes on to win.
  await step(await keyFor("rr-door"), 11);
  await step(await keyFor("dc-east"), 12);
  await step("w", 13);
  await step(await keyFor("dc-mid"), 14);
  await step(await keyFor("dc-west"), 15);
  await step(await keyFor("fl-lobby"), 16);
  await page.keyboard.press(await keyFor("fl-car"));
  await expect(page.getByTestId("run-outcome")).toHaveAttribute("data-status", "won");
});

test("Space opens the card on a piece Tab put in focus, and Esc hands focus back to it", async ({ page }) => {
  await open(page, "/b/F1/run", "run-board");
  const g4 = target(page, "guard:G4");
  await page.locator("body").focus();
  for (let i = 0; i < 80 && !(await g4.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(g4).toBeFocused();
  await page.keyboard.press(" ");
  await expect(card(page)).toHaveAttribute("data-why", "guard:G4");
  await expect(page.getByTestId("player-piece")).toHaveAttribute("data-node", "fl-car");
  await page.keyboard.press("Escape");
  await expect(card(page)).toHaveCount(0);
  await expect(g4).toBeFocused();
  await page.keyboard.press(" ");
  await expect(card(page)).toHaveAttribute("data-why", "guard:G4");
});

test("Space does one thing: after Tab, Enter and Esc on G4, the quiet route by keys takes the files and leaves the card shut (#68)", async ({
  page,
}) => {
  await open(page, "/b/F1/run", "run-board");
  const board = page.getByTestId("run-board");
  const g4 = target(page, "guard:G4");
  await page.locator("body").focus();
  for (let i = 0; i < 80 && !(await g4.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(g4).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(card(page)).toHaveAttribute("data-why", "guard:G4");
  await page.keyboard.press("Escape");
  await expect(card(page)).toHaveCount(0);

  const keyFor = async (node: string) =>
    (await page.locator(`[data-testid="choice"][data-node="${node}"]`).getAttribute("data-key"))!;
  const step = async (key: string, turn: number) => {
    await page.keyboard.press(key);
    await expect(board).toHaveAttribute("data-turn", String(turn));
  };
  await step(await keyFor("fl-lobby"), 1);
  await step("w", 2);
  await step(await keyFor("dc-west"), 3);
  await step(await keyFor("dc-mid"), 4);
  await step(await keyFor("dc-east"), 5);
  await step(await keyFor("rr-door"), 6);
  await step(await keyFor("rr-door"), 7);
  await step(await keyFor("rr-door"), 8);
  await step(await keyFor("rr-files"), 9);

  await page.keyboard.press(" ");
  await expect(board).toHaveAttribute("data-turn", "10");
  await expect(page.getByTestId("objective")).toContainText("Taken");
  // Give a card the time to open, were it going to: it must not.
  await page.waitForTimeout(300);
  await expect(card(page)).toHaveCount(0);
});

test("Space on a piece Tab put in focus opens its card and plays no turn, even where it could take the files (#68)", async ({
  page,
}) => {
  await open(page, "/b/F1/run", "run-board");
  const board = page.getByTestId("run-board");
  const keyFor = async (node: string) =>
    (await page.locator(`[data-testid="choice"][data-node="${node}"]`).getAttribute("data-key"))!;
  for (const [node, turn] of [["fl-lobby", 1], ["w", 2], ["dc-west", 3], ["dc-mid", 4], ["dc-east", 5], ["rr-door", 6], ["rr-door", 7], ["rr-door", 8], ["rr-files", 9]] as const) {
    await page.keyboard.press(node === "w" ? "w" : await keyFor(node));
    await expect(board).toHaveAttribute("data-turn", String(turn));
  }
  const g4 = target(page, "guard:G4");
  await page.locator("body").focus();
  for (let i = 0; i < 80 && !(await g4.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(g4).toBeFocused();
  await page.keyboard.press(" ");
  await expect(card(page)).toHaveAttribute("data-why", "guard:G4");
  await page.waitForTimeout(300);
  await expect(board).toHaveAttribute("data-turn", "9");
  await expect(page.getByTestId("objective")).not.toContainText("Taken");
});

test("the PICK and move badges beside the records lock win their whole area (R3-M1)", async ({ page }) => {
  await open(page, "/b/F1/run", "run-board");
  const board = page.getByTestId("run-board");
  const lockPoints = (node: string) =>
    page.locator(`[data-testid="choice"][data-node="${node}"]`).evaluate((el) => {
      const b = el.getBoundingClientRect();
      let n = 0;
      for (let i = 0; i < 5; i++)
        for (let j = 0; j < 5; j++) {
          const hit = document.elementFromPoint(b.x + ((i + 0.5) * b.width) / 5, b.y + ((j + 0.5) * b.height) / 5);
          if (hit?.closest('[data-why-target^="lock:"]')) n++;
        }
      return n;
    });
  const keyFor = async (node: string) =>
    (await page.locator(`[data-testid="choice"][data-node="${node}"]`).getAttribute("data-key"))!;
  await page.keyboard.press(await keyFor("fl-lobby"));
  await expect(board).toHaveAttribute("data-turn", "1");
  await page.keyboard.press("w");
  await expect(board).toHaveAttribute("data-turn", "2");
  await page.keyboard.press(await keyFor("dc-west"));
  await expect(board).toHaveAttribute("data-turn", "3");
  await page.keyboard.press(await keyFor("dc-mid"));
  await expect(page.getByTestId("player-piece")).toHaveAttribute("data-node", "dc-mid");
  expect(await lockPoints("dc-east")).toBe(0);
  await page.keyboard.press(await keyFor("dc-east"));
  await expect(page.getByTestId("player-piece")).toHaveAttribute("data-node", "dc-east");
  expect(await lockPoints("rr-door")).toBe(0);
  // A real click on the PICK badge's top-right corner picks; it opens no card.
  const pick = (await page.locator('[data-testid="choice"][data-node="rr-door"]').boundingBox())!;
  await page.mouse.click(pick.x + pick.width - 3, pick.y + 3);
  await expect(board).toHaveAttribute("data-turn", "6");
  await expect(card(page)).toHaveCount(0);
});

test("the Why card works on Plan's board too", async ({ page }) => {
  await open(page, "/b/F1/plan", "plan-board");
  await target(page, "guard:G4").click();
  await expect(card(page)).toBeVisible();
  expect((await rows(page))[0]).toEqual(["vexcel", "entries.kind", "dock"]);
  await card(page).getByRole("button", { name: "Close the Why card" }).click();
  await expect(card(page)).toHaveCount(0);
});
