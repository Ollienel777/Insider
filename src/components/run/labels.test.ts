// The board's label layout (#68), on the cached F1 level placed on the F1
// fixture floor: no label's glyphs cover another's on the frames of beats 4
// and 5. The smoke spec tests/smoke/labels.spec.ts measures the same frames
// as the browser draws them; this one checks the layout itself, and names
// the pair when it fails.
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { CrewPlan, LevelManifest } from "@/domain";
import { ghostOf } from "@/components/plan/crew-reply";
import { validatePlan } from "@/level/validate-plan";
import crewF1 from "../../../fixtures/llm/crew-F1.json";
import crewF2 from "../../../fixtures/llm/crew-F2.json";
import crewF3 from "../../../fixtures/llm/crew-F3.json";
import f2Cached from "../../../data/levels/F2.sunset-1986.json";
import f3Cached from "../../../data/levels/F3.night-desk.json";
import { act, createRun, type Action, type RunState } from "@/engine";
import { placeLevel, type PlacedLevel } from "@/level/placer";
import { quietRoute } from "@/level/quiet-route";
import cached from "../../../data/levels/F1.romaine-1974.json";
import { actionForKey, cameraMount, choices as choicesOf } from "./board";
import { CHOICE_HIT, DISC, fixedLabels, fixedLensMarks, fixedLensRings, GHOST_REACH, movingLabels, PICK_HIT, standingOf, type GhostPlan } from "./board-view";
import { project } from "./iso";
import { box, boxReach, MARK_FONT, PIECE_FONT, quadsOverlap, textBox, type Quad } from "./labels";
import { lensElements } from "./lens";
import { RUN_SEED } from "./run-screen";

const manifest = LevelManifest.parse(structuredClone(cached));
const placed = placeLevel(manifest, structuredClone(FIXTURE_FLOORS.F1), RUN_SEED);
const at = (run: RunState) => (id: string) => {
  const n = run.board.nodes.get(id)!;
  return project(n.x, n.y);
};

function play(run: RunState, actions: readonly Action[]): RunState {
  return actions.reduce((state, action) => {
    const result = act(state, action);
    if (!result.ok) throw new Error(`${JSON.stringify(action)} refused: ${result.reason}`);
    return result.run;
  }, run);
}

/** Every label the board draws on this frame, by its text, as its glyph box (no padding). */
function drawn(run: RunState, ghost: GhostPlan | null = null, level: PlacedLevel = placed, lens = false): { name: string; quad: Quad }[] {
  const atNode = at(run);
  const fixed = fixedLabels(level, run.board.cameras, lens);
  const choices = choicesOf(run);
  const standing = standingOf(run, atNode);
  const moving = movingLabels(fixed, atNode, choices, standing, ghost);
  const { floor, objective, exits } = level.level;
  const entryLabel = new Map(level.entries.map((e) => [e.nodeId, e.label]));
  const labels: { name: string; quad: Quad }[] = [
    ...fixed.rooms.map((r) => ({ name: r.text, quad: r.quad })),
    ...[objective, ...exits].map((id) => {
      const p = atNode(id);
      const text = id === objective ? "FILES" : (entryLabel.get(id) ?? "EXIT");
      return { name: text, quad: textBox(p.x, p.y + DISC.ry + 14, text.length, MARK_FONT, "middle", 0) };
    }),
    ...run.board.cameras.map((camera) => {
      const m = cameraMount(floor, camera.parts.flat());
      const p = project(m.x, m.y);
      return { name: camera.id, quad: textBox(p.x + 20, p.y - 34, camera.id.length, PIECE_FONT, "start", 0) };
    }),
    ...choices.flatMap((c) => {
      const p = atNode(c.nodeId);
      // The number as the smoke spec measures it in the browser (13px, 8.2 wide, its box from the
      // cap height above the node to below it), and as it is drawn, centred on the node.
      const digit = { name: `choice ${c.key}`, quad: box(p.x - 4.1, p.y - 9.6, p.x + 4.1, p.y + 4.5) };
      return c.kind === "pick" ? [digit, { name: "PICK", quad: textBox(p.x + 16, p.y - 14, 8, MARK_FONT, "start", 0) }] : [digit];
    }),
    ...standing
      .filter((s) => s.kind !== "player")
      .map((s) => {
        const spot = moving.pawns.get(s.id)!;
        return { name: s.id, quad: textBox(s.p.x + spot.x, s.p.y + spot.y, s.id.length, PIECE_FONT, spot.anchor, 0) };
      }),
    ...(ghost?.marks ?? []).map((mark, i) => {
      const p = atNode(mark.nodeId);
      const spot = moving.ghost[i];
      return { name: mark.label, quad: textBox(p.x + spot.x, p.y + spot.y, mark.label.length, MARK_FONT, spot.anchor, 0) };
    }),
  ];
  return labels;
}

