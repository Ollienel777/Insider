// The Owner screen (issue 128) on the cached F1 level and the F1 fixture floor:
// the setup made from the generated security, the editor's states and inline
// reasons, and the before and after of the Chief's recorded fix, 17 of 50 out
// before and none after, as PR 148 has it.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { ChiefFix, LevelManifest, type Strategy } from "@/domain";
import { summariseBatch as sum } from "@/engine";
import { validateOwnerSetup } from "@/level/owner-setup";
import { placeLevel } from "@/level/placer";
import cached from "../../../data/levels/F1.json";
import fixRecording from "../../../fixtures/llm/fix-F1.json";
import recording from "../../../fixtures/llm/strategies-F1.json";
import { BatchPanel } from "./batch-panel";
import { toEngineFix } from "./chief-fix";
import { ownerZones, playOwnerBatch, rerunOwner } from "./owner-batch";
import { boardCaption, setupKey } from "./owner-ready";
import { extendRound, playable, problemsOf, setupFromPlaced, setupWithFix, startRound } from "./owner-edit";
import type { Selection } from "./owner-board";
import { SetupPanel, type Draft, type Tool } from "./setup-panel";
import type { OwnerBatch, OwnerFix } from "./use-owner-batch";

const manifest = LevelManifest.parse(structuredClone(cached));
const floor = FIXTURE_FLOORS.F1;
const strategies = recording.strategies as Strategy[];
const recordedFix = ChiefFix.parse(fixRecording.fix);
const generated = placeLevel(manifest, floor, 1);
const starting = setupFromPlaced(generated);
const answer = { strategies, dropped: [] };

const noop = () => {};
function editor(draft: Draft, selection: Selection = null, tool: Tool = "select") {
  return renderToStaticMarkup(
    <SetupPanel
      floor={floor}
      draft={draft}
      problems={problemsOf(draft.setup, floor)}
      selection={selection}
      tool={tool}
      saved={[]}
      batchError={null}
      onTool={noop}
      onSelect={noop}
      onEdit={noop}
      onRename={noop}
      onSave={noop}
      onLoad={noop}
      onDelete={noop}
      onReset={noop}
    />,
  );
}

describe("the starting setup", () => {
  it("is the generated security in the owner's terms, and fits the floor", () => {
    expect(starting).toMatchObject({ name: "Generated security", buildingId: "F1", desks: [] });
    expect(starting.guards.map((g) => g.id)).toEqual(["G1", "G2", "G3", "G4"]);
    expect(starting.cameras.map((c) => c.id)).toEqual(["C1", "C2"]);
    expect(Object.keys(starting.doors)).toEqual(generated.level.lockedDoors.toSorted());
    expect(validateOwnerSetup(starting, floor)).toEqual([]);
  });

  it("is keyed as the generated level while untouched, and by its contents once edited", () => {
    expect(setupKey({ setup: starting, pristine: true })).toBe("generated");
    const renamed = { ...starting, name: "Other" };
    expect(setupKey({ setup: renamed, pristine: false })).toBe(setupKey({ setup: starting, pristine: false }));
  });
});

