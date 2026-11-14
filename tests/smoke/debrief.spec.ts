import { expect, test, type Page } from "@playwright/test";

// The Debrief screen (SPEC §2 beat 6, issue #22), on the production build in
// fake mode: a run played on /b/F1/run, then its debrief. Every figure and
// line is checked against the log the run left in storage.

interface LoggedTurn {
  turn: number;
  player: { kind: string; nodeId: string };
  guards: { guardId: string; nodeId: string }[];
  alarm: string;
  chief?: { rationale: string; orders: { guardId: string }[]; lockZones: string[] };
  chiefSource?: string;
}
interface Log {
  status: string;
  turns: LoggedTurn[];
  alarmEvents: { turn: number; to: string; cause: { kind: string; id?: string } }[];
  lateChief?: { turn: number; chief: { rationale: string; orders: { guardId: string }[]; lockZones: string[] }; chiefSource?: string };
}

const choice = (page: Page, nodeId: string) => page.locator(`[data-testid="choice"][data-node="${nodeId}"]`);
const banner = (page: Page) => page.getByTestId("alarm-banner");
const storedLog = (page: Page): Promise<Log> =>
  page.evaluate(() => JSON.parse(localStorage.getItem("heist:run-log:F1") ?? "null"));

async function openRun(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/b/F1/run");
  await expect(page.getByTestId("run-board")).toBeVisible();
}

async function pressFor(page: Page, nodeId: string) {
  const key = await choice(page, nodeId).getAttribute("data-key");
  expect(key, `${nodeId} is numbered`).toMatch(/^[1-9]$/);
  await page.keyboard.press(key!);
}

async function toDebrief(page: Page) {
  await page.getByRole("link", { name: "See the debrief" }).click();
  await expect(page).toHaveURL(/\/b\/F1\/debrief$/, { timeout: 15_000 });
  await expect(page.getByTestId("replay-board")).toBeVisible();
}

/** Each stat's figure, by name, and that it is set in tabular figures. */
async function stats(page: Page): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const stat of await page.getByTestId("debrief-stat").all()) {
    const value = stat.getByTestId("debrief-stat-value");
    expect(await value.evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain("tabular-nums");
    out[(await stat.getAttribute("data-stat"))!] = (await value.textContent())!.trim();
  }
  return out;
}

async function scrubTo(page: Page, frame: number) {
  await page.getByTestId("replay-slider").fill(String(frame));
  await expect(page.getByTestId("replay-board")).toHaveAttribute("data-frame", String(frame));
}

/** Every piece stands where the log puts it after `frame` turns (frame 0: the level's start). */
async function expectPiecesAt(page: Page, log: Log, frame: number) {
  if (frame === 0) {
    await expect(page.getByTestId("player-piece")).toHaveAttribute("data-node", "fl-car");
    return;
  }
  const t = log.turns[frame - 1];
  await expect(page.getByTestId("player-piece")).toHaveAttribute("data-node", t.player.nodeId);
  await expect(page.getByTestId("guard-piece")).toHaveCount(t.guards.length);
  for (const g of t.guards) {
    await expect(page.locator(`[data-testid="guard-piece"][data-id="${g.guardId}"]`), `${g.guardId} on frame ${frame}`).toHaveAttribute(
      "data-node",
      g.nodeId,
    );
  }
}

test("with no run in storage, the debrief offers to start the run", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/b/F1/debrief");
  const empty = page.getByTestId("debrief-empty");
  await expect(empty).toContainText("There's no run to debrief yet.");
  await empty.getByRole("link", { name: "Start the run" }).click();
  await expect(page).toHaveURL(/\/b\/F1\/run$/);
});

