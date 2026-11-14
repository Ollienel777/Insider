// The layer over the scan (issue 108) on a stubbed Inside view: what it reads
// from the view and when, what it draws from the view's `project`, and that
// its guards, cleaners and cameras open their Why cards.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { InsidePose, InsideView, ScanPoint } from "@/adapters/matterport";
import { openInsideSession } from "@/components/run/inside-view";
import { whyKey } from "@/components/run/why";
import type { PlacedLevel } from "@/level/placer";
import { inspectProps, OverlayDrawing } from "./overlay-drawing";
import { openOverlaySession, type Schedule } from "./overlay-session";
import { overlayFrame, ScanOverlay } from "./scan-overlay";
import { FRAME, pinhole, POINTS, pose, run } from "./testing";

/** A stubbed Inside view: its pose is whatever `look` set last, its `project` a pinhole on that pose. */
function stubView(points: ReadonlyMap<string, ScanPoint> = POINTS) {
  let current: InsidePose = pose({ x: 0, z: -2 });
  const listeners = new Set<(p: InsidePose) => void>();
  let resolvePoints: (p: ReadonlyMap<string, ScanPoint>) => void = () => {};
  const view = {
    moveTo: vi.fn<InsideView["moveTo"]>(async () => undefined),
    rotate: vi.fn<InsideView["rotate"]>(async () => undefined),
    onPose: vi.fn<InsideView["onPose"]>((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    floorPoints: vi.fn<InsideView["floorPoints"]>(() => new Promise((resolve) => (resolvePoints = resolve))),
    project: vi.fn<InsideView["project"]>((p) => pinhole(current)(p)),
    disconnect: vi.fn(),
  } satisfies InsideView;
  return {
    view,
    look(next: InsidePose) {
      current = next;
      for (const l of listeners) l(next);
    },
    pose: () => current,
    sendPoints: () => resolvePoints(points),
    listeners,
  };
}

/** A schedule run by hand, like animation frames. */
function frames() {
  const queue: (() => void)[] = [];
  const schedule: Schedule = (fn) => {
    queue.push(fn);
    return () => queue.splice(queue.indexOf(fn), 1);
  };
  return { schedule, flush: () => queue.splice(0).forEach((fn) => fn()), pending: () => queue.length };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the overlay's session on a stubbed Inside view", () => {
  it("asks for the floor points once and hears the pose at most once a frame, the latest", async () => {
    const stub = stubView();
    const f = frames();
    const onPoints = vi.fn();
    const onPose = vi.fn();
    openOverlaySession(stub.view, { onPoints, onPose }, f.schedule);
    expect(stub.view.floorPoints).toHaveBeenCalledTimes(1);
    stub.sendPoints();
    await tick();
    expect(onPoints).toHaveBeenCalledWith(POINTS);

    stub.look(pose({ x: 0, z: -2 }, 5));
    stub.look(pose({ x: 0, z: -2 }, 10));
    expect(onPose).not.toHaveBeenCalled();
    expect(f.pending()).toBe(1);
    f.flush();
    expect(onPose.mock.calls).toEqual([[pose({ x: 0, z: -2 }, 10)]]);
  });

  it("hears nothing once closed: no pose, no late floor points, and it unsubscribes", async () => {
    const stub = stubView();
    const f = frames();
    const onPoints = vi.fn();
    const onPose = vi.fn();
    const session = openOverlaySession(stub.view, { onPoints, onPose }, f.schedule);
    stub.look(pose({ x: 0, z: -2 }, 5));
    session.close();
    expect(f.pending()).toBe(0);
    expect(stub.listeners.size).toBe(0);
    stub.sendPoints();
    await tick();
    f.flush();
    expect(onPoints).not.toHaveBeenCalled();
    expect(onPose).not.toHaveBeenCalled();
  });

  it("goes on with no floor points when the view fails to give them", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stub = stubView();
    stub.view.floorPoints.mockImplementationOnce(async () => Promise.reject(new Error("gone")));
    const onPoints = vi.fn();
    openOverlaySession(stub.view, { onPoints, onPose: () => {} }, frames().schedule);
    await tick();
    expect(onPoints).toHaveBeenCalledWith(new Map());
    warn.mockRestore();
  });
});

