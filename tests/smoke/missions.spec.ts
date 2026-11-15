import { expect, test } from "@playwright/test";

// The mission picker (SPEC §2 beat 1, #118), on the production build in fake mode.

const MISSIONS = [
  ["romaine-1974", "The Romaine Street Papers"],
  ["sunset-1986", "Hole in the Ground"],
  ["night-desk", "The Night Desk"],
  ["paper-trail-2001", "Paper Trail"],
  ["syntactic-2019", "Syntactic"],
] as const;

test("/ is the case file: a tab per mission, each opening its Inspired by line, city and era", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pick a mission");
  await expect(page.getByText("Every heist in history needed a building. Our agent finds one that's empty tonight.")).toBeVisible();
  const tabs = page.getByTestId("mission-tab");
  await expect(tabs).toHaveText(MISSIONS.map(([, title]) => title));
  const card = page.getByTestId("mission-card");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Heist · Los Angeles");
  await expect(card.getByTestId("inspired-by")).toHaveText(
    "Inspired by The Summa Corporation burglary, 7000 Romaine St, Hollywood, June 5, 1974",
  );
  await expect(card.getByTestId("era")).toHaveText("built 1974 or earlier");
  await expect(card.getByTestId("source-link")).toHaveAttribute("href", "https://www.cia.gov/stories/story/the-exposing-of-project-azorian");
  for (const [i, [id, title]] of MISSIONS.entries()) {
    await tabs.nth(i).click();
    await expect(card).toHaveAttribute("data-mission", id);
    await expect(card).toContainText(title);
    await expect(card).toContainText("Security shown is game fiction derived from building class and era");
  }
  await tabs.filter({ hasText: "The Night Desk" }).click();
  await expect(card.getByTestId("inspired-by")).toHaveText("A fictional mission, written for the game.");
  // The arrow keys flip the file too.
  await tabs.filter({ hasText: "The Night Desk" }).press("ArrowRight");
  await expect(card).toHaveAttribute("data-mission", "paper-trail-2001");
});

for (const [id, title] of MISSIONS) {
  test(`picking ${id} opens its cast screen`, async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("mission-tab").filter({ hasText: title }).click();
    await page.getByRole("link", { name: "Take the job" }).click();
    await expect(page).toHaveURL(new RegExp(`/m/${id}/cast$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(page.getByTestId("funnel-row")).not.toHaveCount(0);
  });
}
