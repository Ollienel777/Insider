import { expect, test, type Page } from "@playwright/test";

// The chosen mission rides through every building route as ?m= (SPEC §4,
// #119). With it, each screen's primary action and the step rail keep it;
// without it, a building screen redirects to its own mission (F1 →
// romaine-1974), so the address always says which level is on screen.

const M = "romaine-1974";
const at = (screen: string, m = M) => new RegExp(`/b/F1/${screen}\\?m=${m}$`);

async function railKeeps(page: Page, m: string) {
  const links = page.getByRole("navigation", { name: "Steps" }).getByRole("link");
  await expect(links).toHaveCount(6);
  for (const link of await links.all()) expect(await link.getAttribute("href")).toMatch(new RegExp(`^/b/F1/[a-z]+\\?m=${m}$`));
}

test("Scout → Dossier → Plan → Run → Debrief keeps ?m= in the address", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(`/b/F1/scout?m=${M}`);
  await expect(page).toHaveURL(at("scout"));
  await railKeeps(page, M);
  await page.getByRole("link", { name: "Plan the job" }).click();
  await expect(page).toHaveURL(at("dossier"));
  await expect(page.getByTestId("data-to-level").getByTestId("provenance-row").first()).toHaveAttribute("data-rule", "cast");
  await railKeeps(page, M);
  await page.getByRole("link", { name: "Brief the crew" }).click();
  await expect(page).toHaveURL(at("plan"));
  await railKeeps(page, M);
  await page.getByRole("link", { name: "Start the run" }).click();
  await expect(page).toHaveURL(at("run"), { timeout: 15_000 });
  await expect(page.getByTestId("run-board")).toBeVisible();
  await railKeeps(page, M);
  await page.getByRole("navigation", { name: "Steps" }).getByRole("link", { name: "Debrief" }).click();
  await expect(page).toHaveURL(at("debrief"), { timeout: 15_000 });
  await railKeeps(page, M);
});

test("without ?m=, every building screen redirects to the building's own mission", async ({ page }) => {
  for (const screen of ["scout", "dossier", "plan", "run", "debrief", "drill"]) {
    await page.goto(`/b/F1/${screen}`);
    await expect(page, screen).toHaveURL(at(screen));
  }
  await page.goto("/b/F1");
  await expect(page).toHaveURL(at("scout"));
});

test("another mission on F1 has no level yet, and keeps its ?m=; an unknown one is a 404", async ({ page }) => {
  await page.goto("/b/F1/dossier?m=sunset-1986");
  await expect(page).toHaveURL(at("dossier", "sunset-1986"));
  await expect(page.getByTestId("data-to-level")).toHaveCount(0);
  await railKeeps(page, "sunset-1986");
  const response = await page.goto("/b/F1/dossier?m=no-such-mission");
  expect(response?.status()).toBe(404);
});
