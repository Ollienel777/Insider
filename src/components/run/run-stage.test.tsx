// The Run stage on a live scan (issue 117), drawn on a stubbed Inside view:
// the three modes, the stored choice, the player that does not open, and the
// fixture screen, which gets no stage at all. Nothing here opens a player:
// the stub is never called, because a static render runs no effect.
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InsideView } from "@/adapters/matterport";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { LevelManifest } from "@/domain";
import { createRun } from "@/engine";
import { placeLevel } from "@/level/placer";
import cached from "../../../data/levels/F1.romaine-1974.json";
import { choices } from "./board";
import { BoardView } from "./board-view";
import { RUN_SEED } from "./run-screen";
import { chooseStage, RunStage, SPLIT_COLUMNS, stageShown, StageSwitch, StageView, stageVisualClass } from "./run-stage";
import { FAILED_LINE, FOLLOWS_LINE, ScanFailed, ScanFrame, ScanHead } from "./scan-pane";
import { STAGE_MODE_KEY, STAGE_MODES, type StageMode } from "./stage-store";

const placed = placeLevel(LevelManifest.parse(structuredClone(cached)), structuredClone(FIXTURE_FLOORS.F1), RUN_SEED);
const run = createRun(placed.level);
const board = <BoardView placed={placed} run={run} choices={choices(run)} onChoose={() => {}} />;

/** The Inside view's opener, stubbed: it would never answer, and a static render never asks. */
const open = vi.fn(() => new Promise<InsideView>(() => {}));

const text = (html: string) => html.replace(/&#x27;/g, "'");
const has = (html: string, testId: string) => html.includes(`data-testid="${testId}"`);
const at = (html: string, testId: string) => html.indexOf(`data-testid="${testId}"`);

/** The browser's stored choice, for a stage drawn for the first time. */
function storeChoice(mode: string | null) {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => (key === STAGE_MODE_KEY ? mode : null),
    setItem: () => {},
  });
}

/** The first element under `node` that `match` accepts: for pressing a button of a component with no state. */
function find(node: ReactNode, match: (props: Record<string, unknown>) => boolean): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, match);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return null;
  if (match(node.props)) return node;
  return find(node.props.children as ReactNode, match);
}

const press = (element: ReactElement<Record<string, unknown>> | null) => (element!.props.onClick as () => void)();

const live = () =>
  text(
    renderToStaticMarkup(
      <RunStage open={open} sweepId={run.playerNode} room="Dock Corridor">
        {board}
      </RunStage>,
    ),
  );

afterEach(() => {
  vi.unstubAllGlobals();
  open.mockClear();
});

describe("the stage's three modes on a live scan", () => {
  it("shows the board and the scan side by side by default, the scan the larger", () => {
    const out = live();
    expect(out).toContain('data-testid="run-stage" data-stage="split"');
    expect(has(out, "run-board")).toBe(true);
    expect(has(out, "inside-view")).toBe(true);
    // Side by side from `lg` (1024 px): the board's column, then the scan's.
    expect(out).toContain(SPLIT_COLUMNS);
    const [, boardShare, scanShare] = SPLIT_COLUMNS.match(/^lg:grid-cols-\[minmax\(0,(\d+)fr\)_minmax\(0,(\d+)fr\)\]$/)!;
    expect(Number(scanShare)).toBeGreaterThan(Number(boardShare));
    expect(open).not.toHaveBeenCalled();
  });

  it("stacks in reading order below that: the switch, the board, then the scan under its head", () => {
    const out = live();
    const order = ["stage-switch", "stage-board", "inside-head", "inside-view"].map((id) => at(out, id));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // No column template below `lg`: every column class on the stage starts at that breakpoint.
    const stage = out.match(/<div data-testid="run-stage"[^>]*class="([^"]*)"/)![1];
    expect(stage.split(" ").filter((c) => c.includes("grid-cols") || c.includes("grid-flow"))).toEqual(
      expect.arrayContaining([SPLIT_COLUMNS, "lg:grid-flow-col"]),
    );
    expect(stage.split(" ").some((c) => /^(grid-cols|grid-flow)/.test(c))).toBe(false);
  });

  it("shows the board alone on Board: no scan pane, no head, and no player to open", () => {
    storeChoice("board");
    const out = live();
    expect(out).toContain('data-testid="run-stage" data-stage="board"');
    expect(has(out, "run-board")).toBe(true);
    expect(has(out, "inside-view")).toBe(false);
    expect(has(out, "inside-head")).toBe(false);
    expect(has(out, "inside-frame")).toBe(false);
    expect(out).not.toContain(SPLIT_COLUMNS);
  });

  it("shows the scan alone on Scan, across the whole stage", () => {
    storeChoice("scan");
    const out = live();
    expect(out).toContain('data-testid="run-stage" data-stage="scan"');
    expect(has(out, "run-board")).toBe(false);
    expect(has(out, "stage-board")).toBe(false);
    expect(has(out, "inside-view")).toBe(true);
    expect(out).toMatch(/<section[^>]*data-testid="inside-view"[^>]*class="[^"]*lg:col-span-2/);
    expect(out).not.toContain(SPLIT_COLUMNS);
  });

  it.each(STAGE_MODES)("keeps the switch on screen on %s, with that mode the one pressed", (mode) => {
    storeChoice(mode);
    const out = live();
    for (const option of STAGE_MODES) {
      expect(out).toContain(`data-mode="${option}" aria-pressed="${option === mode}"`);
    }
    expect(out.split('aria-pressed="true"').length - 1).toBe(mode === "board" ? 1 : 2); // and the after-hours toggle, where the scan shows
  });

  it("switches to the mode pressed", () => {
    for (const option of STAGE_MODES) {
      const onChoose = vi.fn();
      press(find(StageSwitch({ mode: "split", onChoose }), (props) => props["data-mode"] === option));
      expect(onChoose).toHaveBeenCalledExactlyOnceWith(option);
    }
  });
});