test("beat 5 to 6: caught after the wow beat, the debrief says so, with the Chief's decision", async ({ page }) => {
  await openRun(page);
  await pressFor(page, "fl-lobby");
  await pressFor(page, "dc-west");
  await expect(banner(page)).toHaveAttribute("data-state", "alert");
  await expect(page.getByTestId("chief-rationale")).toHaveAttribute("data-done", "true", { timeout: 4_000 });
  // Every Chief answer the Run screen shows, by its alarm event's number.
  const panel = page.getByTestId("chief-panel");
  const shown = new Map<string, string>();
  const noteShown = async () => {
    if ((await panel.getAttribute("data-state")) !== "ready") return;
    const rationale = page.getByTestId("chief-rationale");
    await expect(rationale).toHaveAttribute("data-done", "true", { timeout: 4_000 });
    shown.set((await panel.getAttribute("data-seq"))!, (await page.getByTestId("chief-rationale").textContent())!);
  };
  await noteShown();
  for (let i = 0; i < 12 && (await page.getByTestId("run-outcome").count()) === 0; i++) {
    await page.keyboard.press("w");
    await noteShown();
  }
  await expect(page.getByTestId("run-outcome")).toHaveAttribute("data-status", "caught");
  // C2's second sighting (Lockdown) is on the catching turn: its answer streams in after the run ended.
  const events = (await storedLog(page)).alarmEvents;
  expect(events.at(-1)!.to).toBe("lockdown");
  await expect(panel).toHaveAttribute("data-seq", String(events.length - 1), { timeout: 6_000 });
  await expect(panel).toHaveAttribute("data-state", "ready", { timeout: 6_000 });
  await noteShown();
  // The panel says that answer came too late: its rows are listed as not applied, never as orders the guards took.
  await expect(panel).toHaveAttribute("data-late", "true");
  await expect(panel.getByTestId("chief-late-chip")).toHaveText("After the end");
  await expect(panel.getByTestId("chief-late")).toHaveText("Arrived after the run ended. None of these orders reached the guards.");
  const lateRows = panel.getByTestId("chief-order");
  expect(await lateRows.count()).toBeGreaterThan(0);
  for (const row of await lateRows.all()) await expect(row).toHaveAttribute("data-late", "true");
  expect(await panel.locator(".text-danger").count()).toBe(0);
  expect([...shown.keys()].sort()).toEqual(events.map((_, i) => String(i)));
  await expect.poll(async () => (await storedLog(page)).lateChief?.chief.rationale ?? null).toBe(shown.get(String(events.length - 1)));
  const log = await storedLog(page);
  expect(log.status).toBe("caught");

  await toDebrief(page);
  const last = log.turns.at(-1)!;
  const catchers = last.guards.filter((g) => g.nodeId === last.player.nodeId).map((g) => g.guardId);
  expect(catchers.length).toBeGreaterThan(0);

  // The outcome, and what caught the player.
  await expect(page.getByTestId("debrief-outcome")).toHaveAttribute("data-status", "caught");
  await expect(page.getByTestId("debrief-grade")).toHaveText("D");
  await expect(page.getByTestId("debrief-headline")).toHaveText(/^Caught in the .+\.$/);
  const detail = page.getByTestId("debrief-detail");
  await expect(detail).toContainText("C2 saw you in the Dock Corridor on turn 2.");
  await expect(detail).toContainText(`reached you on turn ${log.turns.length}.`);
  for (const id of catchers) await expect(detail).toContainText(id);

  // Three stats, in tabular figures, from the log.
  const detections = log.alarmEvents.filter((e) => e.cause.kind !== "decay").length;
  const noise = log.turns.filter((t) => t.player.kind === "pick" || t.player.kind === "sprint").length;
  expect(await stats(page)).toEqual({ turns: String(log.turns.length), noise: String(noise), detections: String(detections) });

  // What the Security Chief did: every answer the Run screen showed, the late one last and marked as late.
  const decided = log.turns.filter((t) => t.chief);
  expect(decided.length).toBeGreaterThan(0);
  const items = page.getByTestId("chief-decision");
  await expect(items).toHaveCount(shown.size);
  await expect(page.locator("#chief-timeline-label + p")).toHaveText(`${shown.size} decisions`);
  for (const [i, t] of decided.entries()) {
    const item = items.nth(i);
    await expect(item).toHaveAttribute("data-turn", String(t.turn));
    await expect(item).not.toHaveAttribute("data-late", /.*/);
    await expect(item.getByTestId("chief-decision-rationale")).toHaveText(t.chief!.rationale);
    await expect(item.getByTestId("chief-decision-order")).toHaveCount(t.chief!.orders.length + t.chief!.lockZones.length);
    expect(t.chiefSource).toBe("recorded");
    await expect(item.getByTestId("chief-decision-source")).toHaveText("Recorded");
    await expect(item.getByTestId("chief-decision-late")).toHaveCount(0);
  }
  const late = items.nth(decided.length);
  await expect(late).toHaveAttribute("data-late", "true");
  await expect(late).toHaveAttribute("data-turn", String(log.turns.length));
  await expect(late.getByTestId("chief-decision-rationale")).toHaveText(shown.get(String(events.length - 1))!);
  await expect(late.getByTestId("chief-decision-late-chip")).toHaveText("After the end");
  await expect(late.getByTestId("chief-decision-late")).toHaveText("Arrived after the run ended. None of these orders reached the guards.");
  await expect(late.getByTestId("chief-decision-source")).toHaveText("Recorded");
  expect(log.lateChief!.chiefSource).toBe("recorded");

  // The replay opens on the catch; scrubbing moves every piece to that turn's positions.
  await expect(page.getByTestId("replay-board")).toHaveAttribute("data-frame", String(log.turns.length));
  await expectPiecesAt(page, log, log.turns.length);
  for (const frame of [0, 1, 2, 4, log.turns.length]) {
    await scrubTo(page, frame);
    await expectPiecesAt(page, log, frame);
  }
  await expect(page.getByTestId("replay-alarm")).toHaveAttribute("data-state", last.alarm);

  // A decision on the timeline scrubs the replay to its turn.
  await items.first().getByRole("button").click();
  await expect(page.getByTestId("replay-board")).toHaveAttribute("data-frame", String(decided[0].turn));
  await expect(page.getByTestId("replay-slider")).toHaveValue(String(decided[0].turn));

  // The heist ends here (#113): no hand-over to the drill, and Try again opens a fresh run.
  await expect(page.getByRole("link", { name: "Run the drill" })).toHaveCount(0);
  await expect(page.getByTestId("try-again-line")).toHaveText("Same floor, same rounds. Try another way in.");
  await expect(page.getByTestId("debrief-to-map")).toHaveAttribute("href", "/");
  await page.getByTestId("debrief-try-again").click();
  await expect(page).toHaveURL(/\/b\/F1\/run$/, { timeout: 15_000 });
  await expectFreshRun(page);
  await expect(page.getByTestId("player-piece")).toHaveAttribute("data-node", "fl-car");
  await railToDebrief(page);
  await expectNotStarted(page);
});

