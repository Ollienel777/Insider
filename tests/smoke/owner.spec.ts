import { expect, test, type Page } from "@playwright/test";

// The Owner screen (Owner Mode, SPEC §13, issue 128), on the production build
// in fake mode: from the Debrief into Owner Mode, the crew's 50 attempts on the
// untouched starting point, the Chief's recorded fix, and the rerun. On F1 the
// recorded strategies and fix give 17 of 50 out before and none after, the
// same on every run. Screenshots go to test-results/owner/.

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/owner/${name}.png` });

async function toDebrief(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/b/F1/run");
  await expect(page.getByTestId("run-board")).toBeVisible();
  // One move, so the Debrief has a run to replay.
  const key = await page.locator('[data-testid="choice"]').first().getAttribute("data-key");
  await page.keyboard.press(key!);
  await expect(page.getByTestId("run-board")).toHaveAttribute("data-turn", "1");
  await page.goto("/b/F1/debrief");
  await expect(page.getByTestId("replay-board")).toBeVisible();
}

test("Debrief to Owner Mode: 50 attempts, the Chief's fix, before and after", async ({ page }) => {
  await toDebrief(page);
  await page.getByTestId("debrief-owner-mode").click();
  await expect(page).toHaveURL(/\/b\/F1\/owner\?m=romaine-1974$/);

  // The editor opens on the generated setup, never empty, with the made-up line.
  await expect(page.getByTestId("owner-board")).toBeVisible();
  await expect(page.getByTestId("owner-made-up")).toHaveText(
    "Made-up setup on a fixture building. Real setups stay on this device.",
  );
  await expect(page.getByTestId("owner-setup")).toHaveAttribute("data-state", "untouched");
  await expect(page.getByTestId("owner-setup-counts")).toHaveText("4 guards · 1 cleaner · 2 cameras · 2 locked doors · 0 desks");
  await expect(page.getByTestId("owner-problems-none")).toBeVisible();
  await expect(page.getByTestId("owner-saved-empty")).toBeVisible();
  await shot(page, "setup");

  // Run 50 attempts: 17 of 50 got out, strategy by strategy.
  await page.getByTestId("owner-run").click();
  const count = page.getByTestId("owner-count");
  await expect(count).toHaveAttribute("data-escaped", "17");
  await expect(count).toHaveAttribute("data-total", "50");
  await expect(page.getByTestId("owner-strip").locator("[data-outcome]")).toHaveCount(50);
  await expect(page.getByTestId("owner-strip").locator('[data-outcome="escaped"]')).toHaveCount(17);
  await expect(page.getByTestId("owner-crew-recorded")).toBeVisible();
  const escapedBy = await page
    .getByTestId("owner-strategy")
    .evaluateAll((rows) => Object.fromEntries(rows.map((r) => [r.getAttribute("data-strategy"), Number(r.getAttribute("data-escaped"))])));
  expect(escapedBy).toEqual({ "dock-patient": 9, "dock-fast": 6, "dock-in-roof-out": 2, "suite-detour": 0, "roof-quiet": 0 });
  await expect(page.getByTestId("owner-route")).toHaveAttribute("data-count", "14");
  await expect(page.getByTestId("owner-measure")).toHaveAttribute("data-coverage", "47");
  // Half the moments let a crew in and out unseen, so no line on how the 17 got out; the note says what the numbers leave out.
  await expect(page.getByTestId("owner-measure")).toHaveAttribute("data-windows", "40");
  await expect(page.getByTestId("owner-measure")).toHaveAttribute("data-moments", "80");
  await expect(page.getByTestId("owner-measure-timing")).toHaveCount(0);
  await expect(page.getByTestId("owner-measure-note")).toContainText("being seen is not being caught");
  await expect(page.getByTestId("owner-detector")).toBeVisible();
  await expect(page.getByTestId("owner-detector-ring")).toBeVisible();
  await shot(page, "batch");

  // The Chief's recorded fix: C2 over the whole dock corridor.
  await page.getByTestId("owner-ask-fix").click();
  await expect(page.getByTestId("owner-fix")).toHaveText("C2 now covers the dock corridor");
  await expect(page.getByTestId("owner-fix-recorded")).toHaveText("Recorded");

  // Apply and rerun: 17 of 50 before, none after.
  await page.getByTestId("owner-apply").click();
  await expect(page.getByTestId("owner-before-count")).toHaveAttribute("data-escaped", "17");
  await expect(page.getByTestId("owner-after-count")).toHaveAttribute("data-escaped", "0");
  await expect(page.getByTestId("owner-after-count")).toHaveAttribute("data-total", "50");
  await expect(page.getByTestId("owner-changed")).toContainText("17 fewer got out");
  await expect(page.getByTestId("owner-measure-change")).toHaveText("Coverage 47% → 50%, open windows 40 → 0.");
  // The route and detector cards describe the side the board shows: After by default, then Before.
  await expect(page.getByTestId("owner-route")).toHaveAttribute("data-side", "after");
  await expect(page.getByTestId("owner-route")).toHaveAttribute("data-count", "0");
  const ring = await page.getByTestId("owner-detector-ring").getAttribute("data-detector");
  await expect(page.getByTestId("owner-detector")).toHaveAttribute("data-detector", ring ?? "");
  await page.getByTestId("owner-side-before").click();
  await expect(page.getByTestId("owner-route")).toHaveAttribute("data-side", "before");
  await expect(page.getByTestId("owner-route")).toHaveAttribute("data-count", "14");
  const ringBefore = await page.getByTestId("owner-detector-ring").getAttribute("data-detector");
  await expect(page.getByTestId("owner-detector")).toHaveAttribute("data-detector", ringBefore ?? "");
  await page.getByTestId("owner-side-after").click();
  await page.getByTestId("owner-compare").scrollIntoViewIfNeeded();
  await shot(page, "before-after");

  // Save the fixed setup: it stays on this device and opens in the editor.
  await page.getByTestId("owner-save-fixed").click();
  await expect(page.getByTestId("owner-fixed-saved")).toContainText("Generated security, after the fix");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("heist:owner-setups:F1") ?? "[]"));
  expect(stored.map((s: { name: string }) => s.name)).toEqual(["Generated security, after the fix"]);
  await page.getByTestId("owner-open-fixed").click();
  await expect(page.getByTestId("owner-setup")).toHaveAttribute("data-state", "saved");
});

test("the editor names a broken round, and blocks the run until it is fixed", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/b/F1/owner");
  await expect(page.getByTestId("owner-board")).toBeVisible();

  // G1 walks the main corridor; draw it a round that jumps to a node it has no edge to.
  await page.locator('[data-owner-node="mc-w"]').click({ force: true });
  await expect(page.getByTestId("owner-inspector")).toHaveAttribute("data-selected", "guard:G1");
  await page.getByTestId("owner-draw-round").click();
  await page.locator('[data-owner-node="mc-4"]').click({ force: true });
  await expect(page.getByTestId("owner-setup")).toHaveAttribute("data-state", "error");
  await expect(page.getByTestId("owner-inline-problem").first()).toContainText("not a connected loop");
  await expect(page.getByTestId("owner-run")).toBeDisabled();
  // No coverage for a setup the batch would not play (issue 132).
  await expect(page.getByTestId("owner-setup-measure-blocked")).toHaveText("Fix the problem below to measure coverage and open windows.");
  await expect(page.getByTestId("owner-setup-measure")).toHaveCount(0);
  await shot(page, "editor-error");

  // Take the node back off, and the guard stands its post: no problem left.
  await page.locator('[data-owner-node="mc-4"]').click({ force: true });
  await page.getByTestId("owner-round-done").click();
  await expect(page.getByTestId("owner-problems-none")).toBeVisible();
  await expect(page.getByTestId("owner-run")).toBeEnabled();
  await expect(page.getByTestId("owner-setup-measure")).toBeVisible();
});

// Issue 31: the prepared pair and the compare. The made-up night shift gets 7
// of 50 out; with C2 moved from the freight lift lobby into the dock corridor,
// 1 of 50. Played on the recorded strategies, the same on every run.
const outcomes = (page: Page, testId: string) =>
  page.getByTestId(testId).locator("[data-outcome]").evaluateAll((cells) => cells.map((c) => c.getAttribute("data-outcome")));

test("the prepared pair: 7 of 50, C2 moved, 1 of 50, then the two side by side", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/b/F1/owner?m=romaine-1974");
  await expect(page.getByTestId("owner-board")).toBeVisible();
  await expect(page.getByTestId("owner-demos")).toBeVisible();

  // The night shift, loaded in plain sight and labelled made up: 7 of 50 out.
  await page.locator('[data-testid="owner-demo-load"][data-name="Demo: night shift"]').click();
  await expect(page.getByTestId("owner-setup")).toHaveAttribute("data-state", "preset");
  await expect(page.getByTestId("owner-setup-state")).toHaveText("Made up");
  await expect(page.getByTestId("owner-made-up")).toBeVisible();
  await expect(page.getByTestId("owner-board-caption")).toHaveText("Demo: night shift");
  await expect(page.getByTestId("owner-setup-counts")).toHaveText("4 guards · 0 cleaners · 2 cameras · 2 locked doors · 1 desk");
  // From the floor plan alone, before any attempt: 43% of the floor watched every night, 40 of 80 moments open.
  await expect(page.getByTestId("owner-setup-measure-coverage")).toHaveText(
    "Coverage: 43% of the floor is watched at some point in every night the crew plays.",
  );
  await expect(page.getByTestId("owner-setup-measure-windows")).toHaveText(
    "Open windows: 40 of 80 moments in the 10 nights the crew plays let a crew in and out unseen.",
  );
  await expect(page.getByTestId("owner-setup-measure-first")).toHaveText(
    "The first opens on night 1, turn 0: Freight Lift Lobby → Dock Corridor → Records Room → Dock Corridor → Freight Lift Lobby.",
  );
  await page.getByTestId("owner-run").click();
  await expect(page.getByTestId("owner-count")).toHaveAttribute("data-escaped", "7");
  await expect(page.getByTestId("owner-count")).toHaveAttribute("data-total", "50");
  await expect(page.getByTestId("owner-measure")).toHaveAttribute("data-coverage", "43");
  await expect(page.getByTestId("owner-measure")).toHaveAttribute("data-windows", "40");
  await expect(page.getByTestId("owner-measure-timing")).toHaveCount(0);
  await expect(page.getByTestId("owner-strip").locator('[data-outcome="escaped"]')).toHaveCount(7);
  await expect(page.getByTestId("owner-route")).toHaveAttribute("data-count", "7");

  // One change: C2 moved into the dock corridor. 1 of 50 out.
  await page.getByTestId("owner-edit").click();
  await page.locator('[data-testid="owner-demo-load"][data-name="Demo: night shift, C2 moved"]').click();
  await expect(page.getByTestId("owner-board-caption")).toHaveText("Demo: night shift, C2 moved");
  await expect(page.getByTestId("owner-setup-measure")).toHaveAttribute("data-coverage", "50");
  await expect(page.getByTestId("owner-setup-measure")).toHaveAttribute("data-windows", "20");
  await page.getByTestId("owner-run").click();
  await expect(page.getByTestId("owner-count")).toHaveAttribute("data-escaped", "1");
  await expect(page.getByTestId("owner-strip").locator('[data-outcome="escaped"]')).toHaveCount(1);

  // Side by side: the picker starts on the prepared pair.
  await page.getByTestId("owner-edit").click();
  await expect(page.getByTestId("owner-pair-pick-a")).toHaveValue("demo:Demo: night shift");
  await expect(page.getByTestId("owner-pair-pick-b")).toHaveValue("demo:Demo: night shift, C2 moved");
  await page.getByTestId("owner-pair-picker").scrollIntoViewIfNeeded();
  await shot(page, "compare-picker");
  await page.getByTestId("owner-pair-run").click();
  await expect(page.getByTestId("owner-pair")).toHaveAttribute("data-state", "done");
  await expect(page.getByTestId("owner-pair-a-count")).toHaveAttribute("data-escaped", "7");
  await expect(page.getByTestId("owner-pair-b-count")).toHaveAttribute("data-escaped", "1");
  await expect(page.getByTestId("owner-pair-a-strip").locator('[data-outcome="escaped"]')).toHaveCount(7);
  await expect(page.getByTestId("owner-pair-b-strip").locator('[data-outcome="escaped"]')).toHaveCount(1);
  await expect(page.getByTestId("owner-pair-a-route")).toHaveAttribute("data-count", "7");
  await expect(page.getByTestId("owner-pair-b-route")).toHaveAttribute("data-count", "1");
  await expect(page.getByTestId("owner-pair-change")).toHaveText(["C2 moved from the Freight Lift Lobby to the Dock Corridor"]);
  await expect(page.getByTestId("owner-pair-delta")).toHaveText("7 → 1 of 50: 6 fewer got out.");
  // The floor plan's view of the same move: C2 watches two more positions, and halves the moments a crew gets in and out unseen.
  await expect(page.getByTestId("owner-pair-a-measure")).toHaveText("43% watched · 40/80 open");
  await expect(page.getByTestId("owner-pair-b-measure")).toHaveText("50% watched · 20/80 open");
  await expect(page.getByTestId("owner-pair-measure-change")).toHaveText("Coverage 43% → 50%, open windows 40 → 20.");
  await expect(page.getByTestId("owner-made-up-chip")).toHaveCount(2);
  await expect(page.getByTestId("owner-pair-recorded")).toBeVisible();

  // A on the board: its way out drawn, the desk that noticed the crew most often ringed.
  await expect(page.getByTestId("owner-board-caption")).toHaveText(
    "A, Demo: night shift: 7 of 50 got out. The way most got out is drawn.",
  );
  await expect(page.getByTestId("owner-pair-side-a")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("ghost-path")).toBeVisible();
  await expect(page.getByTestId("owner-detector-ring")).toHaveAttribute("data-detector", "cleaner:D1");
  await shot(page, "compare-a");

  // B on the board: C2 rings now.
  await page.getByTestId("owner-pair-side-b").click();
  await expect(page.getByTestId("owner-board-caption")).toHaveText(
    "B, Demo: night shift, C2 moved: 1 of 50 got out. The way most got out is drawn.",
  );
  await expect(page.getByTestId("owner-pair-b")).toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("owner-detector-ring")).toHaveAttribute("data-detector", "camera:C2");
  await shot(page, "compare-b");

  // The same result on every run: compare again, cell for cell.
  const first = [await outcomes(page, "owner-pair-a-strip"), await outcomes(page, "owner-pair-b-strip")];
  await page.getByTestId("owner-pair-back").click();
  await page.getByTestId("owner-pair-run").click();
  await expect(page.getByTestId("owner-pair")).toHaveAttribute("data-state", "done");
  expect([await outcomes(page, "owner-pair-a-strip"), await outcomes(page, "owner-pair-b-strip")]).toEqual(first);

  // Any saved setup can be picked: save B, then compare the saved copy with the night shift.
  await page.getByTestId("owner-pair-side-b").click();
  await page.getByTestId("owner-pair-open").click();
  await expect(page.getByTestId("owner-setup")).toHaveAttribute("data-state", "preset");
  await page.getByTestId("owner-save").click();
  await expect(page.getByTestId("owner-setup")).toHaveAttribute("data-state", "saved");
  await page.getByTestId("owner-pair-pick-a").selectOption("saved:Demo: night shift, C2 moved");
  await page.getByTestId("owner-pair-pick-b").selectOption("demo:Demo: night shift");
  await page.getByTestId("owner-pair-run").click();
  await expect(page.getByTestId("owner-pair-a-count")).toHaveAttribute("data-escaped", "1");
  await expect(page.getByTestId("owner-pair-b-count")).toHaveAttribute("data-escaped", "7");
  await expect(page.getByTestId("owner-pair-change")).toHaveText(["C2 moved from the Dock Corridor to the Freight Lift Lobby"]);
  await expect(page.getByTestId("owner-pair-delta")).toContainText("6 more got out");
});

test("after the Chief's fix, the route and the detector card follow the side the board shows", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/b/F1/owner?m=romaine-1974");
  await expect(page.getByTestId("owner-board")).toBeVisible();
  await page.getByTestId("owner-run").click();
  await expect(page.getByTestId("owner-count")).toHaveAttribute("data-escaped", "17");
  await page.getByTestId("owner-ask-fix").click();
  await page.getByTestId("owner-apply").click();
  await expect(page.getByTestId("owner-after-count")).toHaveAttribute("data-escaped", "0");

  // After (the default): no way out, under a heading that names the side.
  await expect(page.getByTestId("owner-route")).toHaveAttribute("data-side", "after");
  await expect(page.getByTestId("owner-route")).toHaveAttribute("data-count", "0");
  await expect(page.getByTestId("owner-route")).toContainText("No crew got out");
  await expect(page.locator("#owner-route-label")).toHaveText("After the fix: The way most got out");

  // Before: the 14 crews' way out, and the card names the detector the board rings.
  await page.getByTestId("owner-side-before").click();
  await expect(page.getByTestId("owner-route")).toHaveAttribute("data-side", "before");
  await expect(page.getByTestId("owner-route")).toHaveAttribute("data-count", "14");
  await expect(page.getByTestId("owner-detector")).toHaveAttribute("data-side", "before");
  const ringed = await page.getByTestId("owner-detector-ring").getAttribute("data-detector");
  await expect(page.getByTestId("owner-detector")).toHaveAttribute("data-detector", ringed!);
});

test("the editor adds a night cleaner and moves it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/b/F1/owner");
  await expect(page.getByTestId("owner-board")).toBeVisible();

  await page.getByTestId("owner-tool").locator('[data-value="cleaner"]').click();
  await page.locator('[data-owner-node="o-west"]').click({ force: true });
  // F1 already has a generated cleaner, K1 (#41): the owner's is the next id.
  await expect(page.getByTestId("owner-inspector")).toHaveAttribute("data-selected", "cleaner:K2");
  await expect(page.getByTestId("owner-setup-counts")).toContainText("2 cleaners");
  await expect(page.getByTestId("owner-selected-ring")).toHaveAttribute("data-node", "o-west");

  // Move it to a corridor node: it stays there, and the setup still plays.
  await page.getByTestId("owner-move").click();
  await page.locator('[data-owner-node="mc-2"]').click({ force: true });
  await expect(page.getByTestId("owner-selected-ring")).toHaveAttribute("data-node", "mc-2");
  await expect(page.getByTestId("owner-problems-none")).toBeVisible();
  await expect(page.getByTestId("owner-run")).toBeEnabled();
  await shot(page, "editor-cleaner");
});
