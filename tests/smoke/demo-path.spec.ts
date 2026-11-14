import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

// The demo path (SPEC §2, §6 step 6, issues #25 and #113): one walk from the
// map to the Debrief and back into a fresh run (Drill Mode is on hold and
// keeps its own spec), on the production build in fake mode, the way the presenter
// drives it, at the demo's 1440×900. Each beat waits on what the judge sees,
// asserts it, and saves a screenshot to test-results/demo-path/. The
// per-screen specs cover each screen's details; this one proves the screens
// hand over to each other and the path holds end to end.

interface LoggedTurn {
  turn: number;
  player: { kind: string; nodeId: string };
  guards: { guardId: string; nodeId: string }[];
  alarm: string;
  chief?: { rationale: string };
}
interface Log {
  status: string;
  turns: LoggedTurn[];
  alarmEvents: { turn: number; to: string; cause: { kind: string; id?: string } }[];
  lateChief?: { turn: number };
}

// The Casting Director's own reason for F1, from its cached shortlist (#24).
const F1_REASON = (
  JSON.parse(readFileSync(path.join(process.cwd(), "data", "casting", "romaine-1974.json"), "utf8")) as {
    finalists: { id: string; reason: string }[];
  }
).finalists.find((c) => c.id === "F1")!.reason;

const DEMO_ORDER = "Go in through the dock, wait for the 2 am round to pass, take the records room.";

