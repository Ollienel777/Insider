// The Why card (#21) on the cached F1 level placed on the F1 fixture floor, as
// the Run and Plan screens place it. The card must show only what the placer
// and the rules table recorded: every row is one provenance entry of the
// element, field, value and rule unchanged.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { F1_DEMO, FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { LevelManifest, type Provenance } from "@/domain";
import { applyChiefOrders, createRun } from "@/engine";
import { placeLevel } from "@/level/placer";
import { recordNote } from "@/lib/record-label";
import cached from "../../../data/levels/F1.romaine-1974.json";
import { BoardView } from "./board-view";
import { frameOf } from "./iso";
import { RUN_SEED } from "./run-screen";
import {
  AVOID_RADIUS,
  CARD_WIDTH,
  LAYER_LABEL,
  liveSubtitle,
  placeCard,
  threadColour,
  toScreen,
  whyKey,
  whyRows,
  whyTarget,
  whyTargets,
} from "./why";
import { KIND_LABEL, WhyCard } from "./why-card";

const manifest = LevelManifest.parse(structuredClone(cached));
const placed = placeLevel(manifest, structuredClone(FIXTURE_FLOORS.F1), RUN_SEED);

/** Every provenance entry the manifest holds, top level and per zone. */
const recorded: readonly Provenance[] = [...manifest.provenance, ...manifest.zones.flatMap((z) => z.provenance)];

const decode = (html: string) =>
  html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

