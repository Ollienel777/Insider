// The Owner screen (issue 128) on the cached F1 level and the F1 fixture floor:
// the setup made from the generated security and its exact round trip, the
// editor's states and inline reasons, and the before and after of the Chief's
// recorded fix, 17 of 50 out before and none after, as the batch debrief has it.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { ChiefFix, LevelManifest, type Strategy } from "@/domain";
import { OwnerSetup } from "@/domain/owner-setup";
import { applyFix, BATCH_SEEDS, rerunWithFix, runBatch, summariseBatch as sum, varyLevel, type Level } from "@/engine";
import { applyOwnerSetup, validateOwnerSetup } from "@/level/owner-setup";
import { placeLevel, type PlacedLevel } from "@/level/placer";
import cached from "../../../data/levels/F1.romaine-1974.json";
import fixRecording from "../../../fixtures/llm/fix-F1.json";
import recording from "../../../fixtures/llm/strategies-F1.json";
import { BatchPanel } from "./batch-panel";
import { toEngineFix, type FixAnswer } from "./chief-fix";
import { compareOptions, ComparePanel, ComparePicker, defaultPick, DemoList, type CompareOption } from "./compare-panel";
import { demoSetups, isDemoSetup } from "./demo-setups";
import { compareOwnerSetups, ownerZones, playOwnerBatch, rerunOwner } from "./owner-batch";
import { boardCaption, pairCaption, setupKey } from "./owner-ready";
import {
  addGuard,
  boardOf,
  extendRound,
  levelForSetup,
  moveGuard,
  playable,
  problemsOf,
  removeCamera,
  setDoor,
  setTempo,
  setupChanges,
  setupFromPlaced,
  setupWithFix,
  startRound,
  toggleDesk,
  updateCamera,
} from "./owner-edit";
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

/** The batch on the generated level itself, with `change` made to each seed's level: what the batch debrief plays. */
const generatedBatch = (m: LevelManifest = manifest, change: (level: Level) => Level = (l) => l) =>
  runBatch({ buildingId: m.buildingId, strategies, levelFor: (seed) => change(placeLevel(m, floor, seed).level) });

/** The security a batch meets on one seed, as the engine plays it. */
const security = (level: Level) => {
  const varied = varyLevel(level);
  return {
    guards: varied.guards,
    tempo: varied.guards.map((g) => varied.guardTempo?.[g.id] ?? varied.patrolTempo),
    cameras: varied.cameras,
    cleaners: varied.cleaners ?? [],
    locked: [...varied.lockedDoors].sort(),
    pickTurns: varied.lockedDoors.map((d) => varied.doorPickTurns?.[d] ?? varied.pickTurns),
  };
};

