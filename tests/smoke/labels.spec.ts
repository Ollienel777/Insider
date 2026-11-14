import { expect, test, type Page } from "@playwright/test";

// No label on the board covers another (#68), measured on the frames a judge
// sees at the demo's 1440×900: Plan before and after the crew's answer (beat
// 4), and Run at the start and at the wow beat once the Chief's re-plan has
// streamed in (beat 5). Every <text> on the board is measured as drawn, through
// its own transform (a room's name lies skewed on its tile), as the box its
// glyphs fill: its advance across, and from the cap height to just below the
// baseline down, since every board label is set in caps and digits. Two boxes
// that intersect at all are a collision.

const DEMO_ORDER = "Go in through the dock, wait for the 2 am round to pass, take the records room.";

test.use({ viewport: { width: 1440, height: 900 } });

/** Every pair of labels on the board whose glyph boxes intersect, as "A × B". */
function collisions(page: Page, board: string): Promise<string[]> {
  return page.getByTestId(board).evaluate((svg) => {
    type P = { x: number; y: number };
    const boxes: { text: string; quad: P[] }[] = [];
    for (const el of svg.querySelectorAll<SVGTextElement>("text")) {
      const text = el.textContent?.trim() ?? "";
      if (!text || el.getNumberOfChars() === 0) continue;
      const bbox = el.getBBox();
      const font = parseFloat(getComputedStyle(el).fontSize);
      const baseline = el.getStartPositionOfChar(0).y;
      const top = baseline - 0.78 * font;
      const bottom = baseline + 0.12 * font;
      const m = el.getScreenCTM()!;
      const at = (x: number, y: number): P => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });
      boxes.push({ text, quad: [at(bbox.x, top), at(bbox.x + bbox.width, top), at(bbox.x + bbox.width, bottom), at(bbox.x, bottom)] });
    }
    // The separating axis test for two convex quads; boxes that only touch are apart.
    const apart = (a: P[], b: P[]) =>
      [a, b]
        .flatMap((q) => q.map((p, i) => ({ x: p.y - q[(i + 1) % 4].y, y: q[(i + 1) % 4].x - p.x })))
        .some((axis) => {
          const pa = a.map((p) => p.x * axis.x + p.y * axis.y);
          const pb = b.map((p) => p.x * axis.x + p.y * axis.y);
          return Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa);
        });
    const hits: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (!apart(boxes[i].quad, boxes[j].quad)) hits.push(`${boxes[i].text} × ${boxes[j].text}`);
      }
    }
    return hits;
  });
}

/** How many labels the board draws, so a check over none of them cannot pass. */
const labelCount = (page: Page, board: string) => page.getByTestId(board).locator("text").count();

/** Waits for every piece on the board to land: a collision mid-hop is not a frame anyone stops on. */
async function settled(page: Page, board: string) {
  await expect
    .poll(() => page.getByTestId(board).evaluate((svg) => svg.getAnimations({ subtree: true }).length))
    .toBe(0);
}

test("beat 4: no label on the Plan board covers another, before and after the crew's answer", async ({ page }) => {
  await page.goto("/b/F1/plan");
  await expect(page.getByTestId("plan-board")).toBeVisible();
  expect(await labelCount(page, "plan-board")).toBeGreaterThan(15);
  expect(await collisions(page, "plan-board")).toEqual([]);

  await page.getByTestId("crew-order").fill(DEMO_ORDER);
  await page.getByRole("button", { name: "Brief the crew" }).click();
  await expect(page.getByTestId("ghost-label")).toHaveCount(3, { timeout: 3_000 });
  // This includes the ghost's WAIT · T12 mark against OPEN OFFICE 2210 (PR #64 R1-M1).
  expect(await collisions(page, "plan-board")).toEqual([]);
});

test("beat 5: no label on the Run board covers another, at the start and at the wow beat", async ({ page }) => {
  await page.goto("/b/F1/run");
  const board = page.getByTestId("run-board");
  await expect(board).toBeVisible();
  expect(await labelCount(page, "run-board")).toBeGreaterThan(15);
  expect(await collisions(page, "run-board")).toEqual([]);

  for (const [node, turn] of [["fl-lobby", 1], ["dc-west", 2]] as const) {
    const key = await page.locator(`[data-testid="choice"][data-node="${node}"]`).getAttribute("data-key");
    await page.keyboard.press(key!);
    await expect(board).toHaveAttribute("data-turn", String(turn));
  }
  await expect(page.getByTestId("alarm-banner")).toHaveAttribute("data-state", "alert");
  await expect(page.getByTestId("chief-rationale")).toHaveAttribute("data-done", "true", { timeout: 4_000 });
  await expect(page.getByTestId("chief-order")).toHaveCount(4);
  await settled(page, "run-board");
  expect(await collisions(page, "run-board")).toEqual([]);
});

test("with the Layer lens on, no label or lens mark covers another on Plan and Run (PR #83 R1-M1)", async ({ page }) => {
  // Two page loads, two hops and the Chief's stream (about 2 s); 60 s leaves room for a loaded
  // 2-vCPU VM running two gates (see demo-path.spec.ts).
  test.setTimeout(60_000);
  // The lens marks are <text> on the board (a layer's letter), so the same check covers them.
  await page.goto("/b/F1/plan");
  await expect(page.getByTestId("plan-board")).toBeVisible();
  await page.keyboard.press("l");
  await expect(page.getByTestId("lens-mark").first()).toBeVisible();
  expect(await collisions(page, "plan-board")).toEqual([]);

  await page.goto("/b/F1/run");
  const board = page.getByTestId("run-board");
  await expect(board).toBeVisible();
  await page.keyboard.press("l");
  await expect(page.getByTestId("lens-mark").first()).toBeVisible();
  expect(await page.getByTestId("lens-mark").count()).toBeGreaterThan(6);
  await settled(page, "run-board");
  expect(await collisions(page, "run-board")).toEqual([]);

  for (const [node, turn] of [["fl-lobby", 1], ["dc-west", 2]] as const) {
    const key = await page.locator(`[data-testid="choice"][data-node="${node}"]`).getAttribute("data-key");
    await page.keyboard.press(key!);
    await expect(board).toHaveAttribute("data-turn", String(turn));
  }
  // The stream's own done mark (rationale and every order row), not a fixed wait on the rows (#85).
  await expect(page.getByTestId("chief-rationale")).toHaveAttribute("data-done", "true", { timeout: 30_000 });
  await expect(page.getByTestId("chief-order")).toHaveCount(4);
  await settled(page, "run-board");
  expect(await collisions(page, "run-board")).toEqual([]);
});
