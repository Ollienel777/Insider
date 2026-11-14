import { expect, test, type Page } from "@playwright/test";

// No label on the board covers another (#68), measured on the frames a judge
// sees at the demo's 1440×900: Plan before and after the crew's answer (beat
// 4), and Run at the start and at the wow beat once the Chief's re-plan has
// streamed in (beat 5). Every <text> on the board is measured as drawn, through
// its own transform (a room's name lies skewed on its tile), as the box its
// glyphs fill: its advance across, and from the cap height to just below the
// baseline down, since every board label is set in caps and digits. A Layer
// lens mark counts as its whole chip, not just its letter: a label's halo over
// the chip hides it as surely as its glyphs. Two boxes that intersect at all
// are a collision.

const DEMO_ORDER = "Go in through the dock, wait for the 2 am round to pass, take the records room.";

test.use({ viewport: { width: 1440, height: 900 } });

/** Every pair of labels on the board whose glyph boxes intersect, as "A × B". */
function collisions(page: Page, board: string): Promise<string[]> {
  return page.getByTestId(board).evaluate((svg) => {
    type P = { x: number; y: number };
    const boxes: { text: string; quad: P[] }[] = [];
    const quadOf = (el: SVGGraphicsElement, x0: number, y0: number, x1: number, y1: number): P[] => {
      const m = el.getScreenCTM()!;
      const at = (x: number, y: number): P => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });
      return [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)];
    };
    for (const chip of svg.querySelectorAll<SVGGElement>('[data-testid="lens-mark"]')) {
      const rect = chip.querySelector("rect")!;
      const b = rect.getBBox();
      boxes.push({ text: `lens mark ${chip.dataset.layer}`, quad: quadOf(rect, b.x, b.y, b.x + b.width, b.y + b.height) });
    }
    for (const el of svg.querySelectorAll<SVGTextElement>("text")) {
      if (el.closest('[data-testid="lens-mark"]')) continue;
      const text = el.textContent?.trim() ?? "";
      if (!text || el.getNumberOfChars() === 0) continue;
      const bbox = el.getBBox();
      const font = parseFloat(getComputedStyle(el).fontSize);
      const baseline = el.getStartPositionOfChar(0).y;
      const top = baseline - 0.78 * font;
      const bottom = baseline + 0.12 * font;
      boxes.push({ text, quad: quadOf(el, bbox.x, top, bbox.x + bbox.width, bottom) });
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

/**
 * Each lens chip that a pawn's body covers, as "LAYER chip of KEY × PIECE": a chip that overlaps a
 * pawn must be painted after it, or the pawn hides it (the player under C2's chip at the wow beat).
 */
function chipsUnderPawns(page: Page, board: string): Promise<string[]> {
  return page.getByTestId(board).evaluate((svg) => {
    const hits: string[] = [];
    const pawns = [...svg.querySelectorAll<SVGGElement>('[data-testid$="-piece"][data-node]')];
    for (const chip of svg.querySelectorAll<SVGGElement>('[data-testid="lens-mark"]')) {
      const c = chip.querySelector("rect")!.getBoundingClientRect();
      const owner = chip.closest<SVGElement>("[data-lens], [data-lens-marks-of]");
      const key = owner?.dataset.lens ?? owner?.dataset.lensMarksOf ?? "?";
      for (const pawn of pawns) {
        if (pawn.contains(chip)) continue;
        // The body: the pawn's own drawing (its shadow, figure and head), not its id or marks.
        const body = [...pawn.children].find((el) => el.tagName === "g" && el.querySelector("circle"));
        if (!body) continue;
        const b = body.getBoundingClientRect();
        const overlaps = c.left < b.right && b.left < c.right && c.top < b.bottom && b.top < c.bottom;
        const paintedBefore = (pawn.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
        if (overlaps && paintedBefore) hits.push(`${chip.dataset.layer} chip of ${key} × ${pawn.dataset.id}`);
      }
    }
    return hits;
  });
}

/** How far, in board units, a plan mark's glyphs may stand from its own node (`GHOST_REACH`). */
const GHOST_REACH = 30;

/**
 * Each plan mark's label that covers a camera's, lock's or entry's lens ring, as "LABEL × ring
 * LAYER", or stands farther than `GHOST_REACH` from its own node, as "LABEL: N from its node".
 */
function planLabelFaults(page: Page, board: string, reach: number): Promise<string[]> {
  return page.getByTestId(board).evaluate((svg, reach) => {
    type P = { x: number; y: number };
    const screen = (el: SVGGraphicsElement, x0: number, y0: number, x1: number, y1: number): P[] => {
      const m = el.getScreenCTM()!;
      const at = (x: number, y: number): P => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });
      return [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)];
    };
    const overlap = (a: P[], b: P[]) =>
      Math.min(...a.map((p) => p.x)) < Math.max(...b.map((p) => p.x)) &&
      Math.min(...b.map((p) => p.x)) < Math.max(...a.map((p) => p.x)) &&
      Math.min(...a.map((p) => p.y)) < Math.max(...b.map((p) => p.y)) &&
      Math.min(...b.map((p) => p.y)) < Math.max(...a.map((p) => p.y));
    // The rings of the elements that never move: every lens ring but a guard's.
    const rings = [...svg.querySelectorAll<SVGGraphicsElement>('[data-testid="lens-ring"]')]
      .filter((r) => !r.closest("[data-lens]")?.getAttribute("data-lens")?.startsWith("guard:"))
      .map((r) => {
        const b = r.getBBox();
        const w = 1; // half the ring's stroke
        return { layer: r.dataset.layer, quad: screen(r, b.x - w, b.y - w, b.x + b.width + w, b.y + b.height + w) };
      });
    const faults: string[] = [];
    for (const label of svg.querySelectorAll<SVGTextElement>('[data-testid="ghost-label"]')) {
      const text = label.textContent?.trim() ?? "";
      const b = label.getBBox();
      const font = parseFloat(getComputedStyle(label).fontSize);
      const baseline = label.getStartPositionOfChar(0).y;
      const [top, bottom] = [baseline - 0.78 * font, baseline + 0.12 * font];
      const quad = screen(label, b.x, top, b.x + b.width, bottom);
      for (const ring of rings) if (overlap(quad, ring.quad)) faults.push(`${text} × ring ${ring.layer}`);
      // Its node: the centre of its mark's ring, in the same board units as the label.
      const node = label.parentElement!.querySelector("ellipse")!;
      const [cx, cy] = [node.cx.baseVal.value, node.cy.baseVal.value];
      const dx = Math.max(b.x - cx, 0, cx - (b.x + b.width));
      const dy = Math.max(top - cy, 0, cy - bottom);
      const d = Math.hypot(dx, dy);
      if (d > reach) faults.push(`${text}: ${d.toFixed(1)} from its node`);
    }
    return faults;
  }, reach);
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
  expect(await planLabelFaults(page, "plan-board", GHOST_REACH)).toEqual([]);
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
  // The lens marks are measured as their chips (see `collisions`).
  await page.goto("/b/F1/plan");
  await expect(page.getByTestId("plan-board")).toBeVisible();
  await page.keyboard.press("l");
  await expect(page.getByTestId("lens-mark").first()).toBeVisible();
  expect(await collisions(page, "plan-board")).toEqual([]);
  // After the crew's answer: the ghost's marks keep clear of the chips and of the rings round the
  // cameras, locks and entries, each beside its own node (WAIT · T1 once hid the dock lock's chip,
  // then sat on its ring).
  await page.getByTestId("crew-order").fill(DEMO_ORDER);
  await page.getByRole("button", { name: "Brief the crew" }).click();
  await expect(page.getByTestId("ghost-label")).toHaveCount(3, { timeout: 10_000 });
  expect(await collisions(page, "plan-board")).toEqual([]);
  expect(await planLabelFaults(page, "plan-board", GHOST_REACH)).toEqual([]);

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
  // The player stands below C2 here: C2's chip, the layer behind the trip, is drawn over the pawn.
  expect(await chipsUnderPawns(page, "run-board")).toEqual([]);
});