test("opened from the step rail mid-run, after the Chief's answer, the debrief lists it and claims no end", async ({ page }) => {
  await openRun(page);
  await pressFor(page, "fl-lobby");
  await pressFor(page, "dc-west");
  const rationale = page.getByTestId("chief-rationale");
  await expect(rationale).toHaveAttribute("data-done", "true", { timeout: 4_000 });
  const answered = (await rationale.textContent())!;
  // Mid-run, the answer is applied: nothing marks it late.
  await expect(page.getByTestId("chief-panel")).not.toHaveAttribute("data-late", /.*/);
  await expect(page.getByTestId("chief-late")).toHaveCount(0);
  // The applied orders are in storage now, before any turn's entry carries them.
  await expect.poll(async () => (await storedLog(page)).turns.length).toBe(2);
  const pending = await page.evaluate(() => JSON.parse(localStorage.getItem("heist:run-log:F1") ?? "null").pendingChief);
  expect(pending).toMatchObject({ turn: 2, chief: { rationale: answered }, chiefSource: "recorded" });

  await page.getByRole("navigation", { name: "Steps" }).getByRole("link", { name: "Debrief", exact: true }).click();
  await expect(page).toHaveURL(/\/b\/F1\/debrief$/, { timeout: 15_000 });
  const outcome = page.getByTestId("debrief-outcome");
  await expect(outcome).toHaveAttribute("data-status", "playing");
  await expect(outcome).toContainText("Run not finished");
  await expect(page.getByTestId("debrief-grade")).toHaveAttribute("data-grade", "");
  await expect(page.getByTestId("debrief-grade-reason")).toHaveText("The run isn't over, so there's no grade yet.");
  await expect(page.locator("#chief-timeline-label + p")).toHaveText("1 decision");
  await expect(page.getByTestId("chief-none")).toHaveCount(0);
  const decision = page.getByTestId("chief-decision");
  await expect(decision).toHaveCount(1);
  await expect(decision).toHaveAttribute("data-turn", "2");
  await expect(decision).not.toHaveAttribute("data-late", /.*/);
  await expect(decision.getByTestId("chief-decision-rationale")).toHaveText(answered);
  await expect(decision.getByTestId("chief-decision-source")).toHaveText("Recorded");
  for (const said of ["run ended", "never re-planned", "Caught", "Clean exit"]) await expect(page.locator("main")).not.toContainText(said);

  // The Run screen keeps no run it was left on: the link starts it over. Play it to the catch.
  await page.getByTestId("debrief-run-again").click();
  await expect(page).toHaveURL(/\/b\/F1\/run$/, { timeout: 15_000 });
  await expect(page.getByTestId("run-board")).toBeVisible();
  await pressFor(page, "fl-lobby");
  await pressFor(page, "dc-west");
  await expect(page.getByTestId("chief-rationale")).toHaveAttribute("data-done", "true", { timeout: 4_000 });
  for (let i = 0; i < 12 && (await page.getByTestId("run-outcome").count()) === 0; i++) await page.keyboard.press("w");
  await expect(page.getByTestId("run-outcome")).toHaveAttribute("data-status", "caught");
  await expect.poll(async () => (await storedLog(page)).lateChief?.turn ?? null, { timeout: 6_000 }).not.toBeNull();
  const log = await storedLog(page);
  expect(log.status).toBe("caught");
  expect(log).not.toHaveProperty("pendingChief");

  await toDebrief(page);
  await expect(outcome).toHaveAttribute("data-status", "caught");
  await expect(page.getByTestId("debrief-grade")).toHaveText("D");
  await expect(page.locator("#chief-timeline-label + p")).toHaveText("2 decisions");
  await expect(decision).toHaveCount(2);
  await expect(decision.nth(0)).toHaveAttribute("data-turn", "2");
  await expect(decision.nth(0)).not.toHaveAttribute("data-late", /.*/);
  await expect(decision.nth(0).getByTestId("chief-decision-rationale")).toHaveText(log.turns[2].chief!.rationale);
  await expect(decision.nth(1)).toHaveAttribute("data-late", "true");
  await expect(decision.nth(1)).toHaveAttribute("data-turn", String(log.turns.length));
  await expect(decision.nth(1).getByTestId("chief-decision-rationale")).toHaveText(log.lateChief!.chief.rationale);
  await expect(page.getByTestId("debrief-run-again")).toHaveCount(0);
});

