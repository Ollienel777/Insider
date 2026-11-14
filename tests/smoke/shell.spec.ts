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
  await expect(rail.getByRole("link")).toHaveText(["Scout", "Dossier", "Plan", "Run", "Debrief", "Drill"]);
  const current = rail.locator('[aria-current="page"]');
  await expect(current).toHaveText("Scout");
  // The underline is the accent (DESIGN.md --accent: #f2a93b).
  const underline = await current.evaluate((el) => getComputedStyle(el, "::after").backgroundColor);
  expect(underline).toBe("rgb(242, 169, 59)");
});

test("the primary action walks to the next step and marks the last one done", async ({ page }) => {
  await page.goto("/b/F1/scout");
  await page.getByRole("link", { name: "Plan the job" }).click();
  await expect(page).toHaveURL(/\/b\/F1\/dossier$/);
  const rail = page.getByRole("navigation", { name: "Steps" });
  await expect(rail.locator('[aria-current="page"]')).toHaveText("Dossier");
  await expect(rail.locator('[data-state="done"]')).toHaveText(["Scout(done)"]);
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

for (const route of ["/", "/b/F1/scout"]) {
  test(`every control on ${route} shows a focus ring and is at least 40px tall`, async ({ page }) => {
    await page.goto(route);
    const controls = await tabThrough(page);
    expect(controls.length).toBeGreaterThan(3);
    for (const control of controls) {
      expect(control.outline, control.name).toBe("solid 2px");
      expect(control.height, control.name).toBeGreaterThanOrEqual(40);
    }
  });
}
