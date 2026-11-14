import { expect, test, type Page } from "@playwright/test";

// The Scout screen (SPEC §2 beat 2, issue #16), on the production build in
// fake mode: the Vexcel massing of the building, turned with ← → / drag /
// chips, its tagged entries as markers, and "Plan the job".

const canvas = (page: Page) => page.getByTestId("aerial-canvas");
const activeView = (page: Page) => page.locator('[data-testid="aerial-view"][data-active="true"]');

async function open(page: Page, id = "F1") {
  await page.goto(`/b/${id}/scout`);
  await expect(canvas(page)).toBeVisible();
}

test("← and → step through the five views with a 200ms cross-fade", async ({ page }) => {
  await open(page);
  await expect(canvas(page)).toHaveAttribute("data-view", "N");
  await expect(page.getByTestId("view-caption")).toHaveText("From the north");

  const layers = page.getByTestId("aerial-view");
  await expect(layers).toHaveCount(5);
  for (const layer of await layers.all()) {
    expect(await layer.evaluate((el) => getComputedStyle(el).transitionProperty)).toContain("opacity");
    expect(await layer.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe("0.2s");
  }

  for (const dir of ["E", "S", "W", "ortho", "N"]) {
    await page.keyboard.press("ArrowRight");
    await expect(canvas(page)).toHaveAttribute("data-view", dir);
    await expect(activeView(page)).toHaveAttribute("data-dir", dir);
    await expect(page.locator(`[data-testid="view-chip"][data-dir="${dir}"]`)).toHaveAttribute("aria-pressed", "true");
  }
  await page.keyboard.press("ArrowLeft");
  await expect(canvas(page)).toHaveAttribute("data-view", "ortho");
  await expect(page.getByTestId("view-caption")).toHaveText("Straight down");

  // Once the fade settles, the outgoing view is gone and the new one is opaque.
  await page.keyboard.press("ArrowLeft");
  const ortho = page.locator('[data-testid="aerial-view"][data-dir="ortho"]');
  await expect(ortho).toHaveCSS("opacity", "0");
  await expect(activeView(page)).toHaveCSS("opacity", "1");
});

test("under prefers-reduced-motion the views swap without a fade", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  for (const layer of await page.getByTestId("aerial-view").all()) {
    expect(await layer.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe("0s");
  }
  await page.keyboard.press("ArrowRight");
  await expect(canvas(page)).toHaveAttribute("data-view", "E");
});

test("a drag or a direction chip turns the view", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const box = (await canvas(page).boundingBox())!;
  // Start on open ground, clear of the building's markers.
  const y = box.y + box.height * 0.9;
  await page.mouse.move(box.x + box.width * 0.8, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8 - 160, y, { steps: 8 });
  await page.mouse.up();
  await expect(canvas(page)).not.toHaveAttribute("data-view", "N");

  await page.getByRole("button", { name: "S", exact: true }).click();
  await expect(canvas(page)).toHaveAttribute("data-view", "S");
  await page.getByRole("button", { name: "Ortho", exact: true }).click();
  await expect(canvas(page)).toHaveAttribute("data-view", "ortho");
});