describe("the round trip", () => {
  const applied = (setup: OwnerSetup, seed: number, m: LevelManifest = manifest) => {
    const out = applyOwnerSetup(m, floor, setup, seed);
    if (!out.ok) throw new Error(out.errors.map((e) => e.reason).join("; "));
    return out.placed;
  };

  it("the generated security as a setup plays the generated level: the same security on every seed, the same batch, 17 of 50", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      expect(security(applied(starting, seed).level)).toEqual(security(placeLevel(manifest, floor, seed).level));
    }
    const owner = playOwnerBatch(manifest, floor, starting, answer);
    expect(owner).toEqual(generatedBatch());
    expect(owner.summary.escaped).toBe(17);
  });

  it("survives a save: the stored setup parses and plays the same batch", () => {
    const stored = OwnerSetup.parse(JSON.parse(JSON.stringify(starting)));
    expect(playOwnerBatch(manifest, floor, stored, answer)).toEqual(generatedBatch());
  });

  it("keeps the night cleaners walking their rounds, with the zone's provenance", () => {
    // Without the vacant Open Office 2210 the office is occupied, so the rules table puts a cleaner there.
    const busy = { ...manifest, zones: manifest.zones.filter((z) => z.id !== "quiet-2210") };
    const placed = placeLevel(busy, floor, 1);
    expect(placed.level.cleaners?.length).toBeGreaterThan(0);
    const setup = setupFromPlaced(placed);
    expect(setup.cleaners?.map((c) => c.id)).toEqual(placed.level.cleaners?.map((c) => c.id));
    expect(validateOwnerSetup(setup, floor)).toEqual([]);
    for (const seed of [1, 2, 3]) {
      expect(security(applied(setup, seed, busy).level)).toEqual(security(placeLevel(busy, floor, seed).level));
    }
    const crowded = placed.zones.find((z) => z.role === "crowded")!;
    expect(applied(setup, 1, busy).cleaners[0].provenance).toBe(crowded.provenance);
    const batch = runBatch({ buildingId: "F1", strategies, levelFor: (seed) => applied(setup, seed, busy).level });
    expect(batch).toEqual(generatedBatch(busy));
  });

  it("moving one guard changes the batch by that move alone: 17 to 19", () => {
    const moved = moveGuard(starting, "G3", "o-east");
    const owner = playOwnerBatch(manifest, floor, moved, answer);
    const expected = generatedBatch(manifest, (level) => ({
      ...level,
      guards: level.guards.map((g) => (g.id === "G3" ? { ...g, patrol: ["o-east"] } : g)),
    }));
    expect(owner).toEqual(expected);
    expect(owner.summary.escaped).toBe(19);
  });

  it("keeps the data's provenance on what is still generated, and the owner's on what was edited", () => {
    const board = boardOf(manifest, floor, starting, 1)!;
    expect(board.guards.map((g) => g.provenance)).toEqual(generated.guards.map((g) => g.provenance));
    expect(board.cameras.map((c) => c.provenance)).toEqual(generated.cameras.map((c) => c.provenance));
    expect(board.locks.map((l) => l.provenance)).toEqual(
      [...generated.locks].sort((a, b) => a.doorId.localeCompare(b.doorId)).map((l) => l.provenance),
    );
    expect(board.guards.flatMap((g) => g.provenance).some((p) => p.layer === "costar")).toBe(true);

    const moved = moveGuard(starting, "G1", "mc-1");
    expect(moved.generated?.guards).toEqual(["G2", "G3", "G4"]);
    const after = applied(moved, 1);
    expect(after.guards.find((g) => g.id === "G1")!.provenance[0]).toMatchObject({ layer: "owner" });
    expect(after.guards.find((g) => g.id === "G2")!.provenance).toEqual(generated.guards.find((g) => g.id === "G2")!.provenance);
    expect(boardOf(manifest, floor, moved, 1)!.guards.find((g) => g.id === "G1")!.provenance).toEqual([]);
  });

  it("keeps a camera's generated cover until it is moved, turned or changed", () => {
    const c2 = starting.cameras.find((c) => c.id === "C2")!;
    expect(c2.cover).toEqual(generated.cameras.find((c) => c.id === "C2")!.cover);
    expect(updateCamera(starting, "C2", { facing: c2.facing }).cameras.find((c) => c.id === "C2")!.cover).toEqual(c2.cover);
    const turned = updateCamera(starting, "C2", { facing: c2.facing === "n" ? "s" : "n" });
    expect(turned.cameras.find((c) => c.id === "C2")!.cover).toBeUndefined();
    expect(turned.generated?.cameras).toEqual(["C1"]);
  });

  it("a click that changes nothing leaves the camera generated, and the setup as it was", () => {
    const c2 = starting.cameras.find((c) => c.id === "C2")!;
    expect(starting.generated?.cameras).toContain("C2");
    for (const change of [{ facing: c2.facing }, { kind: c2.kind }, { node: c2.node }, {}]) {
      const same = updateCamera(starting, "C2", change);
      expect(same).toBe(starting);
      expect(same.generated?.cameras).toContain("C2");
    }
  });

  it("plays a setup saved before cleaners, covers and the generated list as it did: every camera's cover from its facing, all the owner's", () => {
    // As a setup was stored before them: no cleaners, no kept covers, no generated list.
    const older = OwnerSetup.parse({
      version: 1,
      name: starting.name,
      buildingId: starting.buildingId,
      guards: starting.guards,
      cameras: starting.cameras.map((c) => ({ id: c.id, node: c.node, kind: c.kind, facing: c.facing })),
      doors: starting.doors,
      desks: starting.desks,
    });
    // What the screen counted for it before the round trip was exact.
    expect(playOwnerBatch(manifest, floor, older, answer).summary.escaped).toBe(24);
    const placed = applied(older, 1);
    expect(placed.cameras.find((c) => c.id === "C2")!.cover).not.toEqual(generated.cameras.find((c) => c.id === "C2")!.cover);
    for (const element of [...placed.guards, ...placed.cameras, ...placed.locks]) {
      expect(element.provenance[0]).toMatchObject({ layer: "owner" });
    }
  });
});

