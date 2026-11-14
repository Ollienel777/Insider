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

  await page.keyboard.press("1");
  // The player's hop takes --t-base; each guard's hop takes --t-slow and waits for it. Read at once,
  // while the hops run.
  const hops = await board(page).evaluate((svg) => {
    const timing = (el: Element) =>
      el.getAnimations().map((a) => {
        const t = a.effect!.getTiming();
        return `${t.duration}+${t.delay}`;
      });
    const pieces = [...svg.querySelectorAll('[data-testid="player-piece"], [data-testid="guard-piece"]')];
    return Object.fromEntries(pieces.map((el) => [el.getAttribute("data-id"), timing(el).join(" ")]));
  });
  expect(hops).toEqual({ You: "200+0", G1: "300+200", G2: "300+200", G3: "", G4: "" });
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
  // The two cameras, the four guards and K1, the night cleaner in the occupied suites (#95).
  await expect(page.locator('[data-testid="cone"]')).toHaveCount(7);
  for (const id of ["C1", "C2", "G1", "G2", "G3", "G4", "K1"]) {
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
  await expect(page.getByTestId("guard-route").first()).toBeVisible();
});

test("beat 5, the wow: the Chief's re-plan streams in within 4 s, and the guards take its routes", async ({ page }) => {
  await open(page);
  const chief = page.getByTestId("chief-panel");
  await expect(chief).toHaveAttribute("data-state", "idle");
  await pressFor(page, "fl-lobby");
  await pressFor(page, "dc-west");
  await expect(banner(page)).toHaveAttribute("data-state", "alert");

  // The rationale streams in, names a guard and a zone, and says no model ran.
  const rationale = page.getByTestId("chief-rationale");
  await expect(rationale).toContainText(/\w/, { timeout: 4_000 });
  await expect(rationale).toHaveAttribute("data-done", "true", { timeout: 4_000 });
  await expect(rationale).toContainText(/\bG\d\b/);
  await expect(rationale).toContainText(/dock corridor/i);
  await expect(page.getByTestId("chief-recorded-chip")).toHaveText("Recorded");
  await expect(page.getByTestId("chief-source-note")).toHaveText("Recorded orders: no model was called.");

  // Each order row is the route the board now draws for that guard.
  const rows = page.getByTestId("chief-order");
  await expect(rows).toHaveCount(4);
  const routes: Record<string, string[]> = {};
  for (const row of await rows.all()) {
    const guard = (await row.getAttribute("data-guard"))!;
    const intent = (await row.getAttribute("data-intent"))!;
    const route = page.locator(`[data-testid="guard-route"][data-guard="${guard}"]`);
    await expect(route, guard).toHaveAttribute("data-intent", intent);
    routes[guard] = (await route.getAttribute("data-nodes"))!.split(" ");
  }
  expect(routes.G2.at(-1)).toMatch(/^rr-/);
  await expect(page.locator('[data-testid="guard-orders"] li[data-guard="G2"]')).toHaveAttribute("data-intent", "hold");
  await expect(page.getByTestId("chief-lock")).toContainText("Records room");

  // The next turn, every ordered guard steps onto its route's next node.
  await page.keyboard.press("w");
  await expect(page.getByTestId("turn")).toHaveText("3");
  for (const [guard, path] of Object.entries(routes)) {
    await expect(page.locator(`[data-testid="guard-piece"][data-id="${guard}"]`), guard).toHaveAttribute("data-node", path[1]);
  }

  // Stay put and the guards close in: caught on your own node.
  for (let i = 0; i < 8 && (await page.getByTestId("run-outcome").count()) === 0; i++) await page.keyboard.press("w");
  await expect(page.getByTestId("run-outcome")).toHaveAttribute("data-status", "caught");
});

test("beat 5: the guards keep moving while the Chief's call is out", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/chief", async (route) => {
    await held;
    await route.continue();
  });
  await open(page);
  await pressFor(page, "fl-lobby");
  await pressFor(page, "dc-west");
  await expect(page.getByTestId("chief-panel")).toHaveAttribute("data-state", "pending");
  await expect(page.getByTestId("chief-skeleton")).toBeVisible();

  // No turn waits on it: the player steps back, and the guards converge on where C2 saw them.
  const before = await guardNodes(page);
  await pressFor(page, "fl-lobby");
  await expect(page.getByTestId("turn")).toHaveText("3");
  expect(await guardNodes(page)).not.toEqual(before);
  await expect(page.locator('[data-testid="guard-orders"] li[data-intent="converge"]')).toHaveCount(4);
  await expect(page.getByTestId("chief-panel")).toHaveAttribute("data-state", "pending");

  release();
  await expect(page.getByTestId("chief-rationale")).toHaveAttribute("data-done", "true", { timeout: 4_000 });
});

