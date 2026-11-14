import { expect, test, type Page } from "@playwright/test";

// Sound on the Run screen (issue 101), on the production build in fake mode.
// Nobody can hear a smoke test. This holds what the unit tests cannot reach:
// that the Run screen opens audio only after the first key press, sends it
// each turn's cues, mutes by the button and by `M`, remembers the choice, and
// plays on where Web Audio is missing or refused.

const board = (page: Page) => page.getByTestId("run-board");
const mute = (page: Page) => page.getByTestId("mute-toggle");
const choice = (page: Page, nodeId: string) => page.locator(`[data-testid="choice"][data-node="${nodeId}"]`);

/** What the page has asked of Web Audio. */
interface Heard {
  /** Audio contexts it tried to open. */
  opened: number;
  /** Sources (oscillators, noise bursts) it started. */
  started: number;
}

/** Counts the page's use of Web Audio, from before it loads. */
async function watchAudio(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __heard: Heard };
    w.__heard = { opened: 0, started: 0 };
    const Real = window.AudioContext;
    window.AudioContext = class extends Real {
      constructor(options?: AudioContextOptions) {
        w.__heard.opened++;
        super(options);
      }
    };
    for (const proto of [AudioScheduledSourceNode.prototype, AudioBufferSourceNode.prototype]) {
      const start = proto.start;
      proto.start = function (this: AudioScheduledSourceNode, ...args: Parameters<typeof start>) {
        w.__heard.started++;
        return start.apply(this, args);
      } as typeof start;
    }
  });
}

const heard = (page: Page) => page.evaluate(() => (window as unknown as { __heard: Heard }).__heard);

/** Every uncaught error on the page, from now on. */
function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function open(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/b/F1/run");
  await expect(board(page)).toBeVisible();
  await expect(board(page)).toHaveAttribute("data-turn", "0");
}

/** Moves to the neighbour `nodeId` by its number key, and waits for the turn. */
async function moveTo(page: Page, nodeId: string, turn: number) {
  const key = await choice(page, nodeId).getAttribute("data-key");
  expect(key, `${nodeId} is numbered`).toMatch(/^[1-9]$/);
  await page.keyboard.press(key!);
  await expect(board(page)).toHaveAttribute("data-turn", String(turn));
}

test("audio opens on the first key press, not before, and each move is sent to it", async ({ page }) => {
  const errors = pageErrors(page);
  await watchAudio(page);
  await open(page);
  expect(await heard(page)).toEqual({ opened: 0, started: 0 });

  await moveTo(page, "fl-lobby", 1);
  await expect.poll(async () => (await heard(page)).started).toBeGreaterThan(0);
  expect((await heard(page)).opened).toBe(1);

  // A second move goes to the same context, and starts more.
  const before = (await heard(page)).started;
  await moveTo(page, "fl-car", 2);
  await expect.poll(async () => (await heard(page)).started).toBeGreaterThan(before);
  expect((await heard(page)).opened).toBe(1);
  expect(errors).toEqual([]);
});

test("Restart plays nothing", async ({ page }) => {
  await watchAudio(page);
  await open(page);
  await moveTo(page, "fl-lobby", 1);
  await expect.poll(async () => (await heard(page)).started).toBeGreaterThan(0);
  const before = (await heard(page)).started;

  await page.getByRole("button", { name: "Restart" }).click();
  await expect(board(page)).toHaveAttribute("data-turn", "0");
  await expect(page.getByTestId("run-status")).toHaveText("Back at the start. The guards are on their rounds.");
  expect((await heard(page)).started).toBe(before);
});

test("the button and M mute, M is not a game key, and the choice survives a reload", async ({ page }) => {
  await watchAudio(page);
  await open(page);
  await expect(mute(page)).toHaveAccessibleName(/Mute/);
  await expect(mute(page)).toHaveAttribute("aria-pressed", "false");

  await page.keyboard.press("m");
  await expect(mute(page)).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Shift+M");
  await expect(mute(page)).toHaveAttribute("aria-pressed", "false");
  await mute(page).click();
  await expect(mute(page)).toHaveAttribute("aria-pressed", "true");
  await expect(board(page)).toHaveAttribute("data-turn", "0");

  // Muted, a move starts nothing.
  const before = (await heard(page)).started;
  await moveTo(page, "fl-lobby", 1);
  expect((await heard(page)).started).toBe(before);

  await page.reload();
  await expect(board(page)).toBeVisible();
  await expect(mute(page)).toHaveAttribute("aria-pressed", "true");
  // Still muted: a move opens no audio at all on this visit.
  await moveTo(page, "fl-lobby", 1);
  expect(await heard(page)).toEqual({ opened: 0, started: 0 });

  // Unmuted, the next move is heard.
  await page.keyboard.press("m");
  await expect(mute(page)).toHaveAttribute("aria-pressed", "false");
  await moveTo(page, "fl-car", 2);
  await expect.poll(async () => (await heard(page)).started).toBeGreaterThan(0);
});

for (const [name, breakAudio] of [
  [
    "has no Web Audio",
    () => {
      delete (window as unknown as { AudioContext?: unknown }).AudioContext;
      delete (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;
    },
  ],
  [
    "refuses to open audio",
    () => {
      window.AudioContext = class {
        constructor() {
          throw new DOMException("audio is not allowed here", "NotAllowedError");
        }
      } as unknown as typeof AudioContext;
    },
  ],
] as const) {
  test(`in a browser that ${name}, the run plays on with no error`, async ({ page }) => {
    const errors = pageErrors(page);
    await page.addInitScript(breakAudio);
    await open(page);
    await moveTo(page, "fl-lobby", 1);
    await page.keyboard.press("w");
    await expect(board(page)).toHaveAttribute("data-turn", "2");
    await page.keyboard.press("m");
    await expect(mute(page)).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("m");
    await moveTo(page, "fl-car", 3);
    await page.getByRole("button", { name: "Restart" }).click();
    await expect(board(page)).toHaveAttribute("data-turn", "0");
    expect(errors).toEqual([]);
  });
}