describe("50 attempts, the fix, and the rerun", () => {
  const before = playOwnerBatch(manifest, floor, starting, answer);
  const rerun = rerunOwner(manifest, floor, starting, before, recordedFix);

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
      setup: starting,
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
        side="before"
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
    expect(html).toMatch(/data-testid="owner-route" data-side="before" data-count="14"/);
    expect(boardCaption(rerun.after, "after")).toBe("After the fix: 0 of 50 got out. No way out to draw.");
  });

  it("the route and the detector card follow the side the board shows", () => {
    const batch: OwnerBatch = { status: "done", key: "generated", setup: starting, result: before, summary: sum(before), recorded: true, ms: 1 };
    const applied: OwnerFix = { status: "applied", answer: { fix: recordedFix, recorded: true, source: "recorded" }, rerun, ms: 1 };
    const panel = (fix: OwnerFix, side: "before" | "after") =>
      renderToStaticMarkup(
        <BatchPanel
          batch={batch}
          fix={fix}
          side={side}
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
    const beforeTop = sum(before).detectors[0];
    const afterTop = rerun.after.detectors[0];

    const shownBefore = panel(applied, "before");
    expect(shownBefore).toMatch(/data-testid="owner-route" data-side="before" data-count="14"/);
    expect(shownBefore).toContain("Before the fix: The way most got out");
    expect(shownBefore).toContain(`data-detector="${beforeTop.kind}:${beforeTop.id}"`);
    expect(shownBefore).toContain("Before the fix: Noticed the crew first most often");

    const shownAfter = panel(applied, "after");
    expect(shownAfter).toMatch(/data-testid="owner-route" data-side="after" data-count="0"/);
    expect(shownAfter).toContain("After the fix: The way most got out");
    if (afterTop) {
      expect(shownAfter).toContain(`data-detector="${afterTop.kind}:${afterTop.id}"`);
      expect(shownAfter).toContain(`data-count="${afterTop.count}"`);
      expect(shownAfter).toContain('data-side="after"');
    } else {
      expect(shownAfter).toContain('data-testid="owner-detector-none"');
    }

    // Before any fix, the side does not apply: the batch itself, with no side named.
    const noFix = panel({ status: "idle" }, "after");
    expect(noFix).toMatch(/data-testid="owner-route" data-side="" data-count="14"/);
    expect(noFix).not.toContain("Before the fix:");
  });
});

// ---- the prepared demo pair, and the compare (issue 31) ----------------------------------