test("beats 4 to 5: the plan briefed on the Plan screen is the plan on the run", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/b/F1/plan");
  await page.getByTestId("crew-order").fill("Go in through the dock, wait for the 2 am round to pass, take the records room.");
  await page.getByRole("button", { name: "Brief the crew" }).click();
  await expect(page.getByTestId("crew-reply")).toBeVisible();
  await page.getByRole("link", { name: "Start the run" }).click();
  await expect(board(page)).toBeVisible();
  const plan = page.getByTestId("plan");
  await expect(plan).toHaveAttribute("data-source", "crew");
  await expect(page.locator("#plan-label")).toHaveText("The crew's plan");
  await expect(plan.locator("li")).toHaveCount(4);
  await expect(plan.locator('li[data-state="next"]')).toHaveText(/Wait one turn at the freight lift/);
  await pressFor(page, "fl-lobby");
  await page.keyboard.press("w");
  await expect(plan.locator('li[data-state="next"]')).toHaveText(/take the files/);
});

test("the crew's quiet route plays by keys to a clean exit, then offers the debrief", async ({ page }) => {
  // It plays the quiet route by keys, then opens the debrief: 1.0 s alone, 4.5 s
  // with the gate pinned to one CPU, and up to 31 s in a full smoke run on the
  // loaded 2-vCPU VM, against the 30 s default (#85). 60 s is about twice the
  // worst seen; a broken step still fails on its own wait, not on this.
  test.setTimeout(60_000);
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
  const runLog = await page.evaluate(() => JSON.parse(localStorage.getItem("heist:run-log:F1:romaine-1974") ?? "null"));
  expect(runLog.turns).toHaveLength(17);
  await page.getByRole("link", { name: "See the debrief" }).click();
  await expect(page).toHaveURL(/\/b\/F1\/debrief\?m=romaine-1974$/, { timeout: 15_000 });
});

test("Restart puts the run back at the start", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("button", { name: "Restart" })).toBeDisabled();
  await pressFor(page, "fl-lobby");
  await pressFor(page, "dc-west");
  await expect(banner(page)).toHaveAttribute("data-state", "alert");
  await page.getByRole("button", { name: "Restart" }).click();
  await expect(banner(page)).toHaveAttribute("data-state", "calm");
  await expect(page.getByTestId("chief-panel")).toHaveAttribute("data-state", "idle");
  await expect(page.getByTestId("turn")).toHaveText("0");
  await expect(player(page)).toHaveAttribute("data-node", "fl-car");
  // The number keys still play with the focus left on Restart.
  await page.keyboard.press("1");
  await expect(player(page)).toHaveAttribute("data-node", "fl-lobby");
});

test("every guard that moves hops, also when the board redraws its pieces in a new order (#68)", async ({ page }) => {
  await open(page);
  // The quiet route: on it the player and the guards pass each other, so the board, which draws
  // its pieces back to front, puts some of them in a new place in the document.
  const route = ["fl-lobby", "w", "dc-west", "dc-mid", "dc-east", "rr-door", "rr-door", "rr-door", "rr-files"];
  let reordered = 0;
  for (const [i, step] of route.entries()) {
    const key = step === "w" ? "w" : (await choice(page, step).getAttribute("data-key"))!;
    const before = await board(page).evaluate((svg) =>
      [...svg.querySelectorAll('[data-testid="guard-piece"], [data-testid="player-piece"]')].map((el) => `${el.getAttribute("data-id")}@${el.getAttribute("data-node")}`),
    );
    await page.keyboard.press(key);
    // Read at once, while the hops run (a guard's hop is over 500 ms after the key).
    const after = await board(page).evaluate((svg) => {
      const hit = (id: string) => svg.querySelector(`[data-why-target="guard:${id}"]`)!;
      return [...svg.querySelectorAll('[data-testid="guard-piece"], [data-testid="player-piece"]')].map((el) => {
        const id = el.getAttribute("data-id")!;
        return {
          id,
          at: `${id}@${el.getAttribute("data-node")}`,
          hopping: el.getAnimations().length > 0,
          hitHopping: id === "You" ? true : hit(id).getAnimations().length > 0,
        };
      });
    });
    await expect(board(page)).toHaveAttribute("data-turn", String(i + 1));
    const order = (list: string[]) => list.map((s) => s.split("@")[0]).join(" ");
    if (order(before) !== order(after.map((a) => a.at))) reordered += 1;
    for (const piece of after.filter((a) => !before.includes(a.at))) {
      expect(piece.hopping, `${piece.id} hops on ${step}`).toBe(true);
      expect(piece.hitHopping, `${piece.id}'s hit area hops on ${step}`).toBe(true);
    }
    await page.waitForTimeout(550);
  }
  // The route is a real test of the reorder only if the order changed on it.
  expect(reordered).toBeGreaterThan(0);
});

