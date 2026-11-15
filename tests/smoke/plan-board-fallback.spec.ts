import { expect, test } from "@playwright/test";

// The Plan screen's fallback (issue 140), end to end in the browser: when the
// crew route answers its own "no recording" 503 (a kit building whose live
// model timed out), the Plan screen works the plan out on the board, labels it
// the board's, toasts the model's fallback, and hands it to the Run marked as
// the board's. The 503 is stubbed with the route's own body, on F1's board, so
// this needs no kit building and no live model.

const TOAST = "The model didn't answer in time, so the plan is worked out from the board.";

test("a no-recording 503 becomes the board's plan on Plan, with its toast, and reaches the Run as the board's", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/api/crew", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: 'no recorded crew replies for "F1"',
        code: "no-recording",
        reason: "timeout",
        fallback: { service: "llm", id: "llm-smoke-board-1", message: TOAST },
      }),
    }),
  );
  await page.goto("/b/F1/plan");
  await expect(page.getByTestId("plan-board")).toBeVisible();
  await page.getByTestId("crew-order").fill("Go in quietly and take the files.");
  await page.getByRole("button", { name: "Brief the crew" }).click();

  const reply = page.getByTestId("crew-reply");
  await expect(reply).toHaveAttribute("data-source", "board");
  await expect(page.getByTestId("board-plan-chip")).toHaveText("No crew reply");
  await expect(page.getByTestId("board-plan-chip")).toHaveAttribute("title", /didn't answer within the time limit/);
  await expect(page.getByTestId("recorded-chip")).toHaveCount(0);
  await expect(reply).toContainText("The board's plan");
  expect(await page.getByTestId("crew-step").count()).toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId("crew-pushback")).toContainText(/\b[CG]\d\b/);
  await expect(page.getByTestId("ghost-path")).toHaveCount(1);
  // The demo status hears of the model's fallback.
  await expect(page.getByTestId("fallback-toast")).toContainText(TOAST);

  await page.getByRole("link", { name: "Start the run" }).click();
  await expect(page.getByTestId("run-board")).toBeVisible();
  await expect(page.getByTestId("plan")).toHaveAttribute("data-source", "board");
  await expect(page.getByText("The board's plan")).toBeVisible();
});
