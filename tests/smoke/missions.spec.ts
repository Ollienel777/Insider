import { expect, test } from "@playwright/test";

// The mission picker (SPEC §2 beat 1, #118), on the production build in fake mode.

const MISSIONS = [
  ["romaine-1974", "The Romaine Street Papers"],
  ["sunset-1986", "Hole in the Ground"],
  ["night-desk", "The Night Desk"],
  ["paper-trail-2001", "Paper Trail"],
  ["syntactic-2019", "Syntactic"],
] as const;

test("/ lists the five missions, each with its Inspired by line, city and era", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pick a mission");
  const cards = page.getByTestId("mission-card");
  await expect(cards).toHaveCount(5);
  for (const [i, [, title]] of MISSIONS.entries()) await expect(cards.nth(i)).toContainText(title);

  const romaine = cards.filter({ hasText: "The Romaine Street Papers" });
  await expect(romaine).toContainText("Heist · Los Angeles");
  await expect(romaine.getByTestId("inspired-by")).toHaveText(
    "Inspired by The Summa Corporation burglary, 7000 Romaine St, Hollywood, June 5, 1974",
  );
  await expect(romaine.getByTestId("era")).toHaveText("built 1974 or earlier");
  await expect(romaine.getByTestId("source-link")).toHaveAttribute("href", "https://www.cia.gov/stories/story/the-exposing-of-project-azorian");
  await expect(cards.filter({ hasText: "The Night Desk" }).getByTestId("inspired-by")).toHaveText("A fictional mission, written for the game.");
  for (const card of await cards.all()) await expect(card).toContainText("Security shown is game fiction derived from building class and era");
});

for (const [id, title] of MISSIONS) {
  test(`picking ${id} opens its cast screen`, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: new RegExp(title) }).click();
    await expect(page).toHaveURL(new RegExp(`/m/${id}/cast$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(page.getByTestId("funnel-row")).not.toHaveCount(0);
  });
}