test.use({ viewport: { width: 1440, height: 900 } });

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/demo-path/${name}.png` });
const storedLog = (page: Page): Promise<Log> =>
  page.evaluate(() => JSON.parse(localStorage.getItem("heist:run-log:F1:romaine-1974") ?? "null"));

/** Presses the number the board shows on the neighbour `nodeId`, and waits for the turn it plays. */
async function moveTo(page: Page, nodeId: string) {
  const turn = Number(await page.getByTestId("turn").textContent());
  const key = await page.locator(`[data-testid="choice"][data-node="${nodeId}"]`).getAttribute("data-key");
  expect(key, `${nodeId} is numbered`).toMatch(/^[1-9]$/);
  await page.keyboard.press(key!);
  await expect(page.getByTestId("turn")).toHaveText(String(turn + 1));
  await expect(page.getByTestId("player-piece")).toHaveAttribute("data-node", nodeId);
}

test("the demo path: map to Debrief and Try again on F1, in fake mode", async ({ page }) => {
  // The walk takes about 25-30 s in the gate, and Playwright's default test
  // timeout is 30 s: with another gate on the 2-vCPU VM it ran out at 31-33 s
  // (#82). Its budget is #25's "under 90 seconds on CI". A broken beat still
  // fails on that beat's own outcome wait, not on this.
  test.setTimeout(90_000);
  // Beat 1: the map. Five prepared buildings, three in LA and two in Houston.
  // The mission picker took `/` (#118); #120 walks the new beats 1-2 from it.
  // Until then this walk starts on the map at its new address.
  // The rows stream in a hidden copy before React swaps out the skeleton, and a
  // count also matches that copy: count once the skeleton has gone (#75).
  await page.goto("/map");
  await expect(page.getByTestId("map-skeleton")).toHaveCount(0);
  const rows = page.getByTestId("building-row");
  await expect(rows).toHaveCount(3);
  for (const row of await rows.all()) await expect(row).toBeVisible();
  await page.getByRole("tab", { name: /Houston/ }).click();
  await expect(rows).toHaveText([/Smith Street Center/, /Westchase Commons/]);
  await page.getByRole("tab", { name: /Los Angeles/ }).click();
  await expect(rows).toHaveCount(3);
  await expect(page.getByTestId("map-pin")).toHaveCount(3);
  for (const pin of await page.getByTestId("map-pin").all()) await expect(pin.locator("[data-layer]")).toHaveCount(3);
  const f1 = rows.filter({ hasText: "Halvorsen Tower" });
  await expect(f1).toContainText("Bunker Hill · 1974 · Class A · 42 stories");
  await f1.click();
  await expect(page.locator('[data-testid="map-pin"][data-building="F1"]')).toHaveAttribute("data-selected", "true");
  await shot(page, "beat-1-map");
  await page.getByRole("link", { name: "Scout this building" }).click();

  // Beat 2: Scout. The aerial of the picked building, with its tagged entries.
  await expect(page).toHaveURL(/\/b\/F1\/scout\?m=romaine-1974$/);
  await expect(page.getByTestId("building-slot")).toHaveText("Halvorsen Tower · Los Angeles");
  const canvas = page.getByTestId("aerial-canvas");
  await expect(canvas).toBeVisible();
  const view = page.locator('[data-testid="aerial-view"][data-active="true"]');
  await expect(view.getByTestId("entry-label")).toHaveText(["Loading dock", "Garage ramp", "Main lobby", "Stair B exit", "Roof hatch"]);
  await page.keyboard.press("ArrowRight");
  await expect(canvas).toHaveAttribute("data-view", "E");
  await shot(page, "beat-2-scout");
  await page.getByRole("link", { name: "Plan the job" }).click();

  // Beat 3: the level is built from the data. The replay fills the Data → Level table.
  await expect(page).toHaveURL(/\/b\/F1\/dossier\?m=romaine-1974$/);
  const dossier = page.getByTestId("dossier");
  await expect(dossier).toHaveAttribute("data-done", "true", { timeout: 10_000 });
  const table = page.getByTestId("data-to-level");
  // The table opens with why F1 was cast for the mission (beat 4, #119).
  await expect(table.getByTestId("provenance-row").first()).toHaveAttribute("data-rule", "cast");
  await expect(table.locator('[data-rule="cast"]')).toContainText(`Cast because: ${F1_REASON}`);
  const era = table.locator('[data-rule="era"]');
  await expect(era).toHaveAttribute("data-shown", "true");
  await expect(era).toContainText("1974");
  await expect(era).toContainText("Analog era");
  await expect(table.locator('[data-rule="guards"]')).toContainText("4 guards");
  await expect(table.locator('[data-rule="dock"]')).toContainText("Always offered as a way in and out");
  await expect(page.getByTestId("briefing").getByRole("heading", { name: "The Romaine Street Papers" })).toBeVisible();
  await shot(page, "beat-3-dossier");
  await page.getByRole("link", { name: "Brief the crew" }).click();

  // Beat 4: brief the crew. A numbered plan, a warning naming a camera, the ghost path.
  await expect(page).toHaveURL(/\/b\/F1\/plan\?m=romaine-1974$/);
  await expect(page.getByTestId("plan-board")).toBeVisible();
  await page.getByTestId("crew-order").fill(DEMO_ORDER);
  await page.getByRole("button", { name: "Brief the crew" }).click();
  await expect(page.getByTestId("crew-step")).toHaveCount(4, { timeout: 3_000 });
  await expect(page.getByTestId("plan-warning")).toContainText(/Camera C2 sees you in the Dock Corridor on turn \d+/);
  await expect(page.getByTestId("plan-warning")).toHaveAttribute("data-by", "C2");
  await expect(page.getByTestId("crew-pushback")).toContainText("C2");
  await expect(page.getByTestId("ghost-path")).toHaveCount(1);
  await shot(page, "beat-4-plan");
  await page.getByRole("link", { name: "Start the run" }).click();

  // Beat 5: the run. The level's four guards and two cameras, and the crew's plan carried over.
  await expect(page).toHaveURL(/\/b\/F1\/run\?m=romaine-1974$/, { timeout: 15_000 });
  await expect(page.getByTestId("run-board")).toBeVisible();
  await expect(page.getByTestId("guard-piece")).toHaveCount(4);
  await expect(page.getByTestId("camera-piece")).toHaveText(["C1", "C2"]);
  await expect(page.getByTestId("player-piece")).toHaveAttribute("data-node", "fl-car");
  const plan = page.getByTestId("plan");
  await expect(plan).toHaveAttribute("data-source", "crew");
  await expect(plan.locator("li")).toHaveCount(4);
  const banner = page.getByTestId("alarm-banner");
  await expect(banner).toHaveAttribute("data-state", "calm");

  // The wow beat: straight into C2's cover. The alarm jumps to Alert.
  await moveTo(page, "fl-lobby");
  await expect(banner).toHaveAttribute("data-state", "calm");
  await moveTo(page, "dc-west");
  await expect(banner).toHaveAttribute("data-state", "alert");
  await expect(page.getByTestId("alarm-state")).toHaveText("Alert");
  await expect(page.getByTestId("run-status")).toHaveText("C2 saw you in the Dock Corridor. The guards are converging.");

  // The Chief's re-plan streams in, and the board draws each order as that guard's route.
  const rationale = page.getByTestId("chief-rationale");
  await expect(rationale).toHaveAttribute("data-done", "true", { timeout: 4_000 });
  await expect(rationale).toContainText(/\bG\d\b/);
  await expect(rationale).toContainText(/dock corridor/i);
  const orders = page.getByTestId("chief-order");
  await expect(orders).toHaveCount(4);
  for (const row of await orders.all()) {
    const guard = (await row.getAttribute("data-guard"))!;
    await expect(page.locator(`[data-testid="guard-route"][data-guard="${guard}"]`), guard).toHaveAttribute(
      "data-intent",
      (await row.getAttribute("data-intent"))!,
    );
  }
  await shot(page, "beat-5a-alert-and-replan");

  // The presenter clicks a guard: the Why card names the data each input came from.
  await page.locator('[data-why-target="guard:G4"]').click();
  const card = page.getByTestId("why-card");
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-why", "guard:G4");
  const whyRows = card.getByTestId("why-row");
  await expect(whyRows).toHaveCount(2);
  await expect(whyRows.nth(0)).toHaveAttribute("data-layer", "vexcel");
  await expect(whyRows.nth(0)).toContainText("Vexcel");
  await expect(whyRows.nth(0)).toContainText("entries.kind");
  await expect(whyRows.nth(1)).toHaveAttribute("data-layer", "costar");
  await expect(whyRows.nth(1)).toContainText("CoStar");
  await expect(whyRows.nth(1)).toContainText("buildingClass");
  await expect(card).toContainText("the 4th guard comes from Class A");
  await expect(page.getByTestId("player-piece")).toHaveAttribute("data-node", "dc-west");
  await shot(page, "beat-5b-why-card");
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);

  // Stay put and the guards close in. Each W is one turn; stop at the catch.
  for (let i = 0; i < 12 && (await page.getByTestId("run-outcome").count()) === 0; i++) {
    const turn = Number(await page.getByTestId("turn").textContent());
    await page.keyboard.press("w");
    await expect(page.getByTestId("turn")).toHaveText(String(turn + 1));
  }
  await expect(page.getByTestId("run-outcome")).toHaveAttribute("data-status", "caught");
  // The catching turn's sighting gets a Chief answer after the end; let it land so the log is final.
  await expect(page.getByTestId("chief-panel")).toHaveAttribute("data-late", "true", { timeout: 6_000 });
  await expect.poll(async () => (await storedLog(page)).lateChief?.turn ?? null, { timeout: 6_000 }).not.toBeNull();
  const log = await storedLog(page);
  expect(log.status).toBe("caught");
  await page.getByRole("link", { name: "See the debrief" }).click();

  // Beat 6: the debrief, true to the log the run left.
  await expect(page).toHaveURL(/\/b\/F1\/debrief\?m=romaine-1974$/, { timeout: 15_000 });
  await expect(page.getByTestId("replay-board")).toBeVisible();
  await expect(page.getByTestId("debrief-outcome")).toHaveAttribute("data-status", "caught");
  await expect(page.getByTestId("debrief-grade")).toHaveText("D");
  const last = log.turns.at(-1)!;
  const caughtBy = last.guards.filter((g) => g.nodeId === last.player.nodeId).map((g) => g.guardId);
  const elsewhere = last.guards.filter((g) => g.nodeId !== last.player.nodeId).map((g) => g.guardId);
  expect(caughtBy.length).toBeGreaterThan(0);
  expect(elsewhere.length).toBeGreaterThan(0);
  const detail = page.getByTestId("debrief-detail");
  await expect(detail).toContainText("C2 saw you in the Dock Corridor on turn 2.");
  await expect(detail).toContainText(`reached you on turn ${log.turns.length}.`);
  for (const id of caughtBy) await expect(detail).toContainText(new RegExp(`\\b${id}\\b`));
  // R7-M1: a sentence naming every guard must fail. No guard off the player's node is named.
  for (const id of elsewhere) await expect(detail).not.toContainText(new RegExp(`\\b${id}\\b`));
  const stats: Record<string, string> = {};
  for (const stat of await page.getByTestId("debrief-stat").all()) {
    stats[(await stat.getAttribute("data-stat"))!] = (await stat.getByTestId("debrief-stat-value").textContent())!.trim();
  }
  expect(stats).toEqual({
    turns: String(log.turns.length),
    noise: String(log.turns.filter((t) => t.player.kind === "pick" || t.player.kind === "sprint").length),
    detections: String(log.alarmEvents.filter((e) => e.cause.kind !== "decay").length),
  });
  const decided = log.turns.filter((t) => t.chief);
  expect(decided.length).toBeGreaterThan(0);
  const decisions = page.getByTestId("chief-decision");
  await expect(decisions).toHaveCount(decided.length + 1);
  await expect(decisions.first().getByTestId("chief-decision-rationale")).toHaveText(decided[0].chief!.rationale);
  await expect(decisions.last()).toHaveAttribute("data-late", "true");
  await expect(page.getByTestId("replay-board")).toHaveAttribute("data-frame", String(log.turns.length));
  await expect(page.getByTestId("player-piece")).toHaveAttribute("data-node", last.player.nodeId);
  await shot(page, "beat-6-debrief");

  // The heist ends at the Debrief (#113; Drill Mode is on hold, SPEC Q8, and
  // keeps its own assertion in drill.spec.ts): Try again opens a fresh run.
  await expect(page.getByRole("link", { name: "Run the drill" })).toHaveCount(0);
  await page.getByTestId("debrief-try-again").click();
  await expect(page).toHaveURL(/\/b\/F1\/run\?m=romaine-1974$/, { timeout: 15_000 });
  await expect(page.getByTestId("turn")).toHaveText("0");
  await expect(page.getByTestId("player-piece")).toHaveAttribute("data-node", "fl-car");
  await expect(page.getByTestId("alarm-banner")).toHaveAttribute("data-state", "calm");
  await shot(page, "beat-7-try-again");
});
