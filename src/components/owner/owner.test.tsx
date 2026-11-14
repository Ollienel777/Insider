// The Owner screen (issue 128) on the cached F1 level and the F1 fixture floor:
// the setup made from the generated security and its exact round trip, the
// editor's states and inline reasons, and the before and after of the Chief's
// recorded fix, 17 of 50 out before and none after, as PR 148 has it.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { ChiefFix, LevelManifest, type Strategy } from "@/domain";
import { OwnerSetup } from "@/domain/owner-setup";
import { runBatch, summariseBatch as sum, varyLevel, type Level } from "@/engine";
import { applyOwnerSetup, validateOwnerSetup } from "@/level/owner-setup";
import { placeLevel } from "@/level/placer";
import cached from "../../../data/levels/F1.romaine-1974.json";
import fixRecording from "../../../fixtures/llm/fix-F1.json";
import recording from "../../../fixtures/llm/strategies-F1.json";
import { BatchPanel } from "./batch-panel";
import { toEngineFix } from "./chief-fix";
import { ownerZones, playOwnerBatch, rerunOwner } from "./owner-batch";
import { boardCaption, setupKey } from "./owner-ready";
import {
  addCleaner,
  boardOf,
  clearCleanerRound,
  extendCleanerRound,
  extendRound,
  moveCleaner,
  moveGuard,
  playable,
  problemsOf,
  removeCleaner,
  setupFromPlaced,
  setupWithFix,
  startCleanerRound,
  startRound,
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
    expect(html).toContain("4 guards · 0 cleaners · 2 cameras · 2 locked doors · 0 desks");
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

describe("night cleaners in the editor", () => {
  const busy = { ...manifest, zones: manifest.zones.filter((z) => z.id !== "quiet-2210") };
  const busyStart = setupFromPlaced(placeLevel(busy, floor, 1));
  const withCleaner = addCleaner(starting, "o-west");

  it("adds one on a node, standing there, with a fresh id", () => {
    expect(withCleaner.id).toBe("K1");
    expect(withCleaner.setup.cleaners).toEqual([{ id: "K1", round: ["o-west"] }]);
    expect(addCleaner(withCleaner.setup, "o-north").id).toBe("K2");
    expect(validateOwnerSetup(withCleaner.setup, floor)).toEqual([]);
    expect(applyOwnerSetup(manifest, floor, withCleaner.setup, 1).ok).toBe(true);
  });

  it("moves one: on its round it walks on from there, off it it stays on the node", () => {
    const round = extendCleanerRound(extendCleanerRound(startCleanerRound(withCleaner.setup, "K1"), "K1", "o-north"), "K1", "o-south");
    expect(round.cleaners![0].round).toEqual(["o-west", "o-north", "o-south"]);
    expect(validateOwnerSetup(round, floor)).toEqual([]);
    expect(moveCleaner(round, "K1", "o-north").cleaners![0].round).toEqual(["o-north", "o-south", "o-west"]);
    expect(moveCleaner(round, "K1", "mc-2").cleaners![0].round).toEqual(["mc-2"]);
    // The last node again takes it off; staying put keeps the first.
    expect(extendCleanerRound(round, "K1", "o-south").cleaners![0].round).toEqual(["o-west", "o-north"]);
    expect(clearCleanerRound(round, "K1").cleaners![0].round).toEqual(["o-west"]);
  });

  it("an edited or removed generated cleaner comes off the generated list, and the rest still play as generated", () => {
    const id = busyStart.cleaners![0].id;
    expect(busyStart.generated?.cleaners).toEqual([id]);
    const moved = moveCleaner(busyStart, id, "mc-2");
    expect(moved.generated?.cleaners).toEqual([]);
    expect(moved.generated?.guards).toEqual(busyStart.generated?.guards);
    const out = applyOwnerSetup(busy, floor, moved, 1);
    expect(out.ok && out.placed.cleaners[0]).toMatchObject({ id, patrol: ["mc-2"], provenance: [{ layer: "owner" }] });
    const removed = removeCleaner(busyStart, id);
    expect(removed.cleaners).toEqual([]);
    expect(removed.generated?.cleaners).toEqual([]);
  });

  it("round-trips through a save, and plays the same batch after it", () => {
    const moved = moveCleaner(busyStart, busyStart.cleaners![0].id, "mc-2");
    const stored = OwnerSetup.parse(JSON.parse(JSON.stringify(moved)));
    expect(stored).toEqual(moved);
    const levelOf = (s: OwnerSetup, seed: number) => {
      const out = applyOwnerSetup(busy, floor, s, seed);
      if (!out.ok) throw new Error(out.errors.map((e) => e.reason).join("; "));
      return out.placed.level;
    };
    const play = (s: OwnerSetup) => runBatch({ buildingId: "F1", strategies, levelFor: (seed) => levelOf(s, seed) });
    expect(play(stored)).toEqual(play(moved));
  });

  it("a setup with no cleaners field stays without one until a cleaner is added", () => {
    const older: OwnerSetup = { ...starting };
    delete older.cleaners;
    delete older.generated;
    expect(moveGuard(older, "G1", "mc-1")).not.toHaveProperty("cleaners");
    expect(playable(older, floor)).not.toHaveProperty("cleaners");
  });

  it("none selected: the counts name the cleaners, and the tool can add one", () => {
    const html = editor({ setup: withCleaner.setup, pristine: false, state: "editing" });
    expect(html).toContain("4 guards · 1 cleaner · 2 cameras");
    expect(html).toContain('data-value="cleaner"');
    expect(editor({ setup: starting, pristine: true, state: "untouched" }, null, "cleaner")).toContain("Click a node to start a night cleaner there.");
  });

  it("selected: the inspect line, move, draw a round and remove", () => {
    const html = editor({ setup: withCleaner.setup, pristine: false, state: "editing" }, { kind: "cleaner", id: "K1" });
    expect(html).toContain('data-selected="cleaner:K1"');
    expect(html).toMatch(/Night cleaner, cleaning the [^<]+ all night/);
    expect(html).toContain('data-testid="owner-move"');
    expect(html).toContain('data-testid="owner-draw-round"');
    expect(html).toContain("Remove K1");
    expect(html).not.toContain('data-testid="owner-tempo"');
  });

  it("error: a broken round or no node, the reason inline and in the list, and the board keeps it where it starts", () => {
    const broken = extendCleanerRound(startCleanerRound(withCleaner.setup, "K1"), "K1", "mc-4");
    const html = editor({ setup: broken, pristine: false, state: "editing" }, { kind: "cleaner", id: "K1" }, "round");
    expect(html).toContain('data-state="error"');
    expect(html).toContain('data-testid="owner-inline-problem"');
    expect(html).toContain("Cleaner K1&#x27;s round is not a connected loop: &quot;o-west&quot; and &quot;mc-4&quot; are not neighbours.");
    expect(html).toContain('data-role="cleaner:K1"');
    expect(html).toMatch(/data-testid="owner-save"[^>]*disabled/);
    expect(playable(broken, floor).cleaners).toEqual([{ id: "K1", round: ["o-west"] }]);

    const nowhere = { ...starting, cleaners: [{ id: "K1", round: [] }] };
    expect(validateOwnerSetup(nowhere, floor)).toEqual([{ code: "cleaner-off-floor", elementRole: "cleaner:K1", reason: "Cleaner K1 stands on no node" }]);
    expect(playable(nowhere, floor).cleaners).toEqual([]);
    const off = { ...starting, cleaners: [{ id: "K1", round: ["roof-x"] }] };
    expect(playable(off, floor).cleaners).toEqual([]);
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
