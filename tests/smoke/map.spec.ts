import { expect, test } from "@playwright/test";

// The map of every prepared building (issue #10), on the production build in
// fake mode. It opened the demo at `/` until the mission picker took that
// address (#118); it now lives at `/map`, off the demo path.

test("the map lists Halvorsen Tower and its Scout route opens from it", async ({ page }) => {
  await page.goto("/map");
  const row = page.getByTestId("building-row").filter({ hasText: "Halvorsen Tower" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Bunker Hill · 1974 · Class A · 42 stories");

  const scout = page.getByRole("button", { name: "Scout this building" });
  await expect(scout).toBeDisabled();
  await row.click();
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-testid="map-pin"][data-building="F1"]')).toHaveAttribute("data-selected", "true");

  await page.getByRole("link", { name: "Scout this building" }).click();
  await expect(page).toHaveURL(/\/b\/F1\/scout$/);
  await expect(page.getByTestId("building-slot")).toHaveText("Halvorsen Tower · Los Angeles");
});

test("LA shows three pins and rows; the Houston tab shows two", async ({ page }) => {
  await page.goto("/map");
  // The buildings stream in a hidden copy before React swaps them for the
  // skeleton, and a count also matches that copy: count once the swap is done.
  await expect(page.getByTestId("map-skeleton")).toHaveCount(0);
  await expect(page.getByTestId("map-pin")).toHaveCount(3);
  await expect(page.getByTestId("building-row")).toHaveCount(3);

  await page.getByRole("tab", { name: /Houston/ }).click();
  await expect(page.getByTestId("map-pin")).toHaveCount(2);
  await expect(page.getByTestId("building-row")).toHaveText([/Smith Street Center/, /Westchase Commons/]);
  await expect(page).toHaveURL(/\?city=Houston$/);

  // The address keeps the tab.
  await page.reload();
  await expect(page.getByRole("tab", { name: /Houston/ })).toHaveAttribute("aria-selected", "true");
});

test("the city tab and the address stay in step both ways: after Houston, /map shows LA", async ({ page }) => {
  await page.goto("/map");
  await expect(page.getByTestId("map-skeleton")).toHaveCount(0);
  const tab = (name: RegExp) => page.getByRole("tab", { name });

  // Tab → address.
  await tab(/Houston/).click();
  await expect(page).toHaveURL(/\/map\?city=Houston$/);
  await expect(tab(/Houston/)).toHaveAttribute("aria-selected", "true");

  // Address → tab, by client-side navigation: the wordmark goes to the
  // mission picker (`/`, #118), whose link back to `/map` moves the tab to LA.
  await page.getByRole("link", { name: "Heist Anywhere" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("link", { name: "Or browse every prepared building on the map" }).click();
  await expect(page).toHaveURL(/\/map$/);
  await expect(tab(/Los Angeles/)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("building-row")).toHaveCount(3);
  await expect(page.getByTestId("building-row").first()).toContainText("Halvorsen Tower");

  // And back to Houston by its tab, then away and Back: the tab follows the address again.
  await tab(/Houston/).click();
  await expect(page).toHaveURL(/\/map\?city=Houston$/);
  await page.goto("/b/F1/scout");
  await page.goBack();
  await expect(page).toHaveURL(/\/map\?city=Houston$/);
  await expect(tab(/Houston/)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("building-row")).toHaveCount(2);
});

test("pins sit where their CoStar coordinates put them, each with three layer dots", async ({ page }) => {
  await page.goto("/map");
  const basemap = page.getByTestId("basemap").getByRole("img");
  await expect(basemap).toHaveJSProperty("complete", true);
  expect(await basemap.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(2080);

  const centre = async (id: string) => {
    const box = (await page.locator(`[data-building="${id}"] button`).first().boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  // F3 (Westlake) is west and north of F2 (Financial District), which is west of F1 (Bunker Hill).
  const [f1, f2, f3] = [await centre("F1"), await centre("F2"), await centre("F3")];
  expect(f3.x).toBeLessThan(f2.x);
  expect(f2.x).toBeLessThan(f1.x);
  expect(f3.y).toBeLessThan(f2.y);

  for (const pin of await page.getByTestId("map-pin").all()) {
    await expect(pin.locator("[data-layer]")).toHaveCount(3);
  }
});

test("hovering a pin shows its card", async ({ page }) => {
  await page.goto("/map");
  await expect(page.getByTestId("building-card")).toHaveCount(0);
  await page.getByRole("button", { name: "Halvorsen Tower", exact: true }).hover();
  const card = page.getByTestId("building-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Halvorsen Tower");
  await expect(card).toContainText("Bunker Hill");
  for (const text of ["Built", "1974", "Class", "Stories", "42"]) await expect(card).toContainText(text);
});

test("a building without a level is disabled and marked level in prep", async ({ page }) => {
  await page.goto("/map");
  const pin = page.getByRole("button", { name: "Figueroa Exchange, level in prep" });
  await expect(pin).toHaveAttribute("aria-disabled", "true");
  // Playwright treats aria-disabled as not actionable; force the click to prove it does nothing.
  await pin.click({ force: true });
  const row = page.getByTestId("building-row").filter({ hasText: "Figueroa Exchange" });
  await expect(row).toContainText("Level in prep");
  await row.click({ force: true });
  await expect(page.getByRole("button", { name: "Scout this building" })).toBeDisabled();
  await expect(page.locator("[data-selected]")).toHaveCount(0);
});

test("the basemap's attribution is shown", async ({ page }) => {
  await page.goto("/map");
  const credit = page.getByTestId("basemap-attribution");
  await expect(credit).toBeVisible();
  await expect(credit).toHaveText("© OpenStreetMap contributors");
  await expect(credit).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");
});