/** The Debrief, opened from the step rail. */
async function railToDebrief(page: Page) {
  await page.getByRole("navigation", { name: "Steps" }).getByRole("link", { name: "Debrief", exact: true }).click();
  await expect(page).toHaveURL(/\/b\/F1\/debrief$/, { timeout: 15_000 });
}

/** The board is on turn 0, and the log in storage is that run's: no turns, nothing pending, nothing late. */
async function expectFreshRun(page: Page) {
  await expect(page.getByTestId("run-board")).toBeVisible();
  await expect(page.getByTestId("turn")).toHaveText("0");
  await expect.poll(async () => storedLog(page)).toEqual({
    buildingId: "F1",
    missionId: expect.any(String),
    seed: 7,
    turns: [],
    status: "playing",
    alarmEvents: [],
  });
}

/** The Debrief has no run to show: the one on the board hasn't had a turn, so nothing of the last run is said. */
async function expectNotStarted(page: Page) {
  const empty = page.getByTestId("debrief-empty");
  await expect(empty).toHaveAttribute("data-reason", "not-started");
  await expect(empty).toContainText("The run on the board hasn't started yet.");
  await expect(page.getByTestId("debrief-outcome")).toHaveCount(0);
  for (const said of ["Caught", "Run not finished", "played so far", "decision"]) await expect(page.locator("main")).not.toContainText(said);
}

test("Restart after a capture, before the late answer lands: the log is the new run's, and the debrief says it hasn't started", async ({ page }) => {
  await openRun(page);
  await pressFor(page, "fl-lobby");
  await pressFor(page, "dc-west");
  for (let i = 0; i < 12 && (await page.getByTestId("run-outcome").count()) === 0; i++) await page.keyboard.press("w");
  await expect(page.getByTestId("run-outcome")).toHaveAttribute("data-status", "caught");
  // Restart at once: the Chief's answer to the catching turn's sighting is still out, and never lands on the new run.
  await page.getByRole("button", { name: "Restart" }).click();
  await expectFreshRun(page);
  await expect(page.getByTestId("chief-panel")).toHaveAttribute("data-state", "idle");
  await page.waitForTimeout(3_000);
  await expectFreshRun(page);
  await expect(page.getByTestId("chief-panel")).toHaveAttribute("data-state", "idle");

  await railToDebrief(page);
  await expectNotStarted(page);
  // Its link goes back to the run, and a first move makes it a run the debrief shows.
  await page.getByTestId("debrief-empty").getByRole("link", { name: "Back to the run" }).click();
  await expectFreshRun(page);
  await pressFor(page, "fl-lobby");
  await expect.poll(async () => (await storedLog(page)).turns.length).toBe(1);
  await railToDebrief(page);
  await expect(page.getByTestId("debrief-outcome")).toHaveAttribute("data-status", "playing");
  await expect(page.getByTestId("debrief-detail")).toHaveText("1 turn played so far.");
});