describe("the stored choice", () => {
  it.each(STAGE_MODES)("draws the stage in %s when that is what the browser kept", (mode) => {
    storeChoice(mode);
    expect(live()).toContain(`data-testid="run-stage" data-stage="${mode}"`);
  });

  it("draws Split when nothing is kept, or what is kept is not a mode", () => {
    storeChoice(null);
    expect(live()).toContain('data-stage="split"');
    storeChoice("sideways");
    expect(live()).toContain('data-stage="split"');
  });

  it("keeps a choice the moment it is made, and nothing when the mode pressed already shows", () => {
    const items = new Map<string, string>();
    const storage = { setItem: vi.fn((key: string, value: string) => void items.set(key, value)) };
    expect(chooseStage("split", "scan", storage)).toEqual({ mode: "scan", reopen: false });
    expect(items.get(STAGE_MODE_KEY)).toBe("scan");
    expect(chooseStage("scan", "scan", storage)).toBeNull();
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it("opens a new player on the way back from Board, where there is none, and not between Split and Scan", () => {
    const storage = { setItem: () => {} };
    const reopens = (from: StageMode, to: StageMode) => chooseStage(from, to, storage)!.reopen;
    expect(reopens("board", "split")).toBe(true);
    expect(reopens("board", "scan")).toBe(true);
    expect(reopens("split", "scan")).toBe(false);
    expect(reopens("scan", "split")).toBe(false);
    expect(reopens("split", "board")).toBe(false);
  });
});

describe("the scan pane says what it is", () => {
  it("carries the Matterport chip, the player's room, and that it follows each hop", () => {
    const out = live();
    const head = out.slice(at(out, "inside-head"), at(out, "inside-view"));
    expect(head).toContain('data-layer="matterport"');
    expect(head).toMatch(/Matterport/);
    expect(head).toMatch(/data-testid="inside-room"[^>]*>Dock Corridor</);
    expect(FOLLOWS_LINE).toBe("The scan at your spot. It follows each hop.");
    expect(out.slice(at(out, "inside-view"))).toContain(FOLLOWS_LINE);
  });

  it("is after hours by default: the look is a filter on the player's frame, and the toggle is pressed", () => {
    const out = live();
    expect(out).toMatch(/data-testid="inside-frame" data-look="after-hours" class="[^"]*\bscan-after-hours\b/);
    expect(out).toMatch(/data-testid="scan-look" aria-pressed="true"/);
  });

  it("shows the scan as scanned with the toggle off: no filter on the frame", () => {
    const out = renderToStaticMarkup(<ScanFrame status="ready" look="as-scanned" />);
    expect(out).toContain('data-look="as-scanned"');
    expect(out).not.toContain("scan-after-hours");
    expect(renderToStaticMarkup(<ScanHead room="Lobby" look="as-scanned" onLook={() => {}} />)).toContain(
      'data-testid="scan-look" aria-pressed="false"',
    );
  });

  it("toggles to the other look", () => {
    for (const [look, other] of [["after-hours", "as-scanned"], ["as-scanned", "after-hours"]] as const) {
      const onLook = vi.fn();
      press(find(ScanHead({ room: "Lobby", look, onLook }), (props) => props["data-testid"] === "scan-look"));
      expect(onLook).toHaveBeenCalledExactlyOnceWith(other);
    }
  });

  it("draws nothing over the player: the frame is an empty element, covered only while it opens", () => {
    expect(renderToStaticMarkup(<ScanFrame status="ready" look="after-hours" />)).toMatch(
      /<div data-testid="inside-frame"[^>]*><\/div><\/div><p/,
    );
    expect(renderToStaticMarkup(<ScanFrame status="connecting" look="after-hours" />)).toContain("animate-pulse");
    expect(renderToStaticMarkup(<ScanFrame status="ready" look="after-hours" />)).not.toContain("animate-pulse");
  });
});

describe("a player that does not open", () => {
  const failed = (mode: StageMode) =>
    text(
      renderToStaticMarkup(
        <StageView
          mode={mode}
          status="failed"
          look="after-hours"
          room="Dock Corridor"
          board={board}
          pane={<ScanFrame status="failed" look="after-hours" />}
          onMode={() => {}}
          onLook={() => {}}
          onRetry={() => {}}
        />,
      ),
    );

  it.each(["split", "scan"] as const)("gives the whole stage to the board on %s, and the pane says so", (mode) => {
    const out = failed(mode);
    expect(out).toContain('data-testid="run-stage" data-stage="board"');
    expect(has(out, "run-board")).toBe(true);
    expect(out).toContain('data-testid="inside-view" data-status="failed"');
    expect(out).toContain(FAILED_LINE);
    expect(FAILED_LINE).toBe("The scan's player didn't open. The board still plays on the scan.");
    // Nothing of the scan's half is left: no frame, no head, no columns, and no switch to a pane that is not there.
    expect(has(out, "inside-frame")).toBe(false);
    expect(has(out, "inside-head")).toBe(false);
    expect(has(out, "stage-switch")).toBe(false);
    expect(out).not.toContain(SPLIT_COLUMNS);
    expect(out).not.toContain("lg:grid-cols-[auto");
  });

  it("is what every mode comes down to, and only when the player failed", () => {
    for (const mode of STAGE_MODES) {
      expect(stageShown(mode, "failed")).toBe("board");
      expect(stageShown(mode, "connecting")).toBe(mode);
      expect(stageShown(mode, "ready")).toBe(mode);
    }
  });

  it("offers Try again, which asks for the player again", () => {
    const out = failed("split");
    expect(out).toMatch(/data-testid="inside-retry"[^>]*>Try again</);
    const onRetry = vi.fn();
    press(find(ScanFailed({ onRetry }), (props) => props["data-testid"] === "inside-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("on fixtures the stage changes nothing", () => {
  it("is the board alone, mark for mark, where there is no Inside view to open", () => {
    const alone = renderToStaticMarkup(board);
    const staged = renderToStaticMarkup(
      <RunStage open={null} sweepId={run.playerNode} room="Dock Corridor">
        {board}
      </RunStage>,
    );
    expect(staged).toBe(alone);
    for (const id of ["run-stage", "stage-switch", "stage-board", "inside-view", "inside-head", "inside-frame", "scan-look"]) {
      expect(has(staged, id), id).toBe(false);
    }
  });

  it("is so whatever choice the browser kept from a live scan", () => {
    const alone = renderToStaticMarkup(board);
    for (const mode of STAGE_MODES) {
      storeChoice(mode);
      expect(
        renderToStaticMarkup(
          <RunStage open={null} sweepId={run.playerNode} room="Dock Corridor">
            {board}
          </RunStage>,
        ),
        mode,
      ).toBe(alone);
    }
  });

  it("leaves the screen's visual its own frame, and only a live stage grows with its stack", () => {
    expect(stageVisualClass(false)).toBe("absolute inset-0 flex flex-col");
    const staged = stageVisualClass(true).split(" ");
    expect(staged).toEqual(expect.arrayContaining(["flex", "flex-col", "lg:absolute", "lg:inset-0"]));
    expect(staged).not.toContain("absolute");
  });
});
