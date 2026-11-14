// The Inside view panel's lifecycle (`openInsideSession`), which its React
// effects only create, steer and close: it follows the player's sweep, lets
// the player go when the panel goes, and lets go of a player that opens after
// the panel has gone.
import { describe, expect, it, vi } from "vitest";
import type { InsideView } from "@/adapters/matterport";
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
