import { expect, test, type Page } from "@playwright/test";

test("the shell shows the product name and the fixtures chip", async ({ page }) => {
  await page.goto("/");
  const bar = page.getByTestId("top-bar");
  await expect(bar.getByRole("link", { name: "Heist Anywhere" })).toBeVisible();
  expect((await bar.boundingBox())?.height).toBe(56);
  const chip = page.getByTestId("mode-chip");
  await expect(chip).toHaveText("FIXTURES");
});

test("the mode chip's tooltip lists the services on fixtures", async ({ page }) => {
  await page.goto("/");
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toBeHidden();
  await page.getByTestId("mode-chip").hover();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveText("On fixtures: Model, CoStar, Vexcel, Matterport");
});

test("a building screen shows the building and the step rail", async ({ page }) => {
  await page.goto("/b/F1/scout");
  await expect(page.getByTestId("building-slot")).toHaveText("Halvorsen Tower · Los Angeles");
  const rail = page.getByRole("navigation", { name: "Steps" });
  // The case file's tabs (issue 166): the current step and Owner Mode open, the rest locked until reached.
  await expect(rail.getByRole("link")).toHaveText(["1Missions(done)", "2Cast(done)", "3Scout", "8Owner Mode"]);
  await expect(rail.locator('[aria-disabled="true"]')).toHaveCount(4);
  await expect(rail).not.toContainText("Drill");
  const current = rail.locator('[aria-current="page"]');
  await expect(current).toHaveText("3Scout");
  // The front tab is the folder's manila (DESIGN.md --manila: #e9cf94), on one row with the rest.
  expect(await current.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(233, 207, 148)");
  const tops = await rail.locator("li").evaluateAll((els) => new Set(els.map((el) => Math.round(el.getBoundingClientRect().top))).size);
  expect(tops).toBe(1);
});

test("the primary action walks to the next step and marks the last one done", async ({ page }) => {
  await page.goto("/b/F1/scout");
  await page.getByRole("link", { name: "Plan the job" }).click();
  await expect(page).toHaveURL(/\/b\/F1\/dossier\?m=romaine-1974$/);
  const rail = page.getByRole("navigation", { name: "Steps" });
  await expect(rail.locator('[aria-current="page"]')).toHaveText("4Dossier");
  await expect(rail.locator('[data-state="done"]')).toHaveText(["1Missions(done)", "2Cast(done)", "3Scout(done)"]);
});

test("an unknown building is a not-found page with a way back", async ({ page }) => {
  const response = await page.goto("/b/F9/scout");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("link", { name: "Back to the map" })).toBeVisible();
});

async function tabThrough(page: Page) {
  const seen: { name: string; outline: string; height: number }[] = [];
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      return {
        name: (el.textContent ?? "").trim() || el.tagName,
        outline: `${style.outlineStyle} ${style.outlineWidth}`,
        height: el.getBoundingClientRect().height,
      };
    });
    if (!info || seen.some((s) => s.name === info.name)) break;
    seen.push(info);
  }
  return seen;
}

// Each route's controls are all on screen only once its data has arrived, so
// the walk waits for that outcome before it starts.
//
// "/" is the mission picker (#118), rendered whole on the server.
//
// "/map" streams the map: the skeleton comes first, then the buildings in a
// hidden <div>, which React's reveal script swaps in on a later animation
// frame. The load event can fire before that frame, and under load the walk
// used to tab past the skeleton (no controls) to the end of the page after
// two stops. A count of pins or rows does not wait for the swap, since it
// also matches the hidden copy; the skeleton leaving does, and the rows must
// then be visible.
//
// The Scout screen fetches its aerial after hydration; its entry markers are
// controls too.
//
// The cast screen's finalist cards are hidden until its replay ends; under
// reduced motion it starts at the end, so every control is there at once.
const loaded: Record<string, (page: Page) => Promise<void>> = {
  "/": async (page) => {
    await expect(page.getByTestId("mission-tab")).toHaveCount(5);
  },
  "/map": async (page) => {
    await expect(page.getByTestId("map-skeleton")).toHaveCount(0);
    const rows = page.getByTestId("building-row");
    await expect(rows).toHaveCount(3);
    for (const row of await rows.all()) await expect(row).toBeVisible();
  },
  "/b/F1/scout": async (page) => {
    await expect(page.getByTestId("aerial-canvas")).toBeVisible();
  },
  "/m/romaine-1974/cast": async (page) => {
    await expect(page.getByTestId("finalists")).toHaveAttribute("data-shown", "true");
    await expect(page.getByTestId("replay")).toBeVisible();
  },
};

for (const [route, waitForData] of Object.entries(loaded)) {
  test(`every control on ${route} shows a focus ring and is at least 40px tall`, async ({ page }) => {
    // Only the cast screen needs it (above); every other route walks with motion on.
    if (route.endsWith("/cast")) await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(route);
    await waitForData(page);
    const controls = await tabThrough(page);
    expect(controls.length).toBeGreaterThan(3);
    for (const control of controls) {
      expect(control.outline, control.name).toBe("solid 2px");
      expect(control.height, control.name).toBeGreaterThanOrEqual(40);
    }
  });
}