describe("the prepared demo pair", () => {
  const demos = demoSetups("F1");
  const [night, moved] = demos.map((d) => d.setup);

  it("is two named, made-up setups on F1, every element the owner's, that fit the floor", () => {
    expect(demos.map((d) => d.setup.name)).toEqual(["Demo: night shift", "Demo: night shift, C2 moved"]);
    for (const { setup, note } of demos) {
      expect(validateOwnerSetup(setup, floor)).toEqual([]);
      expect(setup.generated).toBeUndefined();
      expect(setup.buildingId).toBe("F1");
      expect(note.length).toBeGreaterThan(0);
    }
    expect(demos[0].note).toContain("Made up");
    expect(demoSetups("F2")).toEqual([]);
  });

  it("differs by one change: C2 moved from the freight lift lobby into the dock corridor", () => {
    expect(setupChanges(night, moved, floor)).toEqual(["C2 moved from the Freight Lift Lobby to the Dock Corridor"]);
    expect(setupChanges(moved, night, floor)).toEqual(["C2 moved from the Dock Corridor to the Freight Lift Lobby"]);
    expect(setupChanges(night, night, floor)).toEqual([]);
  });

  it("gets 7 of 50 out, then 1 of 50 with C2 moved, the same on every run", () => {
    const [a, b] = compareOwnerSetups(manifest, floor, night, moved, answer);
    expect(a.summary).toMatchObject({ total: 50, escaped: 7 });
    expect(b.summary).toMatchObject({ total: 50, escaped: 1 });
    expect(Object.fromEntries(a.summary.byStrategy.map((s) => [s.strategyId, s.escaped]))).toEqual({
      "dock-patient": 3,
      "dock-fast": 4,
      "roof-quiet": 0,
      "suite-detour": 0,
      "dock-in-roof-out": 0,
    });
    expect(Object.fromEntries(b.summary.byStrategy.map((s) => [s.strategyId, s.escaped]))).toEqual({
      "dock-patient": 0,
      "dock-fast": 1,
      "roof-quiet": 0,
      "suite-detour": 0,
      "dock-in-roof-out": 0,
    });
    expect(a.summary.topRoute?.count).toBe(7);
    expect(b.summary.topRoute?.count).toBe(1);
    expect(a.summary.detectors[0]).toMatchObject({ kind: "cleaner", id: "D1" });
    expect(b.summary.detectors[0]).toMatchObject({ kind: "camera", id: "C2" });
    // Again, and each alone: the same batches.
    expect(compareOwnerSetups(manifest, floor, night, moved, answer)).toEqual([a, b]);
    expect(playOwnerBatch(manifest, floor, night, answer)).toEqual(a.result);
    expect(playOwnerBatch(manifest, floor, moved, answer)).toEqual(b.result);
  });

  it("C2 sees only the lobby floor before, and the corridor, the lobby and the lift after", () => {
    const cover = (setup: OwnerSetup) => boardOf(manifest, floor, setup, 1)!.cameras.find((c) => c.id === "C2")!.cover;
    expect(cover(night)).toEqual(["fl-lobby"]);
    expect(cover(moved)).toEqual(["dc-west", "fl-lobby", "fl-car"]);
  });

  it("is still itself once saved: a stored copy parses and reads as made up", () => {
    const stored = OwnerSetup.parse(JSON.parse(JSON.stringify(night)));
    expect(isDemoSetup(stored)).toBe(true);
    expect(isDemoSetup({ ...stored, desks: [] })).toBe(false);
    expect(isDemoSetup(starting)).toBe(false);
  });

  it("shows in the editor as made up, with a Load button each", () => {
    const html = renderToStaticMarkup(<DemoList demos={demos} onLoad={noop} />);
    expect(html.match(/data-testid="owner-demo-load"/g)).toHaveLength(2);
    expect(html.match(/data-testid="owner-made-up-chip"/g)).toHaveLength(2);
    const loaded = editor({ setup: night, pristine: false, state: "preset" });
    expect(loaded).toContain('data-state="preset"');
    expect(loaded).toContain("A made-up setup prepared for the demo, not any real building&#x27;s.");
    expect(loaded).toContain("4 guards · 2 cameras · 2 locked doors · 1 desk");
  });
});

describe("what changed between two setups", () => {
  it("names each element's change in the owner's words", () => {
    let b = setTempo(starting, "G1", 2);
    b = moveGuard(b, "G3", "mc-w");
    b = updateCamera(b, "C1", { kind: "fixed", facing: "n" });
    b = setDoor(b, "d-records-room", "badge");
    b = setDoor(b, "d-server-closet", "open");
    b = toggleDesk(b, "el-north");
    b = removeCamera(b, "C2");
    b = addGuard(b, "o-west").setup;
    expect(setupChanges(starting, b, floor)).toEqual([
      "G1 takes 2 turns per hop (was 1)",
      "G3 moved from the West Stair (Stair B) to the Main Corridor",
      "G5 added, posted in the Open Office 2210",
      "C2 removed",
      "C1 turned to face N (was SW), is now fixed (was sweeping)",
      "Door d-records-room is now a badge reader (was a key lock)",
      "Door d-server-closet is left open (was a key lock)",
      "A staffed desk in the Elevator Lobby",
    ]);
  });

  it("names the nodes when an element moves inside one room, and ignores the name and the generated list", () => {
    const moved = moveGuard(starting, "G1", "mc-1");
    // mc-1 is on G1's round, so it keeps walking it.
    expect(setupChanges(starting, moved, floor)).toEqual(["G1 moved from mc-w to mc-1 in the Main Corridor"]);
    expect(setupChanges(starting, moveGuard(starting, "G1", "o-west"), floor)).toEqual([
      "G1 moved from the Main Corridor to the Open Office 2210, stands its post",
    ]);
    expect(setupChanges(starting, { ...starting, name: "Other", generated: {} }, floor)).toEqual([]);
  });
});