test("the entry markers are visible and labelled, and clicking one shows its note", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const markers = activeView(page).getByTestId("entry-marker");
  await expect(markers).toHaveCount(5);
  for (const marker of await markers.all()) await expect(marker).toBeVisible();
  const labels = activeView(page).getByTestId("entry-label");
  await expect(labels).toHaveText(["Loading dock", "Garage ramp", "Main lobby", "Stair A exit", "Roof hatch"]);
  for (const label of await labels.all()) await expect(label).toBeVisible();
  // An entry on a face this view can't see stays on screen, named as the far side.
  await expect(activeView(page).getByRole("button", { name: "Main lobby, far side" })).toBeVisible();
  await expect(activeView(page).getByRole("button", { name: "Loading dock", exact: true })).toHaveAttribute(
    "data-facing",
    "true",
  );

  const note = page.getByTestId("entry-note");
  await expect(note).toContainText("Pick a marker");
  await activeView(page).getByRole("button", { name: "Loading dock", exact: true }).click();
  await expect(note).toContainText("Loading dock · North face");
  await expect(note).toContainText("the only truck-height door");
  await expect(page.locator('[data-testid="entry-row"][data-entry="dock-N"]')).toHaveAttribute("aria-pressed", "true");

  // Picking an entry in the panel turns the aerial to the view it is tagged on.
  await page.locator('[data-testid="entry-row"][data-entry="garage-E"]').click();
  await expect(canvas(page)).toHaveAttribute("data-view", "E");
  await expect(note).toContainText("Garage ramp · East face");
  await expect(activeView(page).locator('[data-entry="garage-E"][data-testid="entry-marker"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("every marker stays inside the frame in every view", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "F4");
  for (let i = 0; i < 5; i++) {
    const frame = (await canvas(page).boundingBox())!;
    for (const marker of await activeView(page).getByTestId("entry-marker").all()) {
      const b = (await marker.boundingBox())!;
      expect(b.width).toBe(40);
      expect(b.x).toBeGreaterThanOrEqual(frame.x);
      expect(b.x + b.width).toBeLessThanOrEqual(frame.x + frame.width);
      expect(b.y).toBeGreaterThanOrEqual(frame.y);
      expect(b.y + b.height).toBeLessThanOrEqual(frame.y + frame.height);
    }
    await page.keyboard.press("ArrowRight");
  }
});

test("the aerial loads behind a skeleton the size of the final canvas, with no layout shift", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/buildings/F1/aerial", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/b/F1/scout");
  const skeleton = page.getByTestId("aerial-skeleton");
  await expect(skeleton).toBeVisible();
  await expect(page.getByTestId("entry-row-skeleton")).toHaveCount(5);
  const before = (await skeleton.boundingBox())!;
  const actionBefore = (await page.getByRole("link", { name: "Plan the job" }).boundingBox())!;
  expect(before.width).toBeGreaterThan(600);

  release();
  await expect(canvas(page)).toBeVisible();
  await expect(skeleton).toHaveCount(0);
  expect(await canvas(page).boundingBox()).toEqual(before);
  expect(await page.getByRole("link", { name: "Plan the job" }).boundingBox()).toEqual(actionBefore);
});

test("when the aerial fails, the screen says so and Retry recovers", async ({ page }) => {
  let fail = true;
  await page.route("**/api/buildings/F1/aerial", (route) =>
    fail
      ? route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ mode: "fake", error: "upstream timed out" }) })
      : route.continue(),
  );
  await page.goto("/b/F1/scout");
  const error = page.getByTestId("aerial-error");
  await expect(error).toContainText("The aerial couldn't load.");
  await expect(error).toContainText("upstream timed out");
  fail = false;
  await error.getByRole("button", { name: "Retry" }).click();
  await expect(canvas(page)).toBeVisible();
  await expect(activeView(page).getByTestId("entry-marker")).toHaveCount(5);
});

test("Plan the job goes to the dossier", async ({ page }) => {
  await open(page);
  await page.getByRole("link", { name: "Plan the job" }).click();
  await expect(page).toHaveURL(/\/b\/F1\/dossier$/);
});

test("the panel shows CoStar's facts beside Vexcel's height and entries", async ({ page }) => {
  await open(page);
  const facts = page.getByTestId("scout-facts");
  for (const text of ["Built", "1974", "Class", "A", "Stories", "42", "Height", "160 m"]) await expect(facts).toContainText(text);
  await expect(facts.locator('[data-layer="costar"]')).toHaveCount(3);
  await expect(facts.locator('[data-layer="vexcel"]')).toHaveCount(1);
  await expect(page.getByTestId("entry-row")).toHaveCount(5);
});