describe("the editor's states", () => {
  it("untouched: the starting point, no problems, nothing saved yet", () => {
    const html = editor({ setup: starting, pristine: true, state: "untouched" });
    expect(html).toContain('data-state="untouched"');
    expect(html).toContain("Starting point");
    expect(html).toContain('data-testid="owner-problems-none"');
    expect(html).toContain('data-testid="owner-saved-empty"');
    expect(html).toContain("4 guards · 2 cameras · 2 locked doors · 0 desks");
  });

  it("editing and saved, and a save the browser refused", () => {
    expect(editor({ setup: starting, pristine: false, state: "editing" })).toContain("Unsaved");
    expect(editor({ setup: starting, pristine: false, state: "saved" })).toContain("Saved on this device. It never leaves this browser.");
    const failed = editor({ setup: starting, pristine: false, state: "save-failed" });
    expect(failed).toContain("Not saved");
    expect(failed).toContain("site data is blocked or full");
  });

  it("a broken round: the error state, the reason inline on the guard and in the list, and no save", () => {
    const drawing = extendRound(startRound(starting, "G1"), "G1", "mc-4");
    const draft: Draft = { setup: drawing, pristine: false, state: "editing" };
    const html = editor(draft, { kind: "guard", id: "G1" }, "round");
    expect(html).toContain('data-state="error"');
    expect(html).toContain("1 problem");
    expect(html).toContain('data-testid="owner-inline-problem"');
    expect(html).toContain("Guard G1&#x27;s round is not a connected loop: &quot;mc-w&quot; and &quot;mc-4&quot; are not neighbours.");
    expect(html).toContain('data-code="round-broken"');
    expect(html).toMatch(/data-testid="owner-save"[^>]*disabled/);
    // The board shows the guard on its post meanwhile: the playable setup has no problem.
    expect(validateOwnerSetup(playable(drawing, floor), floor)).toEqual([]);
    expect(playable(drawing, floor).guards.find((g) => g.id === "G1")!.round).toEqual([]);
  });

  it("an element off the floor is named, and left off the board", () => {
    const off = { ...starting, cameras: [...starting.cameras, { id: "C3", node: "nowhere", kind: "fixed" as const, facing: "n" as const }] };
    const html = editor({ setup: off, pristine: false, state: "editing" }, { kind: "camera", id: "C3" });
    expect(html).toContain("Camera C3 is mounted over &quot;nowhere&quot;, which is not a node of this floor.");
    expect(playable(off, floor).cameras.map((c) => c.id)).toEqual(["C1", "C2"]);
  });
});

describe("50 attempts, the fix, and the rerun", () => {
  const before = playOwnerBatch(manifest, floor, null, answer);
  const rerun = rerunOwner(manifest, floor, null, before, recordedFix);

  it("the untouched setup plays the generated level: 17 of 50 out, then none with the recorded fix", () => {
    expect(before.summary).toMatchObject({ runs: 50, escaped: 17 });
    expect(rerun.dropped).toBeNull();
    expect(rerun.before.escaped).toBe(17);
    expect(rerun.after).toMatchObject({ total: 50, escaped: 0, topRoute: null });
  });

  it("the fixed setup, saved in the owner's terms, keeps every crew in too", () => {
    const fixed = setupWithFix(starting, toEngineFix(recordedFix, ownerZones(manifest, floor)), generated.level, "After the fix");
    expect(validateOwnerSetup(fixed, floor)).toEqual([]);
    expect(fixed.cameras.find((c) => c.id === "C2")).not.toEqual(starting.cameras.find((c) => c.id === "C2"));
    expect(playOwnerBatch(manifest, floor, fixed, answer).summary.escaped).toBe(0);
  });

  it("renders the count, the strip, before and after side by side, and what changed", () => {
    const batch: OwnerBatch = {
      status: "done",
      key: "generated",
      setup: null,
      result: before,
      summary: sum(before),
      recorded: true,
      ms: 1,
    };
    const fix: OwnerFix = { status: "applied", answer: { fix: recordedFix, recorded: true, source: "recorded" }, rerun, ms: 1 };
    const html = renderToStaticMarkup(
      <BatchPanel
        batch={batch}
        fix={fix}
        zones={ownerZones(manifest, floor)}
        generated={generated}
        setupName={null}
        stale={false}
        fixedSaved={null}
        onEdit={noop}
        onRetry={noop}
        onOpenFixed={noop}
      />,
    );
    expect(html).toMatch(/data-testid="owner-count" data-escaped="17" data-total="50"/);
    expect(html).toMatch(/data-testid="owner-before-count" data-escaped="17" data-total="50"/);
    expect(html).toMatch(/data-testid="owner-after-count" data-escaped="0" data-total="50"/);
    expect(html.match(/data-outcome=/g)).toHaveLength(150);
    expect(html).toContain("C2 now covers the dock corridor");
    expect(html).toContain("17 fewer got out");
    expect(html).toContain('data-testid="owner-fix-recorded"');
    expect(html).toContain('data-testid="owner-crew-recorded"');
    expect(html).toMatch(/data-testid="owner-route" data-count="14"/);
    expect(boardCaption(rerun.after, "after")).toBe("After the fix: 0 of 50 got out. No way out to draw");
  });
});
