import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

// Demo safety in fake mode (#26): the hidden settings, the forced-fixtures
// cookie, and what the browser does after `npm run demo:reset`. The live
// paths have no keys here; src/lib/demo-safety.test.ts runs them on stubs.

test("Shift+? opens the demo settings; in fake mode every service is on fixtures and locked", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("mode-chip")).toHaveText("FIXTURES");
  const settings = page.getByRole("dialog", { name: "Demo settings" });
  await expect(settings).toBeHidden();

  await page.keyboard.press("Shift+?");
  await expect(settings).toBeVisible();
  const switches = settings.getByRole("switch");
  await expect(switches).toHaveCount(4);
  for (const name of ["Model", "CoStar", "Vexcel", "Matterport"]) {
    const toggle = settings.getByRole("switch", { name: `${name} on fixtures` });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(toggle).toBeDisabled();
  }
  await expect(page.getByTestId("demo-settings-status-costar")).toHaveText("Fixtures: no live configuration");

  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  // No fallback happened, so no toast.
  await expect(page.getByTestId("fallback-toast")).toHaveCount(0);
});

test("typing ? in the crew's order box does not open the demo settings", async ({ page }) => {
  await page.goto("/b/F1/plan");
  const box = page.getByTestId("crew-order");
  await box.click();
  await page.keyboard.type("Which way, the dock?");
  await expect(box).toHaveValue("Which way, the dock?");
  await expect(page.getByRole("dialog", { name: "Demo settings" })).toBeHidden();
});

test("a session forced to CoStar fixtures still pins five buildings and keeps the chip honest", async ({ page, context, baseURL }) => {
  // Force from a page that has already run, as the settings switch does: a
  // browser that has not yet seen the current demo epoch treats any forced
  // cookie as left over from before the last `demo:reset` and expires it.
  await page.goto("/");
  await context.addCookies([{ name: "heist-fixtures", value: "costar", url: baseURL! }]);
  await page.reload();
  await expect(page.getByTestId("mode-chip")).toHaveText("FIXTURES");
  const response = await page.request.get("/api/buildings");
  const body = (await response.json()) as { mode: string; buildings: unknown[] };
  expect(body).toMatchObject({ mode: "fake" });
  expect(body.buildings).toHaveLength(5);
  await page.keyboard.press("Shift+?");
  await expect(page.getByTestId("demo-settings-status-costar")).toHaveText("Forced to fixtures");
});

test.describe("after npm run demo:reset", () => {
  const epochFile = path.join(process.cwd(), ".heist", "demo-epoch");
  let before: string | null = null;
  test.beforeAll(() => {
    before = existsSync(epochFile) ? readFileSync(epochFile, "utf8") : null;
  });
  test.afterAll(() => {
    if (before === null) rmSync(epochFile, { force: true });
    else writeFileSync(epochFile, before);
  });

  test("the next page load clears the stored run log and the forced fixtures", async ({ page, context, baseURL }) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.setItem("heist:run-log:F1", JSON.stringify({ turns: 14 }));
      localStorage.setItem("heist:crew-plan:F1", "{}");
    });
    await context.addCookies([{ name: "heist-fixtures", value: "costar", url: baseURL! }]);

    // What scripts/demo-reset.mjs writes (its own test covers the rest).
    mkdirSync(path.dirname(epochFile), { recursive: true });
    writeFileSync(epochFile, `smoke-${Date.now()}\n`);

    await page.reload();
    // The epoch script expires the forced cookie and, since that page was
    // rendered with CoStar forced, reloads once more.
    await expect.poll(async () => (await context.cookies()).some((c) => c.name === "heist-fixtures")).toBe(false);
    await page.waitForLoadState("load");
    const stored = await page.evaluate(() => [localStorage.getItem("heist:run-log:F1"), localStorage.getItem("heist:crew-plan:F1")]);
    expect(stored).toEqual([null, null]);
    // The settings say what is served now, not what the cookie said (R1-C2).
    await page.keyboard.press("Shift+?");
    await expect(page.getByTestId("demo-settings-status-costar")).toHaveText("Fixtures: no live configuration");
    await page.keyboard.press("Escape");

    // A run after the reset survives the next page.
    await page.evaluate(() => localStorage.setItem("heist:run-log:F1", "{}"));
    await page.reload();
    expect(await page.evaluate(() => localStorage.getItem("heist:run-log:F1"))).toBe("{}");
  });
});
