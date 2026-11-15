import { expect, test, type Page } from "@playwright/test";

// The first-person view (issue 115), on the production build in fake mode.
// First person plays in real time: the turn clock runs whether or not the
// player acts, walking into a neighbouring node's area plays that move, and
// holding E at a locked door picks it a turn at a time until the engine opens
// it. Everything is checked against the engine's own state as the view
// exposes it (`data-node`, `data-turn`, `data-locked`) and the run log.
//
// Headless Chromium draws WebGL in software (SwiftShader); the flag keeps
// that on where a newer Chromium would switch it off. Where no WebGL context
// can be made at all, the view falls back to the board with a one-line
// notice, and the tests assert that instead.
//
// Software WebGL draws few frames, and how few depends on the machine. The
// view moves the body and turns the view once a frame, by the time since the
// last one (at most 0.1 s), so neither a count of frames nor a wait in real
// time says how far a held key has gone. These tests never count frames:
// each key is held until the page shows the state it was held for (issue 147).
test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader"] } });

const view = (page: Page) => page.locator('[data-testid="fp-view"][data-ready="true"]');
const turnOf = async (page: Page) => Number(await view(page).getAttribute("data-turn"));

/** Switches to first person. False when this browser has no WebGL, after checking the fallback. */
async function firstPerson(page: Page): Promise<boolean> {
  await page.getByTestId("run-view-first-person").click();
  const notice = page.getByTestId("run-status").filter({ hasText: "First person needs WebGL" });
  await expect(view(page).or(notice)).toBeVisible({ timeout: 30_000 });
  if (await notice.isVisible()) {
    test.info().annotations.push({ type: "fallback", description: "no WebGL here: only the fallback was checked" });
    await expect(page.getByTestId("run-board")).toBeVisible();
    await expect(page.getByTestId("run-view-first-person")).toBeDisabled();
    return false;
  }
  return true;
}

