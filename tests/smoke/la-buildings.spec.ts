import { expect, test, type Page } from "@playwright/test";

// The other two LA pins (#39): a judge who picks F2 or F3 on the map gets a
// level of its own, end to end in fake mode. Map → Scout → Dossier → Plan →
// Run (walk straight in, trip the alarm, see the Chief answer) → Debrief, on
// each building's own mission, at the demo's 1440×900. The F1 demo path
// (demo-path.spec.ts) is untouched; this walk proves the same screens hand
// over on the other floors. Screenshots go to test-results/la-buildings/.

interface Walk {
  id: "F2" | "F3";
  name: string;
  mission: string;
  title: string;
  /** The map row's facts line. */
  facts: string;
  era: { year: string; label: string };
  guards: string;
  /** The crew order Plan sends, the warning it shows, and the steps of the reply. */
  order: string;
  warning: RegExp;
  warnedBy: string;
  steps: number;
  cameras: string[];
  start: string;
  /** The two moves of the straight walk in, and what the second one trips. */
  walk: [string, string];
  alarm: "alert" | "lockdown";
  status: string;
  chiefOrders: number;
  /**
   * The quiet route at the Run screen's seed, as src/level/la-fixtures.test.ts
   * computes it with quietRoute: a node is a move, W a wait, PICK a pick of the
   * locked door, and " " takes the objective.
   */
  quiet: string[];
}

const WALKS: Walk[] = [
  {
    id: "F2",
    name: "Figueroa Exchange",
    mission: "sunset-1986",
    title: "Hole in the Ground",
    facts: "Financial District · 1989 · Class B · 52 stories",
    era: { year: "1989", label: "Card and coax era" },
    guards: "3 guards",
    order: "Go in through the dock and take the vault.",
    warning: /Camera C2 sees you in the West Corridor on turn 1\.$/,
    warnedBy: "C2",
    steps: 3,
    cameras: ["C1", "C2", "C3"],
    start: "fl-car",
    walk: ["fl-hall", "wc-s"],
    alarm: "alert",
    status: "C2 saw you in the West Corridor. The guards are converging.",
    chiefOrders: 3,
    quiet: ["fl-hall", "W", "sh-w", "sh-mid", "sh-e", "ec-s", "ec-mid", "ec-n", "PICK", "PICK", "PICK", "vt-gate", "vt-boxes", " ", "vt-gate", "ec-n", "es-landing"],
  },
  {
    id: "F3",
    name: "Meridian on Wilshire",
    mission: "night-desk",
    title: "The Night Desk",
    facts: "Westlake · 2017 · Class A · 30 stories",
    era: { year: "2017", label: "Smart era" },
    guards: "4 guards",
    order: "Go in through the dock and get the prototype.",
    warning: /Camera C1 sees you in the North Hall on turn 1\.$/,
    warnedBy: "C1",
    steps: 3,
    cameras: ["C1", "C2", "C3", "C4", "C5"],
    start: "sl-car",
    walk: ["sl-door", "nh-w"],
    alarm: "lockdown",
    status: "C1 saw you in the North Hall. The guards are converging.",
    chiefOrders: 4,
    quiet: ["sl-door", "s1-nw", "s1-mid", "s1-ne", "nh-e", "PICK", "PICK", "PICK", "PICK", "lab-door", "lab-bench", " ", "lab-door", "nh-e", "s1-ne", "s1-mid", "s1-nw", "sl-door", "sl-car"],
  },
];