describe("whyTargets", () => {
  const targets = whyTargets(placed);

  it("offers a card for every guard, cleaner, camera, lock and zoned room the placer placed", () => {
    const keys = targets.map((t) => t.key);
    for (const g of placed.guards) expect(keys).toContain(whyKey.guard(g.id));
    expect(placed.cleaners.map((k) => k.id)).toEqual(["K1"]);
    for (const k of placed.cleaners) expect(keys).toContain(whyKey.cleaner(k.id));
    for (const c of placed.cameras) expect(keys).toContain(whyKey.camera(c.id));
    for (const l of placed.locks) expect(keys).toContain(whyKey.lock(l.doorId));
    for (const z of placed.zones) for (const r of z.roomIds) expect(keys).toContain(whyKey.room(r));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every card's rows exactly the placed element's provenance: field, value, layer and rule as recorded", () => {
    const elementOf = (key: string): readonly Provenance[] => {
      const [kind, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
      if (kind === "guard") return placed.guards.find((g) => g.id === id)!.provenance;
      if (kind === "cleaner") return placed.cleaners.find((k) => k.id === id)!.provenance;
      if (kind === "camera") return placed.cameras.find((c) => c.id === id)!.provenance;
      if (kind === "lock") return placed.locks.find((l) => l.doorId === id)!.provenance;
      return placed.zones.filter((z) => z.roomIds.includes(id)).flatMap((z) => z.provenance);
    };
    for (const target of targets) {
      const rows = whyRows(target);
      const source = elementOf(target.key);
      expect(rows.length, target.key).toBeGreaterThan(0);
      expect(rows, target.key).toEqual(
        source.map((p) => ({ elementRole: p.elementRole, layer: p.layer, field: p.field, value: String(p.value), rule: p.rule })),
      );
      // And each entry is one the rules table or the builder recorded, not one written for the card.
      for (const p of target.provenance) expect(recorded.includes(p), `${target.key} ${p.elementRole}`).toBe(true);
    }
  });

  it("explains the dock post from both Vexcel (dock entry) and CoStar (Class A → 4 guards), Vexcel first", () => {
    const g4 = whyTarget(placed, whyKey.guard("G4"))!;
    expect(whyRows(g4).map((r) => [r.layer, r.field, r.value, r.elementRole])).toEqual([
      ["vexcel", "entries.kind", "dock", "entry:dock-N"],
      ["costar", "buildingClass", "A", "guard:G4"],
    ]);
    expect(whyRows(g4)[1].rule).toMatch(/^Class A → 4 guards/);
    expect(g4.subtitle).toBe("Posted for the loading dock, in the Elevator Lobby");
    expect(g4.placement).toBe(placed.guards.find((g) => g.id === "G4")!.post!.rule);
    expect(threadColour(g4)).toBe("var(--layer-vexcel)");
  });

  it("explains Suites 2206–2209 as the four vacant suites the manifest lists, never as occupied space (R1-C1)", () => {
    const room = whyTarget(placed, whyKey.room("suites-2206-2209"))!;
    expect(room.subtitle).toBe("4 zones: Suite 2206 (vacant), Suite 2207 (vacant), Suite 2208 (vacant), Suite 2209 (vacant)");
    expect(whyRows(room).map((r) => r.elementRole)).toEqual(["zone:quiet-2206", "zone:quiet-2207", "zone:quiet-2208", "zone:quiet-2209"]);
    for (const row of whyRows(room)) expect(row.rule).toMatch(/is available → quiet zone/);
  });

  it("explains night cleaner K1 from the crowded zone's CoStar row, with the placer's line for its corridor (#95)", () => {
    const k1 = whyTarget(placed, whyKey.cleaner("K1"))!;
    expect(k1.kind).toBe("cleaner");
    expect(whyRows(k1).map((r) => [r.layer, r.field, r.elementRole])).toEqual([["costar", "typicalFloorSf", "zone:crowded-22"]]);
    expect(whyRows(k1)[0].rule).toMatch(/1,509 sf occupied → crowded zone: night cleaners raise Suspicious/);
    expect(k1.subtitle).toBe("Night cleaner, in the Main Corridor");
    expect(k1.placement).toMatch(/^Every suite room on this floor holds an available suite/);
    expect(k1.placement).toBe(placed.cleaners[0].rule);
    expect(threadColour(k1)).toBe("var(--layer-costar)");
    expect(KIND_LABEL[k1.kind]).toBe("Why this cleaner");
  });

  it("explains the records room lock with the year-built row and the era rule", () => {
    const lock = whyTarget(placed, whyKey.lock(F1_DEMO.recordsDoor))!;
    const rows = whyRows(lock);
    expect(rows[0]).toMatchObject({ layer: "costar", field: "yearBuilt", value: "1974" });
    expect(rows[0].rule).toMatch(/Built 1974 \(before 1980\) → Analog era: key locks/);
    expect(threadColour(lock)).toBe("var(--layer-costar)");
    expect(lock.title).toBe("Records Room door");
    expect(lock.subtitle).toBe("Locked, 2 turns to pick");
  });
});

describe("liveSubtitle", () => {
  const g4 = whyTarget(placed, whyKey.guard("G4"))!;
  const g3 = whyTarget(placed, whyKey.guard("G3"))!;

  it("says where a guard on its post or round stands now, before any order", () => {
    const run = createRun(placed.level);
    expect(liveSubtitle(placed, run, g4)).toBe("Posted for the loading dock, in the Elevator Lobby");
    expect(liveSubtitle(placed, run, g3)).toMatch(/^On a round, in the /);
  });

  it("names the Chief's order once one is given, so the card never contradicts the panel", () => {
    // The Chief's orders hold only while there is an alarm (#94).
    const { run } = applyChiefOrders({ ...createRun(placed.level), alarm: "alert" }, {
      orders: [
        { guardId: "G3", intent: "block", zoneId: "dock-N" },
        { guardId: "G4", intent: "converge", zoneId: "dock-corridor" },
      ],
      lockZones: [],
      rationale: "",
    } as never);
    expect(liveSubtitle(placed, run, g4)).toBe("Posted for the loading dock at the start; now converging on the Dock Corridor");
    expect(liveSubtitle(placed, run, g3)).toBe("On a round at the start; now blocking the loading dock");
  });

  it("says a lock is open once it is picked", () => {
    const lock = whyTarget(placed, whyKey.lock(F1_DEMO.recordsDoor))!;
    const run = createRun(placed.level);
    expect(liveSubtitle(placed, run, lock)).toBe("Locked, 2 turns to pick");
    expect(liveSubtitle(placed, { ...run, locked: run.locked.filter((d) => d !== F1_DEMO.recordsDoor) }, lock)).toBe("Picked open");
  });

  it("explains a round guard and C2 from CoStar only, with no placer line", () => {
    const g1 = whyTarget(placed, whyKey.guard("G1"))!;
    expect(whyRows(g1).map((r) => r.field)).toEqual(["buildingClass", "buildingClass"]);
    expect(g1.placement).toBeNull();
    const c2 = whyTarget(placed, whyKey.camera("C2"))!;
    expect(whyRows(c2).map((r) => [r.elementRole, r.field, r.value])).toEqual([
      ["camera:C2", "yearBuilt", "1974"],
      ["profile:cameraKind", "yearBuilt", "1974"],
    ]);
  });
});

describe("WhyCard", () => {
  it("renders one ProvenanceRow per entry, with the recorded field, value and rule and nothing invented", () => {
    for (const target of whyTargets(placed)) {
      const html = decode(renderToStaticMarkup(<WhyCard target={target} onClose={() => {}} />));
      const rows = whyRows(target);
      expect(html.split('data-testid="why-row"').length - 1, target.key).toBe(rows.length);
      for (const row of rows) {
        expect(html).toContain(`data-field="${row.field}" data-value="${row.value}"`);
        expect(html).toContain(`>${row.rule}</p>`);
      }
      // Every piece of text on the card, in order, is the kind label, the element's title and
      // subtitle, each row's layer, field, value and rule, and the placer's line: nothing else.
      const text = [...html.replace(/<!-- -->/g, "").matchAll(/>([^<]+)</g)].map((m) => m[1].trim()).filter(Boolean);
      expect(text, target.key).toEqual([
        KIND_LABEL[target.kind],
        target.title,
        target.subtitle,
        ...rows.flatMap((r) => [LAYER_LABEL[r.layer], r.field, r.value, r.rule]),
        ...(target.placement ? ["Placer", `${target.placement}.`] : []),
      ]);
      expect(html.includes('data-testid="why-placement"')).toBe(target.placement !== null);
    }
  });

  it("adds the real-record line only when given one: a kit building's card, never a fixture's (#95)", () => {
    const target = whyTarget(placed, "guard:G4")!;
    expect(renderToStaticMarkup(<WhyCard target={target} onClose={() => {}} />)).not.toContain('data-testid="why-record"');
    const html = renderToStaticMarkup(<WhyCard target={target} note={recordNote("costar", target.provenance)} onClose={() => {}} />);
    expect(html).toContain('data-testid="why-record"');
    expect(html).toContain("From its real CoStar record: buildingClass");
  });

  it("is a labelled, non-modal dialog with a close button", () => {
    const html = renderToStaticMarkup(<WhyCard target={whyTarget(placed, "guard:G4")!} onClose={() => {}} />);
    expect(html).toMatch(/role="dialog" aria-modal="false" aria-labelledby="[^"]+"/);
    expect(html).toContain('aria-label="Close the Why card"');
    expect(html).toContain("Why this guard");
  });
});

describe("BoardView with the Why card", () => {
  const run = createRun(placed.level);

  it("marks every guard, cleaner, camera, locked door and zoned room as a button that opens its card", () => {
    const html = renderToStaticMarkup(<BoardView placed={placed} run={run} choices={[]} onChoose={() => {}} />);
    const marked = [...html.matchAll(/data-why-target="([^"]+)"/g)].map((m) => m[1]).sort();
    const expected = [
      ...placed.guards.map((g) => whyKey.guard(g.id)),
      ...placed.cleaners.map((k) => whyKey.cleaner(k.id)),
      ...placed.cameras.map((c) => whyKey.camera(c.id)),
      ...run.locked.map((d) => whyKey.lock(d)),
      ...new Set(placed.zones.flatMap((z) => z.roomIds.map(whyKey.room))),
    ].sort();
    expect(marked).toEqual(expected);
    expect(html).toContain('aria-label="Why is G4 here?"');
    expect(html).not.toContain('data-testid="why-card"');
  });

  it("opens the card and the thread for the element it is given, and only that one", () => {
    const html = renderToStaticMarkup(
      <BoardView placed={placed} run={run} choices={[]} onChoose={() => {}} initialWhy={whyKey.guard("G4")} />,
    );
    expect(html.split('data-testid="why-card"').length - 1).toBe(1);
    expect(html).toContain('data-why="guard:G4"');
  });

  it("opens K1's card from its pawn, like a guard's (#95)", () => {
    const html = renderToStaticMarkup(
      <BoardView placed={placed} run={run} choices={[]} onChoose={() => {}} initialWhy={whyKey.cleaner("K1")} />,
    );
    expect(html.split('data-testid="why-card"').length - 1).toBe(1);
    expect(html).toContain('data-why="cleaner:K1"');
    expect(html).toContain('aria-label="Why is K1 here?"');
  });
});

describe("where the card sits", () => {
  const frame = frameOf(placed.level.floor);

  it("maps board units to the pixels the meet-scaled SVG draws them at", () => {
    const size = { width: frame.width * 2, height: frame.height * 3 };
    // Width-bound: scale 2, centred vertically.
    const topLeft = toScreen(frame, size, { x: frame.minX, y: frame.minY });
    expect(topLeft.x).toBeCloseTo(0);
    expect(topLeft.y).toBeCloseTo(frame.height / 2);
    const bottomRight = toScreen(frame, size, { x: frame.minX + frame.width, y: frame.minY + frame.height });
    expect(bottomRight.x).toBeCloseTo(size.width);
    expect(bottomRight.y).toBeCloseTo(frame.height * 2.5);
  });

  it("opens beside the piece, to its right when it fits and to its left when not, inside the board", () => {
    const board = { width: 1000, height: 700 };
    const right = placeCard({ x: 200, y: 300 }, board, 280);
    expect(right).toMatchObject({ side: "right", left: 248, top: 260 });
    expect(right.to).toEqual({ x: 248, y: 300 });
    const left = placeCard({ x: 900, y: 650 }, board, 280);
    expect(left.side).toBe("left");
    expect(left.left).toBe(900 - 48 - CARD_WIDTH);
    expect(left.top).toBe(700 - 16 - 280);
    expect(left.to.x).toBe(left.left + CARD_WIDTH);
    expect(left.from).toEqual({ x: 900, y: 650 });
  });

  it("never covers a point it must avoid: it takes the other side, then slides, and covers the fewest when nothing clears (R3-M3)", () => {
    const board = { width: 1000, height: 700 };
    const inside = (p: { x: number; y: number }, c: ReturnType<typeof placeCard>, h: number) =>
      p.x > c.left - AVOID_RADIUS.x &&
      p.x < c.left + CARD_WIDTH + AVOID_RADIUS.x &&
      p.y > c.top - AVOID_RADIUS.y &&
      p.y < c.top + h + AVOID_RADIUS.y;
    // A choice just right of the piece: the card goes left.
    const choice = { x: 700, y: 320 };
    const a = placeCard({ x: 500, y: 300 }, board, 280, [choice]);
    expect(a.side).toBe("left");
    expect(inside(choice, a, 280)).toBe(false);
    // Choices on both sides at the usual height: the card slides clear of both.
    const both = [{ x: 600, y: 320 }, { x: 300, y: 320 }];
    const b = placeCard({ x: 500, y: 300 }, board, 280, both);
    for (const p of both) expect(inside(p, b, 280)).toBe(false);
    expect(b.to.y).toBeGreaterThanOrEqual(b.top + 16);
    // Nothing clears: the usual place.
    const everywhere = Array.from({ length: 50 }, (_, i) => ({ x: 20 * i, y: 350 }));
    expect(placeCard({ x: 200, y: 300 }, board, 690, everywhere)).toMatchObject({ side: "right", left: 248 });
    // No points to avoid: exactly the usual place.
    expect(placeCard({ x: 200, y: 300 }, board, 280, [])).toEqual(placeCard({ x: 200, y: 300 }, board, 280));
  });
});
