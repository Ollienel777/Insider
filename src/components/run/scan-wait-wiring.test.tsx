// That the Run and Plan boards hold the scan wait over their skeleton (issue
// 145), and what their bar says of the floor plan while it loads. The panel
// itself draws nothing on the server (scan-wait.test.tsx), so here it is
// replaced by a marker that shows what each screen hands it.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LevelManifest } from "@/domain";
import cached from "../../../data/levels/F1.romaine-1974.json";

const waits = vi.hoisted(() => ({ answer: undefined as boolean | undefined }));

vi.mock("./scan-wait", () => ({
  useWaitsOnScan: () => waits.answer,
  ScanWait: ({ building, heistMode }: { building: { id: string }; heistMode?: string }) => (
    <div data-testid="scan-wait-marker" data-building={building.id} data-mode={heistMode} />
  ),
}));

const { RunScreen } = await import("./run-screen");
const { PlanScreen } = await import("@/components/plan/plan-screen");

const manifest = LevelManifest.parse(structuredClone(cached));
const building = { id: "F1", name: "Halvorsen Tower", matterportModelId: "abcDEF123" };
const MARKER = '<div data-testid="scan-wait-marker" data-building="F1" data-mode="live"></div>';

const screens = [
  ["Run", () => <RunScreen building={building} manifest={manifest} heistMode="live" source="fixture" />],
  ["Plan", () => <PlanScreen building={building} manifest={manifest} heistMode="live" source="fixture" />],
] as const;

describe.each(screens)("the %s board while its floor loads", (_name, screen) => {
  afterEach(() => {
    waits.answer = undefined;
  });

  it("holds the scan wait beside its skeleton, with the building and the mode", () => {
    const out = renderToStaticMarkup(screen());
    expect(out).toContain('data-testid="board-skeleton"');
    expect(out).toContain(MARKER);
  });

  it("does not say where the floor plan is from before the browser knows", () => {
    expect(renderToStaticMarkup(screen())).not.toContain("floor plan from");
  });

  it("does not say fixtures while a scan loads", () => {
    waits.answer = true;
    expect(renderToStaticMarkup(screen())).not.toContain("floor plan from");
  });

  it("says fixtures once the browser knows no scan is loading", () => {
    waits.answer = false;
    expect(renderToStaticMarkup(screen())).toContain("floor plan from fixtures");
  });
});

describe("a board with no floor to load", () => {
  it("holds no scan wait", () => {
    const out = renderToStaticMarkup(<RunScreen building={building} manifest={null} heistMode="live" source="fixture" />);
    expect(out).not.toContain("scan-wait-marker");
  });
});