test("after Restart, the Chief's answer streams in from its first word, never shown whole first (#68)", async ({ page }) => {
  await open(page);
  const rationale = page.getByTestId("chief-rationale");
  await pressFor(page, "fl-lobby");
  await pressFor(page, "dc-west");
  await expect(rationale).toHaveAttribute("data-done", "true", { timeout: 4_000 });
  await page.getByRole("button", { name: "Restart" }).click();
  await expect(page.getByTestId("chief-panel")).toHaveAttribute("data-state", "idle");

  // Every state the rationale is drawn in, as the DOM changes, from here on.
  await page.getByTestId("chief-panel").evaluate((panel) => {
    const seen: string[] = [];
    (window as unknown as { rationaleSeen: string[] }).rationaleSeen = seen;
    new MutationObserver(() => {
      const el = panel.querySelector('[data-testid="chief-rationale"]');
      const state = el ? `${el.getAttribute("data-done")}:${el.textContent!.split(/\s+/).filter(Boolean).length}` : "none";
      if (seen.at(-1) !== state) seen.push(state);
    }).observe(panel, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  await page.keyboard.press("1");
  await expect(page.getByTestId("turn")).toHaveText("1");
  await pressFor(page, "dc-west");
  await expect(rationale).toHaveAttribute("data-done", "true", { timeout: 4_000 });
  const seen = await page.evaluate(() => (window as unknown as { rationaleSeen: string[] }).rationaleSeen);
  const drawn = seen.filter((s) => s !== "none");
  expect(drawn[0], seen.join(" → ")).toMatch(/^false:/);
  expect(drawn.findIndex((s) => s.startsWith("true:")), seen.join(" → ")).toBe(drawn.length - 1);
});

test("a building with no level yet says so and offers the map", async ({ page }) => {
  await page.goto("/b/F2/run");
  await expect(page.getByTestId("board-empty")).toContainText("This building's level isn't ready yet.");
  await page.getByRole("link", { name: "Back to the map" }).click();
  await expect(page).toHaveURL(/\/map$/);
});

test("S sprints: the numbers mark nodes two hops on, a click sprints there in one turn, and the board walks again (#121)", async ({ page }) => {
  await open(page);
  const hint = page.getByTestId("sprint-hint");
  const choices = page.getByTestId("choice");
  await expect(hint).not.toHaveAttribute("data-on", /.*/);
  await expect(choices).toHaveCount(1);
  await expect(choices.first()).toHaveAttribute("data-kind", "move");

  // S on: the start's only sprint is on through the freight lift lobby to the dock corridor.
  await page.keyboard.press("s");
  await expect(hint).toHaveAttribute("data-on", "true");
  await expect(hint).toContainText("sprinting");
  await expect(page.getByTestId("run-status")).toContainText("Sprinting");
  await expect(choices).toHaveCount(1);
  await expect(choices.first()).toHaveAttribute("data-kind", "sprint");
  await expect(choices.first()).toHaveAttribute("data-node", "dc-west");
  await expect(choices.first()).toHaveAttribute("aria-label", /^Sprint to /);
  await page.screenshot({ path: "test-results/run-sprint/sprint-mode.png" });

  // Esc walks again, and S comes back on.
  await page.keyboard.press("Escape");
  await expect(hint).not.toHaveAttribute("data-on", /.*/);
  await expect(choices.first()).toHaveAttribute("data-node", "fl-lobby");
  await page.keyboard.press("S");
  await expect(choices.first()).toHaveAttribute("data-kind", "sprint");

  // A click on the badge sprints: two hops, one turn, and the board is walking again.
  await choices.first().click();
  await expect(page.getByTestId("turn")).toHaveText("1");
  await expect(player(page)).toHaveAttribute("data-node", "dc-west");
  await expect(page.getByTestId("run-status")).toHaveText("You sprint to the Dock Corridor.");
  await expect(hint).not.toHaveAttribute("data-on", /.*/);
  for (const c of await choices.all()) await expect(c).not.toHaveAttribute("data-kind", "sprint");
  const kind = await page.evaluate(() => JSON.parse(localStorage.getItem("heist:run-log:F1:romaine-1974") ?? "null")?.turns?.at(-1)?.player?.kind);
  expect(kind).toBe("sprint");
});

test("in sprint mode, Esc with a Why card open closes only the card; the next Esc walks (#121)", async ({ page }) => {
  await open(page);
  const hint = page.getByTestId("sprint-hint");
  await page.keyboard.press("s");
  await expect(hint).toHaveAttribute("data-on", "true");
  await page.locator('[data-why-target="guard:G4"]').click();
  await expect(page.getByTestId("why-card")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("why-card")).toHaveCount(0);
  await expect(hint).toHaveAttribute("data-on", "true");
  await expect(page.getByTestId("choice").first()).toHaveAttribute("data-kind", "sprint");
  await page.keyboard.press("Escape");
  await expect(hint).not.toHaveAttribute("data-on", /.*/);
});
