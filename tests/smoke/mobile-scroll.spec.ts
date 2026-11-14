import { expect, test } from "@playwright/test";

// At 390×844 (DESIGN.md: mobile) the page never scrolls sideways on Plan and
// Run, nor on Debrief, where the step rail is widest: four steps show their
// check (PR #71: the rail pushed /b/F1/run about 27px wide).

test.use({ viewport: { width: 390, height: 844 } });

for (const step of ["plan", "run", "debrief"] as const) {
  test(`/b/F1/${step} does not scroll sideways at 390×844`, async ({ page }) => {
    await page.goto(`/b/F1/${step}`);
    await expect(page.getByRole("navigation", { name: "Steps" })).toBeVisible();
    if (step !== "debrief") await expect(page.getByTestId(`${step}-board`)).toBeVisible();
    const { scroll, client } = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(scroll, "the page's width").toBeLessThanOrEqual(client);
  });
}