test('"Start the run over" from a mid-run debrief: the debrief opened next shows the new run, not the one left', async ({ page }) => {
  await openRun(page);
  await pressFor(page, "fl-lobby");
  await pressFor(page, "dc-west");
  await expect.poll(async () => (await storedLog(page)).turns.length).toBe(2);
  await railToDebrief(page);
  await expect(page.getByTestId("debrief-detail")).toContainText("2 turns played so far.");
  // A run left mid-way has no Try again: "Start the run over" says what the link does.
  await expect(page.getByTestId("debrief-try-again")).toHaveCount(0);
  await expect(page.getByTestId("try-again-line")).toHaveCount(0);
  await expect(page.getByTestId("debrief-to-map")).toHaveAttribute("href", "/");

  await page.getByTestId("debrief-run-again").click();
  await expect(page).toHaveURL(/\/b\/F1\/run$/, { timeout: 15_000 });
  await expectFreshRun(page);
  await railToDebrief(page);
  await expectNotStarted(page);
});

test("a fresh visit to the Run screen replaces a finished run's log with its own", async ({ page }) => {
  await openRun(page);
  await pressFor(page, "fl-lobby");
  await pressFor(page, "dc-west");
  for (let i = 0; i < 12 && (await page.getByTestId("run-outcome").count()) === 0; i++) await page.keyboard.press("w");
  await expect(page.getByTestId("run-outcome")).toHaveAttribute("data-status", "caught");
  await expect.poll(async () => (await storedLog(page)).status).toBe("caught");

  await page.goto("/b/F1/run");
  await expectFreshRun(page);
  await page.goto("/b/F1/debrief");
  await expectNotStarted(page);
});

test("the quiet route to a clean exit: the debrief grades it S, never seen, with no Chief decision", async ({ page }) => {
  await openRun(page);
  const pick = async () => {
    const key = await page.locator('[data-testid="choice"][data-kind="pick"]').getAttribute("data-key");
    await page.keyboard.press(key!);
  };
  await pressFor(page, "fl-lobby");
  await page.keyboard.press("w");
  for (const node of ["dc-west", "dc-mid", "dc-east"]) await pressFor(page, node);
  await pick();
  await pick();
  await pressFor(page, "rr-door");
  await pressFor(page, "rr-files");
  await page.keyboard.press(" ");
  await pressFor(page, "rr-door");
  await pressFor(page, "dc-east");
  await page.keyboard.press("w");
  for (const node of ["dc-mid", "dc-west", "fl-lobby", "fl-car"]) await pressFor(page, node);
  await expect(page.getByTestId("run-outcome")).toHaveAttribute("data-status", "won");
  const log = await storedLog(page);
  expect(log.status).toBe("won");
  expect(log.alarmEvents).toEqual([]);

  await toDebrief(page);
  await expect(page.getByTestId("debrief-outcome")).toHaveAttribute("data-status", "won");
  await expect(page.getByTestId("debrief-grade")).toHaveText("S");
  await expect(page.getByTestId("debrief-headline")).toHaveText("Out with the files.");
  await expect(page.getByTestId("debrief-detail")).toHaveText(/^Out through the .+ in 17 turns, never seen\.$/);
  await expect(page.getByTestId("debrief-grade-reason")).toHaveText("Never seen, and on par: 17 turns.");
  expect(await stats(page)).toEqual({ turns: "17", noise: "2", detections: "0" });
  await expect(page.getByTestId("chief-decision")).toHaveCount(0);
  await expect(page.getByTestId("chief-none")).toHaveText("The alarm never moved, so the Chief never re-planned.");
  // On par already: the line asks for another way out, never to beat par (par is the shortest quiet route).
  await expect(page.getByTestId("try-again-line")).toHaveText("Clean exit. Run it again by a different way out.");
  await expect(page.getByTestId("debrief-try-again")).toHaveAttribute("href", "/b/F1/run");

  for (const frame of [0, 9, 10, 17]) {
    await scrubTo(page, frame);
    await expectPiecesAt(page, log, frame);
  }
});