describe("the compare", () => {
  const demos = demoSetups("F1");
  const [night, moved] = demos.map((d) => d.setup);
  const saved = { ...starting, name: "My night" };

  it("offers the prepared setups first, then the saved ones, and starts on the prepared pair", () => {
    const options = compareOptions(demos, [saved, night]);
    expect(options.map((o) => [o.value, o.madeUp])).toEqual([
      ["demo:Demo: night shift", true],
      ["demo:Demo: night shift, C2 moved", true],
      ["saved:My night", false],
      ["saved:Demo: night shift", false],
    ]);
    expect(defaultPick(options)).toEqual({ a: "demo:Demo: night shift", b: "demo:Demo: night shift, C2 moved" });
    expect(defaultPick(compareOptions([], [saved]))).toEqual({ a: "saved:My night", b: "saved:My night" });
  });

  it("picks any two: an empty list says to save two, the same one twice blocks the run", () => {
    const picker = (options: CompareOption[], pick: { a: string; b: string }) =>
      renderToStaticMarkup(<ComparePicker options={options} pick={pick} planning={false} onPick={noop} onCompare={noop} />);
    expect(picker([], { a: "", b: "" })).toContain('data-testid="owner-pair-empty"');
    const options = compareOptions(demos, [saved]);
    expect(picker(options, defaultPick(options))).not.toMatch(/data-testid="owner-pair-run"[^>]*disabled/);
    const same = picker(options, { a: "saved:My night", b: "saved:My night" });
    expect(same).toMatch(/data-testid="owner-pair-run"[^>]*disabled/);
    expect(same).toContain("Pick two different setups.");
  });

  it("renders each side's count, strip, way out and detector, and what changed, A to B", () => {
    const sides = compareOwnerSetups(manifest, floor, night, moved, answer);
    const boards: [PlacedLevel, PlacedLevel] = [boardOf(manifest, floor, night, 1)!, boardOf(manifest, floor, moved, 1)!];
    const html = (side: "a" | "b") =>
      renderToStaticMarkup(
        <ComparePanel
          pair={{ status: "done", sides, recorded: true }}
          floor={floor}
          boards={boards}
          madeUp={[true, true]}
          side={side}
          onSide={noop}
          onRetry={noop}
          onBack={noop}
        />,
      );
    const a = html("a");
    expect(a).toMatch(/data-testid="owner-pair-a-count" data-escaped="7" data-total="50"/);
    expect(a).toMatch(/data-testid="owner-pair-b-count" data-escaped="1" data-total="50"/);
    expect(a.match(/data-outcome=/g)).toHaveLength(100);
    expect(a.match(/data-outcome="escaped"/g)).toHaveLength(8);
    expect(a).toMatch(/data-testid="owner-pair-a-route" data-count="7"/);
    expect(a).toMatch(/data-testid="owner-pair-b-route" data-count="1"/);
    expect(a).toContain("Freight Lift Lobby → Dock Corridor → Records Room");
    expect(a).toContain('data-detector="cleaner:D1"');
    expect(a).toContain("Desk D1");
    expect(a).toContain("C2 moved from the Freight Lift Lobby to the Dock Corridor");
    expect(a).toContain("6 fewer got out");
    expect(a).toContain('data-testid="owner-pair-recorded"');
    expect(a.match(/data-testid="owner-made-up-chip"/g)).toHaveLength(2);
    expect(a).toMatch(/data-testid="owner-pair-a" data-selected="true"/);
    // The text says which side is drawn.
    expect(a.match(/It is drawn on the board/g)).toHaveLength(1);
    expect(html("b")).toMatch(/data-testid="owner-pair-b" data-selected="true"/);
    expect(pairCaption("b", moved.name, sides[1].summary)).toBe(
      "B, Demo: night shift, C2 moved: 1 of 50 got out. The way most got out is drawn.",
    );
  });

  it("says when the crew didn't plan", () => {
    const html = renderToStaticMarkup(
      <ComparePanel
        pair={{ status: "error", message: "the crew route failed" }}
        floor={floor}
        boards={null}
        madeUp={[false, false]}
        side="a"
        onSide={noop}
        onRetry={noop}
        onBack={noop}
      />,
    );
    expect(html).toContain('data-state="error"');
    expect(html).toContain("the crew route failed");
  });
});

