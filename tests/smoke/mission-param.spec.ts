import { expect, test, type Page } from "@playwright/test";

// The chosen mission rides through every building route as ?m= (SPEC §4,
// #119). With it, each screen's primary action and the step rail keep it;
// without it, a building screen redirects to its own mission (F1 →
// romaine-1974), so the address always says which level is on screen.

const M = "romaine-1974";
const at = (screen: string, m = M) => new RegExp(`/b/F1/${screen}\\?m=${m}$`);

/** Every open tab keeps ?m=: the steps reached so far, the current one, and Owner Mode (the rest are locked, issue 166). */
async function railKeeps(page: Page, m: string, open: number) {
  const links = page.getByRole("navigation", { name: "Steps" }).getByRole("link");
  await expect(links).toHaveCount(open);
  for (const link of await links.all()) expect(await link.getAttribute("href")).toMatch(new RegExp(`^/b/F1/[a-z]+\\?m=${m}$`));
}

test("Scout → Dossier → Plan → Run → Debrief keeps ?m= in the address", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(`/b/F1/scout?m=${M}`);
  await expect(page).toHaveURL(at("scout"));
  await railKeeps(page, M, 2);
  await page.getByRole("link", { name: "Plan the job" }).click();
  await expect(page).toHaveURL(at("dossier"));
  await expect(page.getByTestId("data-to-level").getByTestId("provenance-row").first()).toHaveAttribute("data-rule", "cast");
  await railKeeps(page, M, 3);
  await page.getByRole("link", { name: "Brief the crew" }).click();
  await expect(page).toHaveURL(at("plan"));
  await railKeeps(page, M, 4);
  await page.getByRole("link", { name: "Start the run" }).click();
  await expect(page).toHaveURL(at("run"), { timeout: 15_000 });
  await expect(page.getByTestId("run-board")).toBeVisible();
  // Run takes the whole screen (issue 166): no tabs while playing. Its Debrief link still keeps ?m=.
  await page.goto(`/b/F1/debrief?m=${M}`);
  await expect(page).toHaveURL(at("debrief"), { timeout: 15_000 });
  await railKeeps(page, M, 6);
});

test("without ?m=, every building screen redirects to the building's own mission", async ({ page }) => {
  for (const screen of ["scout", "dossier", "plan", "run", "debrief", "drill"]) {
    await page.goto(`/b/F1/${screen}`);
    await expect(page, screen).toHaveURL(at(screen));
  }
  await page.goto("/b/F1");
  await expect(page).toHaveURL(at("scout"));
});

test("the map passes no mission: its Scout link lands on the building's own (?m=romaine-1974)", async ({ page }) => {
  // The map moved to /map when / became the mission picker (#25).
  await page.goto("/map");
  await expect(page.getByTestId("map-skeleton")).toHaveCount(0);
  await page.getByTestId("building-row").filter({ hasText: "Halvorsen Tower" }).click();
  const link = page.getByRole("link", { name: "Scout this building" });
  await expect(link).toHaveAttribute("href", "/b/F1/scout");
  await link.click();
  await expect(page).toHaveURL(at("scout"));
});

test("an unknown m is a 404 at the first hop; Drill, which reads no level, keeps it", async ({ page }) => {
  expect((await page.goto("/b/F1?m=bogus"))?.status()).toBe(404);
  expect((await page.goto("/b/F1/drill?m=typo"))?.status()).toBe(200);
  await expect(page).toHaveURL(/\/b\/F1\/drill\?m=typo$/);
  await railKeeps(page, "typo");
});

test("another mission on F1 has no level yet, and keeps its ?m=; an unknown one is a 404", async ({ page }) => {
  await page.goto("/b/F1/dossier?m=sunset-1986");
  await expect(page).toHaveURL(at("dossier", "sunset-1986"));
  await expect(page.getByTestId("data-to-level")).toHaveCount(0);
  await railKeeps(page, "sunset-1986");
  const response = await page.goto("/b/F1/dossier?m=no-such-mission");
  expect(response?.status()).toBe(404);
});
