// The Inside view panel's lifecycle (`openInsideSession`), which its React
// effects only create, steer and close: it follows the player's sweep, lets
// the player go when the panel goes, and lets go of a player that opens after
// the panel has gone.
import { describe, expect, it, vi } from "vitest";
import type { InsideView } from "@/adapters/matterport";
import { connectInsideView, FLY, PLAYING, type InsidePlayer, type InsideSdk } from "@/adapters/matterport/live";
import { openInsideSession, type InsideStatus } from "./inside-view";

function opener() {
  const view = {
    moveTo: vi.fn<InsideView["moveTo"]>(async () => undefined),
    rotate: vi.fn<InsideView["rotate"]>(async () => undefined),
    onPose: vi.fn<InsideView["onPose"]>(() => () => {}),
    floorPoints: vi.fn<InsideView["floorPoints"]>(async () => new Map()),
    project: vi.fn<InsideView["project"]>(() => null),
    disconnect: vi.fn(),
  } satisfies InsideView;
  let resolve: (v: InsideView) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const open = vi.fn(() => new Promise<InsideView>((res, rej) => ((resolve = res), (reject = rej))));
  return { view, open, opened: () => resolve(view), failed: (e: unknown) => reject(e) };
}

const parent = {} as HTMLElement;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the Inside view panel's session", () => {
  it("goes to the player's sweep once open, then to each new one", async () => {
    const o = opener();
    const statuses: InsideStatus[] = [];
    const session = openInsideSession(o.open, parent, (s) => statuses.push(s));
    session.moveTo("s1");
    expect(o.view.moveTo).not.toHaveBeenCalled();
    o.opened();
    await tick();
    expect(statuses).toEqual(["ready"]);
    expect(o.view.moveTo.mock.calls.map(([id]) => id)).toEqual(["s1"]);
    session.moveTo("s2");
    expect(o.view.moveTo.mock.calls.map(([id]) => id)).toEqual(["s1", "s2"]);
  });

  it("goes to the latest sweep when the player hopped while it opened", async () => {
    const o = opener();
    const session = openInsideSession(o.open, parent, () => {});
    session.moveTo("s1");
    session.moveTo("s2");
    o.opened();
    await tick();
    expect(o.view.moveTo.mock.calls.map(([id]) => id)).toEqual(["s2"]);
  });

  it("only moves the view: it turns nothing and reads nothing from the scan", async () => {
    const o = opener();
    const session = openInsideSession(o.open, parent, () => {});
    session.moveTo("s1");
    o.opened();
    await tick();
    session.moveTo("s2");
    session.close();
    // The panel moves without a travel time, so the view flies as it always has.
    expect(o.view.moveTo.mock.calls).toEqual([["s1"], ["s2"]]);
    expect(o.view.rotate).not.toHaveBeenCalled();
    expect(o.view.onPose).not.toHaveBeenCalled();
    expect(o.view.floorPoints).not.toHaveBeenCalled();
    expect(o.view.project).not.toHaveBeenCalled();
  });

  it("disconnects when the panel closes", async () => {
    const o = opener();
    const session = openInsideSession(o.open, parent, () => {});
    o.opened();
    await tick();
    session.close();
    expect(o.view.disconnect).toHaveBeenCalledTimes(1);
    session.moveTo("s3");
    expect(o.view.moveTo).not.toHaveBeenCalled();
  });

  it("disconnects a player that opens after the panel closed, and says nothing", async () => {
    const o = opener();
    const onStatus = vi.fn();
    const session = openInsideSession(o.open, parent, onStatus);
    session.moveTo("s1");
    session.close();
    o.opened();
    await tick();
    expect(o.view.disconnect).toHaveBeenCalledTimes(1);
    expect(o.view.moveTo).not.toHaveBeenCalled();
    expect(onStatus).not.toHaveBeenCalled();
  });

  it("aborts the opening when the panel closes, so the player leaves the page at once", () => {
    const o = opener();
    const session = openInsideSession(o.open, parent, () => {});
    const signal = (o.open.mock.calls[0] as unknown as [HTMLElement, AbortSignal])[1];
    expect(signal.aborted).toBe(false);
    session.close();
    expect(signal.aborted).toBe(true);
  });

  it("holds a move asked while the player still loads, and flies it once the view opens (issue 117)", async () => {
    // The adapter's own connectInsideView, on a stubbed SDK whose player the test starts.
    let play: () => void = () => {};
    const app: InsideSdk["App"] = {
      state: {
        subscribe(observer) {
          observer({ phase: "appphase.loading" });
          play = () => observer({ phase: PLAYING });
          return { cancel() {} };
        },
      },
    };
    const moveTo = vi.fn<InsideSdk["Sweep"]["moveTo"]>(async () => undefined);
    // A player that is only moved: anything the view could read of the scan fails the test if it is touched.
    const untouched = (what: string) => () => {
      throw new Error(`${what} was used by a view that was only moved`);
    };
    const player: InsidePlayer = {
      App: app,
      Sweep: { moveTo, data: { subscribe: untouched("Sweep.data") } },
      Camera: { pose: { subscribe: untouched("Camera.pose") }, rotate: untouched("Camera.rotate") },
      Conversion: { worldToScreen: untouched("Conversion.worldToScreen") },
      frameSize: untouched("the frame's size"),
      disconnect() {},
    };
    const open = (into: HTMLElement, signal?: AbortSignal) => connectInsideView(into, "m", "k", async () => player, 20_000, signal);
    const statuses: InsideStatus[] = [];
    const session = openInsideSession(open, parent, (s) => statuses.push(s));
    session.moveTo("s1");
    await tick();
    expect(statuses).toEqual([]);
    expect(moveTo).not.toHaveBeenCalled();
    play();
    await vi.waitFor(() => expect(moveTo).toHaveBeenCalledTimes(1));
    expect(moveTo).toHaveBeenCalledWith("s1", expect.objectContaining({ transition: FLY }));
    expect(statuses).toEqual(["ready"]);
    session.close();
  });

  it("says failed when the player does not open", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const o = opener();
    const statuses: InsideStatus[] = [];
    openInsideSession(o.open, parent, (s) => statuses.push(s));
    o.failed(Object.assign(new Error("did not arrive within 20000 ms"), { name: "TimeoutError" }));
    await tick();
    expect(statuses).toEqual(["failed"]);
    warn.mockRestore();
  });
});