describe("the results panel says what the board shows, and who wrote the fix", () => {
  const result = playOwnerBatch(manifest, floor, starting, answer);
  const rerun = rerunOwner(manifest, floor, starting, result, recordedFix);
  const batch: OwnerBatch = { status: "done", key: "generated", setup: starting, result, summary: sum(result), recorded: true, ms: 1 };
  const panel = (props: { batch?: OwnerBatch; fix: OwnerFix; side?: "before" | "after"; board?: PlacedLevel }) =>
    renderToStaticMarkup(
      <BatchPanel
        batch={props.batch ?? batch}
        fix={props.fix}
        zones={ownerZones(manifest, floor)}
        generated={generated}
        setupName={null}
        stale={false}
        fixedSaved={null}
        side={props.side}
        board={props.board}
        onEdit={noop}
        onRetry={noop}
        onOpenFixed={noop}
      />,
    );
  // The Chief's section alone: the crew's chip above says its own "no model was called".
  const chief = (html: string) => html.slice(html.indexOf('data-testid="owner-chief"'));
  const applied = (a: FixAnswer): OwnerFix => ({
    status: "applied",
    answer: a,
    rerun,
    ms: 1,
  });
  const recordedAnswer = { fix: recordedFix, recorded: true, source: "recorded" as const, reason: "fake mode" as const };

  it("after the fix, the route and detector cards describe the after batch the board draws", () => {
    const html = panel({ fix: applied(recordedAnswer), side: "after" });
    expect(html).toMatch(/data-testid="owner-route" data-side="after" data-count="0"/);
    expect(html).toContain("After the fix: The way most got out");
    expect(html).not.toContain("It is drawn on the board");
    const top = rerun.after.detectors[0];
    if (top) expect(html).toContain(`data-detector="${top.kind}:${top.id ?? ""}"`);
    else expect(html).not.toContain('data-testid="owner-detector"');
  });

  it("after the fix, the detector card names the Chief's fix as what placed the camera it moved, never the rules table", () => {
    // The After board as the screen draws it: the setup the After batch played.
    const board = boardOf(manifest, floor, rerun.fixed!, 1)!;
    const html = panel({ fix: applied(recordedAnswer), side: "after", board });
    const top = rerun.after.detectors[0]!;
    expect(`${top.kind}:${top.id}`).toBe(`camera:${recordedFix.change.elementId}`);
    expect(html).toContain("Placed by the Security Chief&#x27;s fix: C2 now covers the dock corridor.");
    expect(html).not.toContain("Placed by the rules table");
  });

  it("on the Before side, they describe the batch before the fix", () => {
    const html = panel({ fix: applied(recordedAnswer), side: "before" });
    expect(html).toMatch(/data-testid="owner-route" data-side="before" data-count="14"/);
    expect(html).toContain("Before the fix: The way most got out");
    const top = rerun.before.detectors[0]!;
    expect(html).toContain(`data-detector="${top.kind}:${top.id ?? ""}"`);
  });

  it("counts the attempts the batch played, not 50", () => {
    const fewer = playOwnerBatch(manifest, floor, starting, { strategies: strategies.slice(0, 3), dropped: [] });
    const html = panel({ batch: { ...batch, result: fewer, summary: sum(fewer) }, fix: { status: "idle" } });
    expect(sum(fewer).total).toBe(30);
    expect(html).toContain("The crew&#x27;s 30 attempts");
    expect(html).not.toContain("50 attempts");
  });

  it("a model's own fix carries no chip", () => {
    const html = chief(panel({ fix: { status: "suggested", answer: { fix: recordedFix, recorded: false, source: "model" } } }));
    expect(html).not.toContain('data-testid="owner-fix-recorded"');
    expect(html).not.toContain("no model was called");
  });

  it("a model's change that didn't fit: says a model was called, and shows the change left out", () => {
    const html = chief(panel({
      fix: {
        status: "suggested",
        answer: {
          fix: recordedFix,
          recorded: false,
          source: "template",
          dropped: { change: { kind: "move-camera", elementId: "C7", to: "dock-corridor" }, reason: 'no camera "C7"' },
        },
      },
    }));
    expect(html).toContain('data-testid="owner-fix-recorded"');
    expect(html).not.toContain("no model was called");
    expect(html).toContain("A model was called, but its change didn&#x27;t fit");
    expect(html).toContain('data-testid="owner-fix-left-out"');
    expect(html).toContain("The model suggested: C7 now covers the dock corridor (no camera &quot;C7&quot;)");
  });

  it("a recorded fix in fake mode says no model was called, and why", () => {
    const html = panel({ fix: { status: "suggested", answer: recordedAnswer } });
    expect(html).toContain('title="Recorded fix: no model was called (fake mode)."');
    expect(html).not.toContain('data-testid="owner-fix-left-out"');
  });

  it("a timed-out model is not said to have gone uncalled", () => {
    const html = chief(panel({ fix: { status: "suggested", answer: { fix: recordedFix, recorded: true, source: "template", reason: "timeout" } } }));
    expect(html).toContain("the model didn&#x27;t answer (timeout)");
    expect(html).not.toContain("no model was called");
  });
});