function collisions(labels: { name: string; quad: Quad }[]): string[] {
  const hits: string[] = [];
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      if (quadsOverlap(labels[i].quad, labels[j].quad)) hits.push(`${labels[i].name} × ${labels[j].name}`);
    }
  }
  return hits;
}

describe("the board's labels (#68)", () => {
  it("tells two boxes that cross from two that only touch", () => {
    expect(quadsOverlap(box(0, 0, 10, 10), box(9, 9, 20, 20))).toBe(true);
    expect(quadsOverlap(box(0, 0, 10, 10), box(10, 0, 20, 10))).toBe(false);
    const diamond: Quad = [
      { x: 15, y: 10 },
      { x: 20, y: 15 },
      { x: 15, y: 20 },
      { x: 10, y: 15 },
    ];
    // Their upright bounding boxes cross; the shapes do not.
    expect(quadsOverlap(box(0, 0, 11.5, 11.5), diamond)).toBe(false);
  });

  it("keeps every label clear of every other at the start of the run, as Plan and Run draw it", () => {
    expect(collisions(drawn(createRun(placed.level)))).toEqual([]);
  });

  it("keeps the plan's marks clear of the rooms' names on beat 4, for the crew's recorded demo plan", () => {
    // The demo order's recorded answer, checked on the board and drawn as Plan draws it.
    const demo = CrewPlan.parse(crewF1.replies.find((r) => r.id === "dock-wait")!.plan);
    const ghost: GhostPlan = ghostOf(validatePlan(placed, demo));
    expect(ghost.marks.map((m) => m.label)).toEqual(expect.arrayContaining(["C2 · T12", "WAIT · T12"]));
    expect(collisions(drawn(createRun(placed.level), ghost))).toEqual([]);
  });

  it("keeps the rooms' names clear of the Layer lens's marks on the cameras, locks and entries (PR #83 R1-M1)", () => {
    const marks = fixedLensMarks(placed, createRun(placed.level).board.cameras);
    // C1, C2 (CoStar), both locks (CoStar), the dock and the roof (Vexcel).
    expect(marks).toHaveLength(6);
    // Each guard's marks too, where the board places them (`movingLabels` with the lens on).
    const layers = lensElements(placed, placed.level.lockedDoors);
    const count = (id: string) => layers.find((e) => e.key === `guard:${id}`)?.layers.length ?? 0;
    const guardMarks = (run: RunState) => {
      const standing = standingOf(run, at(run));
      const moving = movingLabels(fixedLabels(placed, run.board.cameras, true), at(run), choicesOf(run), standing, null, count);
      return standing.flatMap((s) => {
        const spot = moving.marks.get(s.id);
        return spot ? [{ name: `${s.id} lens marks`, quad: box(s.p.x + spot.x, s.p.y + spot.y, s.p.x + spot.x + 14 * count(s.id) + 3 * (count(s.id) - 1), s.p.y + spot.y + 14) }] : [];
      });
    };
    const lensed = (run: RunState) => [
      ...drawn(run, null, placed, true),
      ...marks.map((quad, i) => ({ name: `lens mark ${i}`, quad })),
      ...guardMarks(run),
    ];
    expect(guardMarks(createRun(placed.level))).toHaveLength(4);
    expect(collisions(lensed(createRun(placed.level)))).toEqual([]);
    const wow = play(createRun(placed.level), [{ kind: "move", to: "fl-lobby" }, { kind: "move", to: "dc-west" }]);
    expect(collisions(lensed(wow))).toEqual([]);
  });

  it("keeps the plan's marks clear of the Layer lens's marks and rings on beat 4, beside their own nodes (#138 R2)", () => {
    const demo = CrewPlan.parse(crewF1.replies.find((r) => r.id === "dock-wait")!.plan);
    const ghost: GhostPlan = ghostOf(validatePlan(placed, demo));
    const run = createRun(placed.level);
    const lensed = [...drawn(run, ghost, placed, true), ...fixedLensMarks(placed, run.board.cameras).map((quad, i) => ({ name: `lens mark ${i}`, quad }))];
    expect(collisions(lensed)).toEqual([]);
    // No plan mark covers a camera's, lock's or entry's ring.
    const rings = fixedLensRings(placed, run.board.cameras);
    expect(rings).toHaveLength(6);
    const plan = new Set(ghost.marks.map((m) => m.label));
    const onRings = lensed.filter((l) => plan.has(l.name)).flatMap((l) => rings.filter((r) => quadsOverlap(l.quad, r)).map(() => l.name));
    expect(onRings).toEqual([]);
    // Each stays beside its own node, lens on and off.
    for (const lens of [false, true]) {
      const moving = movingLabels(fixedLabels(placed, run.board.cameras, lens), at(run), choicesOf(run), standingOf(run, at(run)), ghost);
      ghost.marks.forEach((mark, i) => {
        const p = at(run)(mark.nodeId);
        const spot = moving.ghost[i];
        const quad = textBox(p.x + spot.x, p.y + spot.y, mark.label.length, MARK_FONT, spot.anchor, 0);
        expect(boxReach(quad, p), `${mark.label}, lens ${lens}`).toBeLessThanOrEqual(GHOST_REACH);
      });
    }
  });

  it("never lets a PICK badge's hit area reach a move badge's, at the server closet and the records door (#37 S1)", () => {
    const rect = (p: { x: number; y: number }, r: { x: number; y: number; width: number; height: number }) =>
      box(p.x + r.x, p.y + r.y, p.x + r.x + r.width, p.y + r.y + r.height);
    const overlaps = (run: RunState) => {
      const choices = choicesOf(run);
      return choices
        .filter((c) => c.kind === "pick")
        .flatMap((pick) =>
          choices
            .filter((c) => c !== pick)
            .filter((c) => quadsOverlap(rect(at(run)(pick.nodeId), PICK_HIT), rect(at(run)(c.nodeId), CHOICE_HIT)))
            .map((c) => `PICK ${pick.nodeId} × ${c.key} ${c.nodeId}`),
        );
    };
    // Every turn of the quiet route (the records door from dc-east), and the server closet's from dc-west.
    let run = createRun(placed.level);
    const seen = new Set<string>();
    const steps = ["fl-lobby", "W", "dc-west", "dc-mid", "dc-east", "rr-door", "rr-door", "rr-door", "rr-files", " ", "rr-door", "dc-east", "W", "dc-mid", "dc-west", "fl-lobby"];
    for (const step of steps) {
      for (const c of choicesOf(run)) if (c.kind === "pick") seen.add(c.nodeId);
      expect(overlaps(run), `turn ${run.turn}`).toEqual([]);
      const action = step.length === 1 ? actionForKey(step, run) : choicesOf(run).find((c) => c.nodeId === step)?.action;
      run = play(run, [action!]);
    }
    expect([...seen].sort()).toEqual(["rr-door", "sc-rack"]);
  });

  // Lays out and pair-checks every label on 17 frames, the wow beat and each
  // turn of the quiet route: 0.9 s alone, 4.0 s pinned to one busy CPU, past the 5 s
  // default with two gates on the 2-vCPU VM (#85). Skipping frames would test
  // less, so it gets a budget: 30 s, several times the worst seen.
  it("keeps every label clear of every other at the wow beat, and on every turn of the quiet route", { timeout: 30_000 }, () => {
    const start = createRun(placed.level);
    expect(collisions(drawn(play(start, [{ kind: "move", to: "fl-lobby" }, { kind: "move", to: "dc-west" }])))).toEqual([]);
    // The quiet route the player plays by keys, in and out (tests/smoke/run.spec.ts).
    const route = ["fl-lobby", "W", "dc-west", "dc-mid", "dc-east", "rr-door", "rr-door", "rr-door", "rr-files", " "];
    const back = ["rr-door", "dc-east", "W", "dc-mid", "dc-west", "fl-lobby"];
    let run = start;
    for (const step of [...route, ...back]) {
      const action = step.length === 1 ? actionForKey(step, run) : choicesOf(run).find((c) => c.nodeId === step)?.action;
      expect(action, `${step} on turn ${run.turn}`).toBeTruthy();
      run = play(run, [action!]);
      expect(collisions(drawn(run)), `turn ${run.turn}`).toEqual([]);
    }
    expect(run.carrying).toBe(true);
  });
});

// F2 and F3, the other LA pins (#39): the same frames on their own floors.
describe.each([
  { id: "F2", cached: f2Cached, crew: crewF2 },
  { id: "F3", cached: f3Cached, crew: crewF3 },
])("the board's labels on $id (#39)", ({ id, cached: level, crew }) => {
  const here = placeLevel(LevelManifest.parse(structuredClone(level)), structuredClone(FIXTURE_FLOORS[id]), RUN_SEED);

  it("keeps every label clear of every other at the start of the run", () => {
    expect(collisions(drawn(createRun(here.level), null, here))).toEqual([]);
  });

  it("keeps the plan's marks clear of every label, for each recorded crew reply", () => {
    for (const reply of crew.replies) {
      const ghost = ghostOf(validatePlan(here, CrewPlan.parse(reply.plan)));
      expect(collisions(drawn(createRun(here.level), ghost, here)), reply.id).toEqual([]);
    }
  });

  it("keeps every label clear of every other on every turn of the quiet route", () => {
    let run = createRun(here.level);
    for (const action of quietRoute(here)!) {
      run = play(run, [action]);
      expect(collisions(drawn(run, null, here)), `turn ${run.turn}`).toEqual([]);
    }
    expect(run.status).toBe("won");
  });
});
