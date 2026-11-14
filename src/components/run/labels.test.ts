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
import { act, createRun, type Action, type RunState } from "@/engine";
import { placeLevel } from "@/level/placer";
import cached from "../../../data/levels/F1.json";
import { actionForKey, cameraMount, choices as choicesOf } from "./board";
import { DISC, fixedLabels, fixedLensMarks, movingLabels, standingOf, type GhostPlan } from "./board-view";
import { project } from "./iso";
import { box, MARK_FONT, PIECE_FONT, quadsOverlap, textBox, type Quad } from "./labels";
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
function drawn(run: RunState, ghost: GhostPlan | null = null): { name: string; quad: Quad }[] {
  const atNode = at(run);
  const fixed = fixedLabels(placed, run.board.cameras);
  const choices = choicesOf(run);
  const standing = standingOf(run, atNode);
  const moving = movingLabels(fixed, atNode, choices, standing, ghost);
  const { floor, objective, exits } = placed.level;
  const entryLabel = new Map(placed.entries.map((e) => [e.nodeId, e.label]));
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
      const moving = movingLabels(fixedLabels(placed, run.board.cameras), at(run), choicesOf(run), standing, null, count);
      return standing.flatMap((s) => {
        const spot = moving.marks.get(s.id);
        return spot ? [{ name: `${s.id} lens marks`, quad: box(s.p.x + spot.x, s.p.y + spot.y, s.p.x + spot.x + 14 * count(s.id) + 3 * (count(s.id) - 1), s.p.y + spot.y + 14) }] : [];
      });
    };
    const lensed = (run: RunState) => [
      ...drawn(run),
      ...marks.map((quad, i) => ({ name: `lens mark ${i}`, quad })),
      ...guardMarks(run),
    ];
    expect(guardMarks(createRun(placed.level))).toHaveLength(4);
    expect(collisions(lensed(createRun(placed.level)))).toEqual([]);
    const wow = play(createRun(placed.level), [{ kind: "move", to: "fl-lobby" }, { kind: "move", to: "dc-west" }]);
    expect(collisions(lensed(wow))).toEqual([]);
  });

  it("keeps every label clear of every other at the wow beat, and on every turn of the quiet route", () => {
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