async function open(page: Page, building: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/b/${building}/run`);
  // The first render places the level in the browser, which on a slow machine takes longer than an expect's 5 s.
  await expect(page.getByTestId("run-board")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("run-view")).toHaveAttribute("data-view", "board");
}

/**
 * Holds `key` down until `selector` matches, then lets go; false when it
 * already matched and nothing was held. The letting go happens in the page,
 * the moment the DOM shows the state: a MutationObserver dispatches the key's
 * keyup on `window`, where the view's own key handler takes it as it takes the
 * browser's. The DOM changes in the task after the frame that reached the
 * state, before the view's next frame, so the body or the view stops where the
 * state was reached however slowly frames come, with no round trip to the test
 * runner in between. The runner then lets go of the key too, which changes
 * nothing more.
 */
async function holdUntil(page: Page, keys: { key: string; code: string }, selector: string, timeout: number): Promise<boolean> {
  const already = await page.evaluate(
    ({ code, selector }) => {
      if (document.querySelector(selector)) return true;
      const watch = new MutationObserver(() => {
        if (!document.querySelector(selector)) return;
        watch.disconnect();
        window.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
      });
      watch.observe(document.body, { subtree: true, childList: true, attributes: true });
      return false;
    },
    { code: keys.code, selector },
  );
  if (already) return false;
  await page.keyboard.down(keys.key);
  await expect(page.locator(selector)).toHaveCount(1, { timeout });
  await page.keyboard.up(keys.key);
  return true;
}

test("first person runs in real time, and walking into the next node's area plays the engine's move", async ({ page }) => {
  // Its own waits add up past the default 30 s on a busy machine (the first render, software WebGL's
  // start, the walk), and it timed out there; the E test below has the same budget.
  test.setTimeout(90_000);
  await open(page, "F1");
  if (!(await firstPerson(page))) return;

  await expect(page.getByTestId("run-board")).toHaveCount(0);
  await expect(view(page)).toHaveAttribute("data-node", "fl-car");
  await expect(page.getByTestId("fp-hint")).toContainText("hold");
  // The clock waits for the first move (issue 171): looking around plays no turn. A drag there and
  // back turns the view by a set angle each way, so it faces the lobby again after.
  await expect(page.getByTestId("fp-first-move")).toContainText("The clock starts when you move");
  await page.evaluate(() => {
    const surface = document.querySelector('[data-testid="fp-view"]')!;
    const at = (type: string, x: number) => surface.dispatchEvent(new PointerEvent(type, { button: 0, clientX: x, clientY: 0, pointerId: 1, bubbles: true }));
    at("pointerdown", 0);
    at("pointermove", 200);
    at("pointermove", 0);
    at("pointerup", 0);
  });
  // Several of first person's 700 ms turns: none is played while the player only looks.
  await page.waitForTimeout(3_000);
  expect(await turnOf(page)).toBe(0);
  await expect(page.getByTestId("fp-first-move")).toBeVisible();
  // A tap of W is the first move: from then on the clock runs on its own, turns passing while the
  // player stands still, and they stay put.
  await page.keyboard.press("w");
  await expect(page.getByTestId("fp-first-move")).toHaveCount(0);
  const start = await turnOf(page);
  await expect.poll(() => turnOf(page), { timeout: 10_000 }).toBeGreaterThan(start + 1);
  await expect(view(page)).toHaveAttribute("data-node", "fl-car");
  // No turn timer or play mode switch in first person; Details answers to I, since D strafes.
  await expect(page.getByTestId("turn-timer")).toHaveCount(0);
  await expect(page.getByTestId("details-toggle")).toHaveAttribute("aria-keyshortcuts", "I");

  // The lobby node is straight ahead: walking into its area is the move. W is let go the moment the
  // engine has the player there, so the walk ends in the lobby rather than through its far door.
  const before = await turnOf(page);
  await holdUntil(page, { key: "w", code: "KeyW" }, '[data-testid="fp-view"][data-node="fl-lobby"]', 30_000);
  expect(await turnOf(page)).toBeGreaterThan(before);

  // The run log is the one the Debrief replays: the walk is a move among the clock's waits.
  const log = await page.evaluate(
    () => JSON.parse(localStorage.getItem("heist:run-log:F1:romaine-1974") ?? "null") as { turns: { player: { kind: string; nodeId: string } }[] },
  );
  const kinds = log.turns.map((t) => `${t.player.kind}:${t.player.nodeId}`);
  expect(kinds).toContain("move:fl-lobby");
  expect(kinds.filter((k) => !k.startsWith("wait:")).length).toBeGreaterThanOrEqual(1);

  // Back on the board, the same run, played turn by turn again: the piece stands where first person walked it.
  await page.getByTestId("run-view-board").click();
  await expect(page.getByTestId("run-board")).toBeVisible();
  await expect(page.getByTestId("player-piece")).toHaveAttribute("data-node", "fl-lobby");

  // The choice is remembered for the next visit.
  await page.getByTestId("run-view-first-person").click();
  await page.reload();
  await expect(page.getByTestId("run-view")).toHaveAttribute("data-view", "first-person", { timeout: 30_000 });
});

test("first person: the controls hint is up for a first-time player, and fades once they have walked and looked", async ({ page }) => {
  // As below: the software WebGL's start, on a slow machine.
  test.setTimeout(90_000);
  await open(page, "F1");
  if (!(await firstPerson(page))) return;

  // Issue 146: at the left of the view, every control named, and the suspicion meter up with it.
  const hint = page.getByTestId("fp-controls-hint");
  await expect(hint).toBeVisible();
  for (const words of ["move", "look around", "walk", "pick the lock"]) await expect(hint).toContainText(words);
  await expect(page.getByTestId("fp-notice")).toHaveAttribute("data-tone", /calm|warning|danger/);

  // Looking alone does not clear it. A drag turns the view by a set angle (0.004 rad a pixel), whatever
  // the frame rate: 200 px is 0.8 rad, past the hint's 0.5. Each way in its own frame, so the view counts
  // the turn; back again after, so the walk below heads into the lobby.
  const drag = (from: number, to: number) =>
    page.evaluate(
      ([from, to]) => {
        const surface = document.querySelector('[data-testid="fp-view"]')!;
        const at = (type: string, x: number) => surface.dispatchEvent(new PointerEvent(type, { button: 0, clientX: x, clientY: 0, pointerId: 1, bubbles: true }));
        at("pointerdown", from);
        at("pointermove", to);
        at("pointerup", to);
      },
      [from, to],
    );
  await drag(0, 200);
  await expect(hint.locator("li").nth(1)).toHaveAttribute("data-done", "true");
  await expect(hint).toHaveAttribute("data-phase", "shown");
  await drag(200, 0);
  await expect(hint).toHaveAttribute("data-phase", "shown");

  // Walking too: W is held until the hint starts to fade, then it goes.
  await holdUntil(page, { key: "w", code: "KeyW" }, '[data-testid="fp-controls-hint"][data-phase="fading"]', 30_000);
  await expect(hint).toHaveCount(0, { timeout: 10_000 });
});

test("first person: holding E at a locked door picks it until the engine opens it", async ({ page }) => {
  // As above: the software WebGL's start, on a slow machine.
  test.setTimeout(90_000);
  await open(page, "F3");
  // On the board, to the suite's south-west corner beside the server room's locked door.
  for (const nodeId of ["sl-door", "s1-nw", "s1-sw"]) {
    const key = await page.locator(`[data-testid="choice"][data-node="${nodeId}"]`).getAttribute("data-key");
    expect(key, `${nodeId} is numbered`).toMatch(/^[1-9]$/);
    await page.keyboard.press(key!);
    await expect(page.getByTestId("player-piece")).toHaveAttribute("data-node", nodeId);
  }
  if (!(await firstPerson(page))) return;
  await expect(view(page)).toHaveAttribute("data-node", "s1-sw");
  await expect(view(page)).toHaveAttribute("data-locked", /d-server/);

  // Paused the whole way to the door, so no turn passes and nothing on the floor moves meanwhile.
  await page.keyboard.press("p");
  await expect(page.getByTestId("fp-paused")).toBeVisible();
  const prompt = page.getByTestId("fp-prompt");

  // Turn until the view's line first meets the door (its prompt shows): the line is then within a frame's
  // turn of the door's edge. A drag of the view turns it on by a set angle, 0.004 rad a pixel whatever the
  // frame rate: 45 px, about 10 degrees, takes the line in off the edge. The door, with its frame, spans
  // about 30 degrees from here, and a frame turns the view at most 14 (0.1 s at 2.4 rad/s).
  if (await holdUntil(page, { key: "ArrowRight", code: "ArrowRight" }, '[data-testid="fp-prompt"]', 30_000)) {
    // Through the view's own drag-to-look handlers, as a mouse drag where the pointer is not locked.
    await page.evaluate((px) => {
      const surface = document.querySelector('[data-testid="fp-view"]')!;
      const at = (type: string, x: number) => surface.dispatchEvent(new PointerEvent(type, { button: 0, clientX: x, clientY: 0, pointerId: 1, bubbles: true }));
      at("pointerdown", 0);
      at("pointermove", px);
      at("pointerup", px);
    }, 45);
  }
  await expect(prompt).toHaveAttribute("data-kind", /far|pick/);

  // Walk along the line of view until the prompt says to pick, and stop there. Walking along the line
  // keeps it on the same point of the door, and the door's side of the room is all one node's area.
  await holdUntil(page, { key: "w", code: "KeyW" }, '[data-testid="fp-prompt"][data-kind="pick"]', 30_000);
  await expect(view(page), "the walk stays on the door's node").toHaveAttribute("data-node", "s1-sw");
  await expect(prompt).toContainText("Hold E to pick the lock");
  await expect(page.getByTestId("fp-paused")).toBeVisible();

  // Only now the clock runs again. Hold E: a pick a turn, then the door is open.
  await page.keyboard.press("p");
  await expect(page.getByTestId("fp-paused")).toHaveCount(0);
  await page.keyboard.down("e");
  await expect(prompt).toContainText("Picking");
  await expect(view(page)).not.toHaveAttribute("data-locked", /d-server/, { timeout: 30_000 });
  await page.keyboard.up("e");
  await expect(view(page)).toHaveAttribute("data-node", "s1-sw");
});

// ---- the whole heist in first person (issue 115) -----------------------------------------------

/** Plays the board's numbered neighbour `nodeId`, as the Run screen's number keys do. */
async function boardTo(page: Page, nodeId: string) {
  const key = await page.locator(`[data-testid="choice"][data-node="${nodeId}"]`).getAttribute("data-key");
  expect(key, `${nodeId} is numbered`).toMatch(/^[1-9]$/);
  await page.keyboard.press(key!);
  await expect(page.getByTestId("player-piece")).toHaveAttribute("data-node", nodeId);
}

/** Pauses or resumes first person's clock with P, as the player does. */
async function setPaused(page: Page, on: boolean) {
  const paused = page.getByTestId("fp-paused");
  if (((await paused.count()) > 0) !== on) await page.keyboard.press("p");
  await expect(paused).toHaveCount(on ? 1 : 0);
}

/**
 * One hop along the corner map's route, as a player reading the map would: read the player's place
 * and facing and the route, face the route point ahead, walk to it, and again, until the engine has
 * the player off `from` or the run is over. "Ahead" is the far end of the route segment nearest the
 * player (the player projected onto the route), or the point after it once within 3 map pixels:
 * the route starts at the engine node's centre, so a player past a doorway's first point goes on
 * through the doorway rather than back to that point.
 *
 * Software WebGL draws few frames, at a rate that depends on the machine, and the view moves the
 * body by the time since the last frame, so nothing here counts frames or holds a key for a set
 * time. It runs in the page, so a leg costs no round trips to the test runner. Every input goes
 * to the view's own handlers, as a player's does: the turn is a drag of the view (its drag-to-look,
 * 0.004 rad a pixel, the same at any frame rate), and W is held from a keydown until a
 * MutationObserver sees the map show the player at the point or past it, the engine's node change,
 * or the run end, and lets go before the frames that would carry the body on. A leg in which the
 * body stops moving for a second (held against a wall) ends too, and the next sets off from there.
 * Resolves to "moved" once the player is off `from`; anything else is the reason it is not.
 */
async function hop(page: Page, from: string, legs = 6): Promise<string> {
  return page.evaluate(
    async ({ from, legs }) => {
      type Point = [number, number];
      const view = document.querySelector('[data-testid="fp-view"]')!;
      const off = () => view.getAttribute("data-node") !== from || document.querySelector('[data-testid="fp-end"]') !== null;
      const at = () => {
        const t = document.querySelector('[data-testid="fp-minimap-player"]')?.getAttribute("transform") ?? "";
        const m = /translate\(([-\d.]+),([-\d.]+)\) rotate\(([-\d.]+)\)/.exec(t);
        return m ? { x: Number(m[1]), y: Number(m[2]), yaw: (Number(m[3]) * Math.PI) / 180 } : null;
      };
      const route = (): Point[] => {
        const points = document.querySelector('[data-testid="fp-minimap-route"]')?.getAttribute("points")?.trim() ?? "";
        return points ? points.split(/\s+/).map((p) => p.split(",").map(Number) as Point) : [];
      };
      const ahead = (x: number, y: number, r: Point[]): Point => {
        let best = 1;
        let bestD = Infinity;
        for (let i = 1; i < r.length; i++) {
          const [ax, ay] = r[i - 1];
          const [dx, dy] = [r[i][0] - ax, r[i][1] - ay];
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
          const d = Math.hypot(ax + t * dx - x, ay + t * dy - y);
          if (d < bestD) [best, bestD] = [i, d];
        }
        if (best < r.length - 1 && Math.hypot(r[best][0] - x, r[best][1] - y) <= 3) best++;
        return r[best];
      };
      const drag = (px: number) => {
        const send = (type: string, x: number) => view.dispatchEvent(new PointerEvent(type, { button: 0, clientX: x, clientY: 0, pointerId: 1, bubbles: true }));
        send("pointerdown", 0);
        send("pointermove", px);
        send("pointerup", px);
      };
      // The map's marker follows the body a frame behind: two frames, and it shows where the body stopped.
      const settle = () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
      const walk = (target: Point) =>
        new Promise<void>((resolve) => {
          const start = at()!;
          const reached = () => {
            const p = at();
            if (!p) return false;
            const [tx, ty] = [target[0] - p.x, target[1] - p.y];
            return Math.hypot(tx, ty) <= 2 || tx * (target[0] - start.x) + ty * (target[1] - start.y) <= 0;
          };
          let last = `${start.x},${start.y}`;
          const finish = () => {
            clearInterval(still);
            watch.disconnect();
            window.dispatchEvent(new KeyboardEvent("keyup", { key: "w", code: "KeyW", bubbles: true }));
            resolve();
          };
          const still = setInterval(() => {
            const p = at();
            const now = p ? `${p.x},${p.y}` : last;
            if (now === last) finish();
            last = now;
          }, 1_000);
          const watch = new MutationObserver(() => {
            if (off() || reached()) finish();
          });
          watch.observe(document.body, { subtree: true, childList: true, attributes: true });
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", code: "KeyW", bubbles: true }));
        });
      for (let leg = 0; leg < legs && !off(); leg++) {
        // A move re-renders the map, which puts its marker on the new node's centre, unturned, until the
        // body or the view next moves: a turn of a thousandth of a radian and back brings it to the body.
        if (!at()) {
          drag(0.25);
          await settle();
          drag(-0.25);
          await settle();
        }
        const p = at();
        const r = route();
        if (!p) return "the map does not show the player";
        if (r.length < 2) return "the map shows no route";
        const target = ahead(p.x, p.y, r);
        const want = Math.atan2(target[1] - p.y, target[0] - p.x);
        drag(Math.atan2(Math.sin(want - p.yaw), Math.cos(want - p.yaw)) / 0.004);
        await walk(target);
        await settle();
      }
      return off() ? "moved" : `still on ${from} after ${legs} legs`;
    },
    { from, legs },
  );
}

/** Follows the corner map's route a hop at a time until `arrived`, each hop checked by the engine's node. */
async function followMap(page: Page, arrived: () => Promise<boolean>, hops = 12) {
  for (let i = 0; i < hops && !(await arrived()); i++) {
    const from = (await view(page).getAttribute("data-node"))!;
    expect(await hop(page, from), `the walk leaves ${from}`).toBe("moved");
  }
  expect(await arrived(), "arrived within the walk's hops").toBe(true);
}

test("first person, beat 6: the alarm, the guards on the map, and F opens the Why card on what is in view while the clock holds", async ({ page }) => {
  test.setTimeout(90_000);
  await open(page, "F1");
  // Straight into C2's cover, on the board: the alarm goes to Alert.
  await boardTo(page, "fl-lobby");
  await boardTo(page, "dc-west");
  if (!(await firstPerson(page))) return;
  // First person's clock waits for the first move (issue 171): a tap of W starts it, so the hold below is real.
  await page.keyboard.press("w");
  await expect(page.getByTestId("fp-first-move")).toHaveCount(0);
  await setPaused(page, true);

  // The alarm in first person: the view's edges, and the map's guards hunting.
  await expect(view(page)).toHaveAttribute("data-alarm", /alert|lockdown/);
  await expect(page.getByTestId("fp-alarm-tint")).toBeVisible();
  const map = page.getByTestId("fp-minimap");
  await expect(map).toHaveAttribute("data-room", "dock-corridor");
  await expect(page.getByTestId("fp-minimap-room")).toHaveText("Dock Corridor");
  await expect(map.locator('[data-chasing="true"]').first()).toBeAttached();
  await expect(page.getByTestId("fp-minimap-player")).not.toHaveAttribute("visibility", "hidden");

  // Turn until a watcher is under the crosshair; F opens its Why card, and the clock holds while it is open.
  const aim = page.getByTestId("fp-aim");
  for (let i = 0; i < 200 && (await aim.count()) === 0; i++) {
    await page.keyboard.down("ArrowLeft");
    await page.waitForTimeout(40);
    await page.keyboard.up("ArrowLeft");
  }
  await expect(aim).toBeVisible();
  const key = (await aim.getAttribute("data-why"))!;
  expect(key).toMatch(/^(guard|cleaner|camera):/);
  await page.keyboard.press("f");
  const card = page.getByTestId("why-card");
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-why", key);
  await expect(card.getByTestId("why-row").first()).toBeVisible();
  await setPaused(page, false);
  const turn = await turnOf(page);
  await page.waitForTimeout(1_500);
  expect(await turnOf(page), "the clock holds while the card is open").toBe(turn);
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);

  // Let the guards close in: the catch shows in the view, with the way to the Debrief.
  await expect(page.getByTestId("fp-end")).toHaveAttribute("data-status", "caught", { timeout: 30_000 });
  await expect(page.getByTestId("fp-over")).toContainText("Caught in the");
  await page.getByTestId("fp-debrief").click();
  await expect(page).toHaveURL(/\/b\/F1\/debrief/);
});

test("first person: take the files, then follow the map's route out to a clean exit", async ({ page }) => {
  // The board's moves to the files, then the walk out: at five frames a second it takes nearly two
  // minutes, all of it waiting on the page, so the budget is three.
  test.setTimeout(180_000);
  await open(page, "F1");
  // The quiet route on the board (run.spec.ts) as far as the files.
  await boardTo(page, "fl-lobby");
  await page.keyboard.press("w");
  for (const nodeId of ["dc-west", "dc-mid", "dc-east"]) await boardTo(page, nodeId);
  for (let i = 0; i < 2; i++) {
    const key = await page.locator('[data-testid="choice"][data-kind="pick"]').getAttribute("data-key");
    await page.keyboard.press(key!);
  }
  await boardTo(page, "rr-door");
  await boardTo(page, "rr-files");
  if (!(await firstPerson(page))) return;
  await setPaused(page, true);

  // At the files: the prompt says to hold E, the map marks them, and E takes them.
  const prompt = page.getByTestId("fp-prompt");
  await expect(prompt).toHaveAttribute("data-kind", "take");
  await expect(prompt).toContainText("to take the files");
  await expect(page.getByTestId("fp-minimap-objective")).toHaveCount(1);
  await page.keyboard.down("e");
  await expect(page.getByTestId("fp-minimap-objective")).toHaveCount(0);
  await page.keyboard.up("e");
  await expect(page.getByTestId("fp-minimap")).toHaveAttribute("data-waypoint", /^(fl-car|es-landing)$/);

  // Out the way in, paused but for the quiet route's one wait at the corridor's east end.
  const node = () => view(page).getAttribute("data-node");
  await followMap(page, async () => (await node()) === "dc-east");
  const turn = await turnOf(page);
  await setPaused(page, false);
  await expect.poll(() => turnOf(page)).toBeGreaterThan(turn);
  await setPaused(page, true);
  await followMap(page, async () => (await page.getByTestId("fp-end").count()) > 0);

  await expect(page.getByTestId("fp-end")).toHaveAttribute("data-status", "won");
  await expect(page.getByTestId("fp-over")).toHaveText("Out with the files.");
  await page.getByTestId("fp-debrief").click();
  await expect(page).toHaveURL(/\/b\/F1\/debrief/);
});
