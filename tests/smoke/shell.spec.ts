import { expect, test } from "@playwright/test";

test("the shell shows the product name and the fixtures chip", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Heist Anywhere" })).toBeVisible();
  const chip = page.getByTestId("mode-chip");
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText("FIXTURES");
});