test.use({ viewport: { width: 1440, height: 900 } });

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/la-buildings/${name}.png` });

/** Presses the number the board shows on the neighbour `nodeId`, and waits for the turn it plays. */
async function moveTo(page: Page, nodeId: string) {
  const turn = Number(await page.getByTestId("turn").textContent());
  const key = await page.locator(`[data-testid="choice"][data-node="${nodeId}"]`).getAttribute("data-key");
  expect(key, `${nodeId} is numbered`).toMatch(/^[1-9]$/);
  await page.keyboard.press(key!);
  await expect(page.getByTestId("turn")).toHaveText(String(turn + 1));
  await expect(page.getByTestId("player-piece")).toHaveAttribute("data-node", nodeId);
}

for (const w of WALKS) {
  test(`${w.id} × ${w.mission}: map to debrief, in fake mode`, async ({ page }) => {
    // Like the F1 demo path, the walk takes 20-30 s on the gate's 2-vCPU VM,
    // past Playwright's 30 s default; 90 s is #25's budget for a whole walk. A
    // broken screen still fails on its own outcome wait, not on this.
    test.setTimeout(90_000);

    // The map: the pin is enabled, no longer "Level in prep".
    await page.goto("/map");
    await expect(page.getByTestId("map-skeleton")).toHaveCount(0);
    const row = page.getByTestId("building-row").filter({ hasText: w.name });
    await expect(row).toContainText(w.facts);
    await expect(row).not.toContainText("Level in prep");
    await expect(row).not.toHaveAttribute("aria-disabled", "true");
    await row.click();
    await expect(page.locator(`[data-testid="map-pin"][data-building="${w.id}"]`)).toHaveAttribute("data-selected", "true");
    await page.getByRole("link", { name: "Scout this building" }).click();

    // Scout: its own aerial, on its own mission.
    await expect(page).toHaveURL(new RegExp(`/b/${w.id}/scout\\?m=${w.mission}$`));
    await expect(page.getByTestId("building-slot")).toHaveText(`${w.name} · Los Angeles`);
    await expect(page.getByTestId("aerial-canvas")).toBeVisible();
    await page.getByRole("link", { name: "Plan the job" }).click();

    // Dossier: the cast-because row, its own era and guard count, the mission's briefing.
    await expect(page).toHaveURL(new RegExp(`/b/${w.id}/dossier\\?m=${w.mission}$`));
    await expect(page.getByTestId("dossier")).toHaveAttribute("data-done", "true", { timeout: 10_000 });
    const table = page.getByTestId("data-to-level");
    await expect(table.getByTestId("provenance-row").first()).toHaveAttribute("data-rule", "cast");
    await expect(table.locator('[data-rule="cast"]')).toContainText(`built ${w.era.year}`);
    const era = table.locator('[data-rule="era"]');
    await expect(era).toContainText(w.era.year);
    await expect(era).toContainText(w.era.label);
    await expect(table.locator('[data-rule="guards"]')).toContainText(w.guards);
    await expect(page.getByTestId("briefing").getByRole("heading", { name: w.title })).toBeVisible();
    await shot(page, `${w.id}-dossier`);
    await page.getByRole("link", { name: "Brief the crew" }).click();

    // Plan: the recorded crew answers with a plan, a warning naming a camera and pushback.
    await expect(page).toHaveURL(new RegExp(`/b/${w.id}/plan\\?m=${w.mission}$`));
    await expect(page.getByTestId("plan-board")).toBeVisible();
    await page.getByTestId("crew-order").fill(w.order);
    await page.getByRole("button", { name: "Brief the crew" }).click();
    await expect(page.getByTestId("crew-step")).toHaveCount(w.steps, { timeout: 3_000 });
    await expect(page.getByTestId("recorded-chip")).toHaveText("Recorded");
    await expect(page.getByTestId("plan-warning")).toContainText(w.warning);
    await expect(page.getByTestId("plan-warning")).toHaveAttribute("data-by", w.warnedBy);
    await expect(page.getByTestId("crew-pushback")).toContainText(w.warnedBy);
    await expect(page.getByTestId("ghost-path")).toHaveCount(1);
    await shot(page, `${w.id}-plan`);
    await page.getByRole("link", { name: "Start the run" }).click();

    // Run: the level's guards and cameras; straight in trips the alarm and the Chief answers.
    await expect(page).toHaveURL(new RegExp(`/b/${w.id}/run\\?m=${w.mission}$`), { timeout: 15_000 });
    await expect(page.getByTestId("run-board")).toBeVisible();
    await expect(page.getByTestId("guard-piece")).toHaveCount(Number(w.guards[0]));
    await expect(page.getByTestId("camera-piece")).toHaveText(w.cameras);
    await expect(page.getByTestId("player-piece")).toHaveAttribute("data-node", w.start);
    const banner = page.getByTestId("alarm-banner");
    await expect(banner).toHaveAttribute("data-state", "calm");
    await shot(page, `${w.id}-run`);
    await page.getByTestId("lens-toggle").click();
    await expect(page.getByTestId("lens-legend")).toBeVisible();
    await shot(page, `${w.id}-run-lens`);
    await page.getByTestId("lens-toggle").click();
    await expect(page.getByTestId("lens-legend")).toHaveCount(0);

    await moveTo(page, w.walk[0]);
    await expect(banner).toHaveAttribute("data-state", "calm");
    await moveTo(page, w.walk[1]);
    await expect(banner).toHaveAttribute("data-state", w.alarm);
    await expect(page.getByTestId("run-status")).toHaveText(w.status);
    const rationale = page.getByTestId("chief-rationale");
    await expect(rationale).toHaveAttribute("data-done", "true", { timeout: 4_000 });
    await expect(page.getByTestId("chief-recorded-chip")).toHaveText("Recorded");
    await expect(page.getByTestId("chief-order")).toHaveCount(w.chiefOrders);
    await shot(page, `${w.id}-run-chief`);

    // Stay put and the guards close in.
    for (let i = 0; i < 20 && (await page.getByTestId("run-outcome").count()) === 0; i++) {
      const turn = Number(await page.getByTestId("turn").textContent());
      await page.keyboard.press("w");
      await expect(page.getByTestId("turn")).toHaveText(String(turn + 1));
    }
    await expect(page.getByTestId("run-outcome")).toHaveAttribute("data-status", "caught");
    await page.getByRole("link", { name: "See the debrief" }).click();

    // Debrief: the run's own outcome, on the same building and mission.
    await expect(page).toHaveURL(new RegExp(`/b/${w.id}/debrief\\?m=${w.mission}$`), { timeout: 15_000 });
    await expect(page.getByTestId("replay-board")).toBeVisible();
    await expect(page.getByTestId("debrief-outcome")).toHaveAttribute("data-status", "caught");
    await expect(page.getByTestId("debrief-detail")).toContainText(`${w.warnedBy} saw you`);
    await shot(page, `${w.id}-debrief`);
  });
}

for (const w of WALKS) {
  test(`${w.id} × ${w.mission}: the quiet route plays by keys to a clean win, and the debrief says so`, async ({ page }) => {
    // About 15 s on the gate's VM (one key and one outcome wait per turn); 60 s leaves room under load.
    test.setTimeout(60_000);
    await page.goto(`/b/${w.id}/run?m=${w.mission}`);
    await expect(page.getByTestId("run-board")).toBeVisible();
    await expect(page.getByTestId("player-piece")).toHaveAttribute("data-node", w.start);
    for (const step of w.quiet) {
      const turn = Number(await page.getByTestId("turn").textContent());
      if (step === "W" || step === " ") {
        await page.keyboard.press(step === "W" ? "w" : " ");
      } else {
        const selector = step === "PICK" ? '[data-testid="choice"][data-kind="pick"]' : `[data-testid="choice"][data-node="${step}"]`;
        const key = await page.locator(selector).getAttribute("data-key");
        expect(key, `${step} on turn ${turn}`).toMatch(/^[1-9]$/);
        await page.keyboard.press(key!);
      }
      if (step === w.quiet[w.quiet.length - 1]) break;
      await expect(page.getByTestId("turn")).toHaveText(String(turn + 1));
      await expect(page.getByTestId("alarm-banner")).toHaveAttribute("data-state", "calm");
    }
    await expect(page.getByTestId("run-outcome")).toHaveAttribute("data-status", "won");
    await expect(page.getByTestId("alarm-banner")).toHaveAttribute("data-state", "calm");
    const log = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), `heist:run-log:${w.id}:${w.mission}`);
    expect(log.status).toBe("won");
    expect(log.alarmEvents).toEqual([]);
    expect(log.turns).toHaveLength(w.quiet.length);
    await page.getByRole("link", { name: "See the debrief" }).click();

    await expect(page).toHaveURL(new RegExp(`/b/${w.id}/debrief\\?m=${w.mission}$`), { timeout: 15_000 });
    await expect(page.getByTestId("debrief-outcome")).toHaveAttribute("data-status", "won");
    await expect(page.getByTestId("debrief-grade")).toHaveText("S");
    await expect(page.getByTestId("debrief-detail")).toHaveText(new RegExp(`in ${w.quiet.length} turns, never seen\\.$`));
    await shot(page, `${w.id}-debrief-won`);
  });
}