describe("the saved fixed setup plays the After count it showed", () => {
  const before = playOwnerBatch(manifest, floor, starting, answer);
  // Replays a saved setup as the owner would: stored, read back and played over the same nights.
  const replay = (setup: OwnerSetup) =>
    sum(playOwnerBatch(manifest, floor, OwnerSetup.parse(JSON.parse(JSON.stringify(setup))), answer, before.seeds)).escaped;
  const cases: [string, ChiefFix][] = [
    ["the recorded camera move", recordedFix],
    ["retiming G2 by one turn", { change: { kind: "retime-guard", elementId: "G2", byTurns: 1 }, rationale: "" }],
    ["moving C1 to the freight lobby", { change: { kind: "move-camera", elementId: "C1", to: "freight-lobby" }, rationale: "" }],
  ];
  for (const [what, fix] of cases) {
    it(`${what}: the setup the After batch played is the one saved, and replays to its count`, () => {
      const rerun = rerunOwner(manifest, floor, starting, before, fix);
      expect(rerun.dropped).toBeNull();
      expect(rerun.fixed).not.toBeNull();
      expect(validateOwnerSetup(rerun.fixed!, floor)).toEqual([]);
      expect(rerun.fixed!.name).toBe("Generated security, after the fix");
      expect(replay(rerun.fixed!)).toBe(rerun.after.escaped);
    });
  }

  it("a change that doesn't fit saves nothing, and After replays Before", () => {
    const rerun = rerunOwner(manifest, floor, starting, before, { change: { kind: "move-camera", elementId: "C9", to: "dock-corridor" }, rationale: "" });
    expect(rerun.dropped).toMatch(/C9/);
    expect(rerun.fixed).toBeNull();
    expect(rerun.after.escaped).toBe(rerun.before.escaped);
  });
});

describe("a retime plays the engine's retime, on every night", () => {
  const level1 = levelForSetup(manifest, floor, starting, BATCH_SEEDS[0])!;
  const patrols = (level: Level, seed: number) => varyLevel(level, seed).guards.map((g) => ({ id: g.id, patrol: g.patrol }));
  // An owner's own guards: the same rounds, but none still generated, so each starts on its post.
  const owned: OwnerSetup = { ...starting, name: "Owned", generated: { ...starting.generated, guards: [] } };
  const retime = (elementId: string, byTurns: number): ChiefFix => ({ change: { kind: "retime-guard", elementId, byTurns }, rationale: "" });
  const cases = ["G1", "G2"].flatMap((id) => [-3, -2, -1, 1, 2, 3].map((by) => [id, by] as const));

  it("G2's round passes a node twice: the case a new post gets backwards", () => {
    const g2 = starting.guards.find((g) => g.id === "G2")!;
    expect(new Set(g2.round).size).toBeLessThan(g2.round.length);
  });

  for (const [id, by] of cases) {
    it(`${id} ${by > 0 ? "+" : ""}${by}: the fixed setup's patrol on every seed is applyFix's, for a generated and an owner's guard`, () => {
      for (const setup of [starting, owned]) {
        const fixed = setupWithFix(setup, retime(id, by), level1, "fixed");
        expect(validateOwnerSetup(fixed, floor)).toEqual([]);
        for (const seed of BATCH_SEEDS) {
          const level = levelForSetup(manifest, floor, setup, seed)!;
          const engine = applyFix(level, retime(id, by).change);
          if (!engine.ok) {
            // A whole number of rounds: the engine refuses it, and the setup changes nothing either.
            expect(patrols(levelForSetup(manifest, floor, fixed, seed)!, seed)).toEqual(patrols(level, seed));
            continue;
          }
          expect(patrols(levelForSetup(manifest, floor, fixed, seed)!, seed)).toEqual(patrols(engine.level, seed));
        }
      }
    });
  }

  it("on F1, the Chief's G2 +1 gives the engine's count: 16 of 50, one fewer than before", () => {
    const before = playOwnerBatch(manifest, floor, starting, answer);
    const fix = retime("G2", 1);
    const owner = rerunOwner(manifest, floor, starting, before, fix);
    const engine = rerunWithFix(
      { buildingId: manifest.buildingId, strategies, levelFor: (seed) => placeLevel(manifest, floor, seed).level },
      fix,
    );
    expect(engine.after.escaped).toBe(16);
    expect(owner.after.escaped).toBe(16);
    expect(owner.fixed!.guards.find((g) => g.id === "G2")!.retime).toBe(1);
  });

  it("a retimed generated guard keeps its nights' starts but says the owner's setup placed it", () => {
    const fixed = setupWithFix(starting, retime("G1", 1), level1, "fixed");
    expect(fixed.generated?.guards).toContain("G1");
    const out = applyOwnerSetup(manifest, floor, fixed, 1);
    if (!out.ok) throw new Error("does not fit");
    expect(out.placed.guards.find((g) => g.id === "G1")!.provenance.every((p) => p.layer === "owner")).toBe(true);
  });
});