describe("the overlay drawn from a stubbed Inside view", () => {
  const level = run({ start: "a2" });
  const draw = (stub: ReturnType<typeof stubView>, aimed: string | null = null) =>
    overlayFrame(stub.view, { run: level, points: POINTS, pose: stub.pose(), frame: FRAME, aimed });
  const markup = (stub: ReturnType<typeof stubView>, aimed: string | null = null) =>
    renderToStaticMarkup(<OverlayDrawing drawn={draw(stub, aimed)} selected={null} beaconLabel={() => "FILES"} onInspect={() => {}} />);

  it("projects through the view's own project", () => {
    const stub = stubView();
    draw(stub);
    expect(stub.view.project).toHaveBeenCalled();
  });

  it("draws a guard in sight solid, one behind the wall as an outline, and none out of hearing", () => {
    // Standing at a2 looking east (yaw -90) through the office door: G2 (b1) and G3 (b2) are straight ahead, behind the wall.
    const stub = stubView();
    stub.look(pose({ x: 0, z: -5 }, -90));
    const html = markup(stub);
    expect(html).toMatch(/data-id="G2"[^>]*data-seen="outline"/);
    expect(html).toMatch(/data-id="G3"[^>]*data-seen="outline"/);
    expect(html).not.toMatch(/data-id="G[23]"[^>]*data-seen="solid"/);
    // Down the hall (yaw 0): G1 is in sight.
    stub.look(pose({ x: 0, z: -5 }, 0));
    expect(markup(stub)).toMatch(/data-kind="guard" data-id="G1" data-node="a3" data-seen="solid"/);
  });

  it("never draws a guard behind a wall solid from where the spike saw one through it", () => {
    // From a1 looking at the office: G2 is 4 m off, through the wall, and in hearing; G3 is out of hearing.
    const stub = stubView();
    const from = run();
    stub.look(pose({ x: 0, z: -2 }, -45));
    const drawn = overlayFrame(stub.view, { run: from, points: POINTS, pose: stub.pose(), frame: FRAME });
    const guards = drawn.flatMap((d) => (d.kind === "figure" ? [[d.id, d.seen]] : []));
    expect(guards).toContainEqual(["G2", "outline"]);
    expect(guards.map(([id]) => id)).not.toContain("G3");
  });

  it("rings the legal hops in view, the aimed one highlighted, and the watched floor", () => {
    const stub = stubView();
    stub.look(pose({ x: 0, z: -5 }, 0));
    const html = markup(stub, "a3");
    expect(html).toMatch(/data-testid="overlay-hop" data-node="a3" data-aimed="true"/);
    expect(html).toMatch(/data-testid="overlay-watch" data-node="a3"/);
    const plain = markup(stub, null);
    expect(plain).toMatch(/data-testid="overlay-hop" data-node="a3"/);
    expect(plain).not.toMatch(/data-aimed/);
  });

  it("raises the objective's beacon, as an outline out of sight", () => {
    const stub = stubView();
    stub.look(pose({ x: 0, z: -5 }, 0));
    expect(markup(stub)).toMatch(/data-testid="overlay-beacon" data-role="objective" data-node="c2" data-seen="outline"/);
  });

  it("uses tokens only", () => {
    const stub = stubView();
    stub.look(pose({ x: 0, z: -5 }, 0));
    expect(markup(stub)).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("makes guards, cleaners and cameras buttons that open their Why card, keyed as the board keys them", () => {
    const stub = stubView();
    stub.look(pose({ x: 0, z: -5 }, 0));
    const html = markup(stub);
    expect(html).toMatch(/role="button"[^>]*aria-label="Why is guard G1 here\?"[^>]*data-overlay-why="guard:G1"/);
    expect(html).toMatch(/aria-label="Why is camera C1 here\?"[^>]*data-overlay-why="camera:C1"/);
    // The board's Why targets use the same keys, so a click opens the same card.
    const keys = draw(stub).flatMap((d) => (d.kind === "figure" || d.kind === "camera" ? [d.key] : []));
    expect(keys).toEqual(expect.arrayContaining([whyKey.guard("G1"), whyKey.camera("C1")]));
  });

  it("opens the card on a click and on Enter, and leaves other keys to the game", () => {
    const onInspect = vi.fn();
    const props = inspectProps("guard:G1", "Why is guard G1 here?", onInspect);
    const el = {} as Element;
    props.onClick({ currentTarget: el } as never);
    expect(onInspect).toHaveBeenLastCalledWith("guard:G1", el);
    const enter = { key: "Enter", currentTarget: el, preventDefault: vi.fn() };
    props.onKeyDown(enter as never);
    expect(onInspect).toHaveBeenCalledTimes(2);
    expect(enter.preventDefault).toHaveBeenCalled();
    props.onKeyDown({ key: "w", currentTarget: el, preventDefault: vi.fn() } as never);
    expect(onInspect).toHaveBeenCalledTimes(2);
    // Only the pieces take the pointer: the rest of the layer lets a drag reach the player.
    expect(props.style.pointerEvents).toBe("all");
    expect(renderToStaticMarkup(<OverlayDrawing drawn={[]} selected={null} beaconLabel={() => ""} onInspect={() => {}} />)).toContain(
      "pointer-events-none",
    );
  });
});

describe("the layer in the Inside view", () => {
  it("is handed the view once the player opens", async () => {
    const stub = stubView();
    const onStatus = vi.fn();
    openInsideSession(async () => stub.view, {} as HTMLElement, onStatus);
    await tick();
    expect(onStatus).toHaveBeenCalledWith("ready", stub.view);
  });

  it("renders an empty layer before the floor points and the pose arrive", () => {
    const stub = stubView();
    const html = renderToStaticMarkup(<ScanOverlay view={stub.view} placed={placedFor()} run={run()} />);
    expect(html).toContain('data-testid="scan-overlay"');
    expect(html).toContain('data-status="loading"');
    expect(html).not.toContain("overlay-figure");
  });
});

describe("the layer on issue 107's full-stage scan", () => {
  it("takes exactly what ScanStage's overlay render prop passes, plus the run and the placed level", () => {
    const stub = stubView();
    // The shape of ScanStage's `overlay` argument (src/components/scan/scan-stage.tsx on feat/107-scan-run-view).
    const scan: { view: InsideView; sweepId: string; hops: readonly string[]; aimed: string | null } = {
      view: stub.view,
      sweepId: run().playerNode,
      hops: ["a3"],
      aimed: "a3",
    };
    const html = renderToStaticMarkup(<ScanOverlay {...scan} run={run()} placed={placedFor()} />);
    expect(html).toContain('data-testid="scan-overlay"');
    expect(html).toMatch(/class="pointer-events-none/);
  });
});

/** Enough of a placed level for the layer's Why cards. */
function placedFor(): PlacedLevel {
  const level = run().board.level;
  return {
    level,
    entries: [],
    zones: [],
    objective: { nodeId: "c2", zoneId: "store", provenance: [] },
    locks: [],
    cameras: [],
    guards: [],
    watch: null,
    cleaners: [],
    unplaced: [],
  };
}
