// What the board's skeleton says while a live scan loads (issue 145): what the
// panel draws in each state it can be in, when it turns slow, and what the
// button does. Whether a load waits on a scan is the adapter's answer
// (`willLoadLive`, matterport.test.ts); that the two boards hold the panel is
// in scan-wait-wiring.test.tsx.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { offerStandInAfter, ScanWait, ScanWaitPanel, STAND_IN_AFTER_MS, takeStandIn } from "./scan-wait";

describe("the scan wait panel", () => {
  it("is an empty status region first, so its words arrive as a change a screen reader announces", () => {
    const out = renderToStaticMarkup(<ScanWaitPanel state="mounting" onStandIn={() => {}} />);
    expect(out).toContain('data-testid="scan-wait"');
    expect(out).toMatch(/<div role="status"[^>]*><\/div>/);
    expect(out).not.toContain("<button");
  });

  it("says the scan is loading, as a status, and offers nothing yet", () => {
    const out = renderToStaticMarkup(<ScanWaitPanel state="loading" onStandIn={() => {}} />);
    expect(out).toMatch(/<div role="status"[^>]*><p[^>]*>Loading the scan<\/p><\/div>/);
    expect(out).not.toContain("<button");
  });

  it("offers the stand-in floor plan once the wait is slow, and says how to get the scan back", () => {
    const out = renderToStaticMarkup(<ScanWaitPanel state="slow" onStandIn={() => {}} />);
    expect(out).toContain("Loading the scan");
    expect(out).toContain("The stand-in floor plan is ready now.");
    expect(out).toContain("open the demo settings with Shift+?");
    expect(out).toMatch(/<button[^>]*data-testid="use-stand-in"[^>]*>Use the stand-in floor plan<\/button>/);
    // The button is a 40 px target (ui/button.tsx), and the one action on the panel.
    expect(out.match(/<button/g)).toHaveLength(1);
    expect(out).toMatch(/<button[^>]*class="[^"]*\bh-10\b/);
  });
});

describe("when the stand-in floor plan is offered", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** A page whose visibility the test sets. */
  function page(state: "visible" | "hidden") {
    const listeners = new Set<() => void>();
    const doc = {
      visibilityState: state,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    };
    vi.stubGlobal("document", doc);
    return {
      listeners,
      set(next: "visible" | "hidden") {
        doc.visibilityState = next;
        [...listeners].forEach((listener) => listener());
      },
    };
  }

  it("waits longer than a fast scan takes: 6 to 10 s on the production build", () => {
    expect(STAND_IN_AFTER_MS).toBe(15_000);
  });

  it("is not offered a millisecond early, and is offered once", () => {
    vi.useFakeTimers();
    const onSlow = vi.fn();
    offerStandInAfter(onSlow);
    vi.advanceTimersByTime(STAND_IN_AFTER_MS - 1);
    expect(onSlow).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onSlow).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(STAND_IN_AFTER_MS * 2);
    expect(onSlow).toHaveBeenCalledTimes(1);
  });

  it("is never offered once the wait is over (the panel left the page)", () => {
    vi.useFakeTimers();
    const onSlow = vi.fn();
    const stop = offerStandInAfter(onSlow);
    vi.advanceTimersByTime(STAND_IN_AFTER_MS - 1);
    stop();
    vi.advanceTimersByTime(STAND_IN_AFTER_MS);
    expect(onSlow).not.toHaveBeenCalled();
  });

  it("counts only time the page is showing, as the scan's own deadlines do", () => {
    vi.useFakeTimers();
    const tab = page("visible");
    const onSlow = vi.fn();
    const stop = offerStandInAfter(onSlow);
    vi.advanceTimersByTime(5_000);
    tab.set("hidden");
    vi.advanceTimersByTime(60_000);
    expect(onSlow).not.toHaveBeenCalled();
    tab.set("visible");
    vi.advanceTimersByTime(STAND_IN_AFTER_MS - 5_000 - 1);
    expect(onSlow).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onSlow).toHaveBeenCalledTimes(1);
    stop();
    expect(tab.listeners.size).toBe(0);
  });
});

describe("taking the stand-in floor plan", () => {
  it("forces Matterport to fixtures for the session, lets the held scan board go, then loads the floor again", () => {
    const calls: string[] = [];
    takeStandIn(
      () => calls.push("reload"),
      (service, on) => calls.push(`force ${service} ${on}`),
      () => calls.push("release the held board"),
    );
    expect(calls).toEqual(["force matterport true", "release the held board", "reload"]);
  });
});

describe("the scan wait on the server", () => {
  it("draws nothing: only the browser knows whether a scan is loading", () => {
    const building = { id: "48213", matterportModelId: "abcDEF123" };
    expect(renderToStaticMarkup(<ScanWait building={building} heistMode="live" onStandIn={() => {}} />)).toBe("");
  });
});
