import { expect, test, type Page } from "@playwright/test";

// The wow beat (DESIGN.md the hero screen), its four steps in order, on the
// production build in fake mode. The page records what the board and the
// panel show on every animation frame from the trip on, and the test reads
// that record:
//   1. Calm: grey cones, Calm banner.
//   2. The trip: on the frame the banner first reads Alert, C2's whole cone is
//      already `--danger`, and the banner's colour has no transition to run.
//   3. The re-plan: the Chief's rationale streams word by word, then the
//      orders list row by row; from the moment the Chief answers, no guard's
//      dashed `--danger` route is on the board before its order row.
//   4. The Why card: clicking G4 draws the provenance thread and opens it.

test.use({ viewport: { width: 1440, height: 900 } });

/** One sampled frame: the banner's state, whether a cone is tripped, the words and order rows shown, the dashed routes. */
interface Frame {
  banner: string;
  tripped: boolean;
  words: number;
  orders: number;
  routes: string[];
  ordered: string[];
}

async function pressFor(page: Page, nodeId: string) {
  const key = await page.locator(`[data-testid="choice"][data-node="${nodeId}"]`).getAttribute("data-key");
  await page.keyboard.press(key!);
}

test("the Alert moment plays DESIGN.md's four steps in order", async ({ page }) => {
  // The stream itself takes about 2 s (33 words, then 5 rows); the rest is page loads and hops.
  // 60 s leaves room for a loaded 2-vCPU VM running two gates (see demo-path.spec.ts).
  test.setTimeout(60_000);
  await page.goto("/b/F1/run");
  const board = page.getByTestId("run-board");
  await expect(board).toBeVisible();

  // 1. Calm.
  await expect(page.getByTestId("alarm-banner")).toHaveAttribute("data-state", "calm");
  await expect(page.getByTestId("cone-tripped")).toHaveCount(0);
  await pressFor(page, "fl-lobby");
  await expect(board).toHaveAttribute("data-turn", "1");
  await expect(page.getByTestId("alarm-banner")).toHaveAttribute("data-state", "calm");

  // Sample every frame from here until the Chief's stream is done.
  await page.evaluate(() => {
    const w = window as unknown as { __frames: Frame[] };
    w.__frames = [];
    const sample = () => {
      const rationale = document.querySelector('[data-testid="chief-rationale"]');
      w.__frames.push({
        banner: document.querySelector('[data-testid="alarm-banner"]')?.getAttribute("data-state") ?? "",
        tripped: document.querySelector('[data-testid="cone-tripped"]') !== null,
        words: rationale?.textContent?.trim() ? rationale.textContent.trim().split(/\s+/).length : 0,
        orders: document.querySelectorAll('[data-testid="chief-order"]').length,
        routes: [...document.querySelectorAll('[data-testid="guard-route"]')].map((el) => el.getAttribute("data-guard") ?? ""),
        ordered: [...document.querySelectorAll('[data-testid="chief-order"]')].map((el) => el.getAttribute("data-guard") ?? ""),
      });
      if (rationale?.getAttribute("data-done") !== "true") requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

  // 2. The trip.
  await pressFor(page, "dc-west");
  await expect(page.getByTestId("chief-rationale")).toHaveAttribute("data-done", "true", { timeout: 30_000 });
  const frames: Frame[] = await page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames);

  const tripAt = frames.findIndex((f) => f.banner === "alert");
  expect(tripAt, "a frame with the banner at Alert").toBeGreaterThanOrEqual(0);
  expect(frames.slice(0, tripAt).every((f) => !f.tripped), "no tripped cone before the trip").toBe(true);
  expect(frames[tripAt].tripped, "the cone is --danger on the trip's frame").toBe(true);
  const transition = await page.getByTestId("alarm-state").evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(transition).toBe("0s");
  const danger = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--danger").trim());
  const rgb = `rgb(${[1, 3, 5].map((i) => parseInt(danger.slice(i, i + 2), 16)).join(", ")})`;
  await expect(page.getByTestId("alarm-state")).toHaveCSS("color", rgb);
  await expect(page.locator('[data-testid="cone"][data-watcher="C2"] [data-testid="cone-tripped"]')).toHaveCSS("fill", rgb);

  // 3. The re-plan: words grow first, then the rows; never a row before the last word.
  const after = frames.slice(tripAt);
  const streaming = after.findIndex((f) => f.words > 0);
  expect(streaming, "the rationale streams in").toBeGreaterThanOrEqual(0);
  const total = after[after.length - 1].words;
  expect(total).toBeGreaterThan(10);
  for (let i = 1; i < after.length; i++) {
    expect(after[i].words, `frame ${i}: words never go back`).toBeGreaterThanOrEqual(after[i - 1].words);
    expect(after[i].orders, `frame ${i}: rows never go back`).toBeGreaterThanOrEqual(after[i - 1].orders);
    if (after[i].orders > 0) expect(after[i].words, `frame ${i}: rows only after the last word`).toBe(total);
  }
  expect(new Set(after.map((f) => f.words)).size, "word by word, not all at once").toBeGreaterThan(3);
  // From the Chief's answer on, every dashed route belongs to a guard whose order row is shown.
  for (const f of after.slice(streaming)) {
    for (const guard of f.routes) expect(f.ordered, `${guard}'s route before its order`).toContain(guard);
  }
  await expect(page.getByTestId("chief-order")).toHaveCount(4);
  await expect(page.getByTestId("guard-route")).toHaveCount(4);
  await expect(page.getByTestId("guard-route").first()).toHaveCSS("stroke-dasharray", /6/);

  // 4. The Why card.
  await page.locator('[data-why-target="guard:G4"]').click();
  await expect(page.getByTestId("why-card")).toBeVisible();
  await expect(page.getByTestId("why-card")).toHaveAttribute("data-why", "guard:G4");
  await expect(page.getByTestId("provenance-thread")).toHaveCount(1);
});
