// The demo safety UI: the chip as served, the fallback toasts and the
// hidden demo settings (Shift+?). The store and the routes behind them are
// tested in src/lib/demo-safety.test.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { newFallback } from "@/lib/fallback";
import { configuredModes } from "@/lib/mode";
import { StatusChip } from "./demo-safety";
import { DemoSettingsPanel, isSettingsKey, settingsRows } from "./demo-settings";
import { ToastStack } from "./toasts";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
const LIVE = { llm: "live", costar: "live", vexcel: "live", matterport: "live" } as const;

describe("StatusChip", () => {
  it("renders what the server served, forced services included, before the browser takes over", () => {
    const html = renderToStaticMarkup(<StatusChip status={{ configured: LIVE, forced: ["costar"], fallbacks: [] }} />);
    expect(html).toContain('data-testid="mode-chip"');
    expect(text(html)).toContain("LIVE");
    expect(text(html)).toContain("On fixtures: CoStar");
  });

  it("says FIXTURES in fake mode, with every service listed", () => {
    const html = renderToStaticMarkup(<StatusChip status={{ configured: configuredModes({}), forced: [], fallbacks: [] }} />);
    expect(text(html)).toContain("FIXTURES On fixtures: Model, CoStar, Vexcel, Matterport");
  });
});

describe("ToastStack", () => {
  it("shows one toast per fallback, naming its service, in a polite live region", () => {
    const toasts = [newFallback("costar"), newFallback("matterport", "no-scan")];
    const html = renderToStaticMarkup(<ToastStack toasts={toasts} onDismiss={() => {}} />);
    expect(html).toContain('aria-live="polite"');
    expect(html.match(/data-testid="fallback-toast"/g)).toHaveLength(2);
    expect(text(html)).toContain("CoStar didn't answer, so buildings use fixtures.");
    expect(text(html)).toContain("This building has no Matterport scan, so the board uses the fixture floor.");
    expect(html.match(/aria-label="Dismiss"/g)).toHaveLength(2);
  });

  it("keeps the live region mounted with no toasts", () => {
    expect(renderToStaticMarkup(<ToastStack toasts={[]} onDismiss={() => {}} />)).toContain('data-testid="toasts"');
  });
});

describe("the demo settings", () => {
  it("opens on Shift+? but never while typing in a field", () => {
    const key = (target: unknown, over: Partial<KeyboardEvent> = {}) =>
      isSettingsKey({ key: "?", shiftKey: true, ctrlKey: false, metaKey: false, altKey: false, target, ...over } as KeyboardEvent);
    const outside = { closest: () => null };
    const field = { closest: () => ({}) };
    expect(key(outside)).toBe(true);
    expect(key(null)).toBe(true);
    expect(key(field)).toBe(false);
    expect(key(outside, { shiftKey: false })).toBe(false);
    expect(key(outside, { metaKey: true })).toBe(false);
    expect(key(outside, { key: "/" })).toBe(false);
  });

  it("describes each service as it is served, and locks the switch where there is nothing live", () => {
    const rows = settingsRows({
      configured: { ...LIVE, matterport: "fake" },
      forced: new Set(["costar"] as const),
      fellBack: new Set(["vexcel"] as const),
    });
    expect(rows.map((r) => [r.label, r.status, r.onFixtures, r.locked])).toEqual([
      ["Model", "Live", false, false],
      ["CoStar", "Forced to fixtures", true, false],
      ["Vexcel", "Fixtures: the live service failed", true, false],
      ["Matterport", "Fixtures: no live configuration", true, true],
    ]);
  });

  it("renders a labelled popover with one switch per service, never a modal", () => {
    const rows = settingsRows({ configured: LIVE, forced: new Set(["costar"] as const), fellBack: new Set() });
    const html = renderToStaticMarkup(<DemoSettingsPanel rows={rows} onToggle={() => {}} onClose={() => {}} />);
    expect(html).toContain('role="dialog"');
    expect(html).not.toContain("aria-modal");
    expect(text(html)).toContain("Demo settings");
    expect(html.match(/role="switch"/g)).toHaveLength(4);
    expect(html).toMatch(/aria-checked="true"[^>]*aria-label="CoStar on fixtures"/);
    expect(html).toMatch(/aria-checked="false"[^>]*aria-label="Model on fixtures"/);
    expect(html).toContain('aria-label="Close demo settings"');
  });
});
