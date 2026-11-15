// What the board's skeleton says while a live scan loads (issue 145): when it
// speaks at all, and what it draws before and after the wait turns slow. The
// timer and the click are checked in a browser against a slowed scan (the PR
// says how); here the panel is rendered for each state it can be in.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Service } from "@/lib/mode";
import { ScanWait, ScanWaitPanel, STAND_IN_AFTER_MS, waitsOnScan } from "./scan-wait";

const status = (fellBack: Service[] = [], ready = true) => ({ ready, fellBack: new Set(fellBack) });

describe("waitsOnScan", () => {
  it("is true for a building with a scan while Matterport is live on the page", () => {
    expect(waitsOnScan(status(), "live", "abcDEF123")).toBe(true);
  });

  it("is false on fixtures: fake mode, and forced in the demo settings (the adapter's mode is then fake)", () => {
    expect(waitsOnScan(status(), "fake", "abcDEF123")).toBe(false);
  });

  it("is false once Matterport has fallen back to fixtures in this browser", () => {
    expect(waitsOnScan(status(["matterport"]), "live", "abcDEF123")).toBe(false);
    // Another service falling back says nothing about the scan.
    expect(waitsOnScan(status(["costar"]), "live", "abcDEF123")).toBe(true);
  });

  it("is false for a building with no scan, and before the browser has its status", () => {
    expect(waitsOnScan(status(), "live", undefined)).toBe(false);
    expect(waitsOnScan(status(), "live", "")).toBe(false);
    expect(waitsOnScan(status([], false), "live", "abcDEF123")).toBe(false);
  });
});

describe("the scan wait panel", () => {
  it("says the scan is loading, as a status, and offers nothing yet", () => {
    const out = renderToStaticMarkup(<ScanWaitPanel slow={false} onStandIn={() => {}} />);
    expect(out).toContain('data-testid="scan-wait"');
    expect(out).toMatch(/<div role="status"[^>]*><p[^>]*>Loading the scan<\/p><\/div>/);
    expect(out).not.toContain("<button");
  });

  it("offers the stand-in floor plan once the wait is slow, and says how to get the scan back", () => {
    const out = renderToStaticMarkup(<ScanWaitPanel slow onStandIn={() => {}} />);
    expect(out).toContain("Loading the scan");
    expect(out).toContain("The stand-in floor plan is ready now.");
    expect(out).toContain("open the demo settings with Shift+?");
    expect(out).toMatch(/<button[^>]*data-testid="use-stand-in"[^>]*>Use the stand-in floor plan<\/button>/);
    // The button is a 40 px target (ui/button.tsx), and the one action on the panel.
    expect(out.match(/<button/g)).toHaveLength(1);
    expect(out).toMatch(/<button[^>]*class="[^"]*\bh-10\b/);
  });

  it("waits longer than a fast scan takes before it offers the way out", () => {
    // Issue 141: on a fast connection the board was up in 12 to 20 s on the dev server, which loads twice.
    expect(STAND_IN_AFTER_MS).toBeGreaterThanOrEqual(10_000);
  });
});

describe("the scan wait on the server", () => {
  it("draws nothing: only the browser knows whether a scan is loading", () => {
    const building = { id: "48213", matterportModelId: "abcDEF123" };
    expect(renderToStaticMarkup(<ScanWait building={building} heistMode="live" onStandIn={() => {}} />)).toBe("");
  });
});