describe("a change that let no fewer out is not saved as a fix", () => {
  it("is named for the Chief's change, not \"after the fix\"", () => {
    const before = playOwnerBatch(manifest, floor, starting, answer);
    // G2 one turn earlier lets 19 out against 17.
    const worse = rerunOwner(manifest, floor, starting, before, { change: { kind: "retime-guard", elementId: "G2", byTurns: -1 }, rationale: "" });
    expect(worse.dropped).toBeNull();
    expect([worse.before.escaped, worse.after.escaped]).toEqual([17, 19]);
    expect(worse.fixed!.name).toBe("Generated security, with the Chief's change");
  });
});

describe("edits that change nothing, and closing a round", () => {
  it("closing a round on its first node adds nothing, and the round still fits", () => {
    const guard = starting.guards.find((g) => g.round.length > 2)!;
    expect(extendRound(starting, guard.id, guard.round[0])).toBe(starting);
    const drawn = startRound(starting, guard.id);
    const next = floor.edges.find((e) => e.a === guard.post || e.b === guard.post)!;
    const other = next.a === guard.post ? next.b : next.a;
    const out = extendRound(extendRound(drawn, guard.id, other), guard.id, guard.post);
    expect(out.guards.find((g) => g.id === guard.id)!.round).toEqual([guard.post, other]);
    expect(problemsOf(out, floor).all.filter((e) => e.code === "round-broken")).toEqual([]);
  });

  it("a door set to the lock it has, or a guard moved onto its own post, stays as generated", () => {
    const [door, lock] = Object.entries(starting.doors)[0];
    expect(setDoor(starting, door, lock)).toBe(starting);
    expect(starting.generated!.doors).toContain(door);
    const guard = starting.guards[0];
    expect(moveGuard(starting, guard.id, guard.post)).toBe(starting);
    expect(starting.generated!.guards).toContain(guard.id);
    // A real change still takes the element off the list.
    expect(setDoor(starting, door, lock === "key" ? "badge" : "key").generated!.doors).not.toContain(door);
  });

  it("an open door set open again changes nothing", () => {
    const open = floor.edges.find((e) => e.door?.lockable && !starting.doors[e.door.id])?.door;
    if (open) expect(setDoor(starting, open.id, "open")).toBe(starting);
  });
});

describe("a fix that didn't fit", () => {
  const result = playOwnerBatch(manifest, floor, starting, answer);
  const rerun = rerunOwner(manifest, floor, starting, result, { change: { kind: "move-camera", elementId: "C9", to: "dock-corridor" }, rationale: "" });
  const batch: OwnerBatch = { status: "done", key: "generated", setup: starting, result, summary: sum(result), recorded: true, ms: 1 };
  it("shows the batch unchanged, never an After side, and says why", () => {
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
        side="after"
        onEdit={noop}
        onRetry={noop}
        onOpenFixed={noop}
      />,
    );
    expect(html).toContain('data-testid="owner-fix-dropped"');
    expect(html).toMatch(/data-testid="owner-route" data-side=""/);
    expect(html).not.toContain("After the fix:");
  });
});
