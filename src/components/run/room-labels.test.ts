// The rooms' names on the board, pinned against main (#37 round 1, M2). The
// layout feeds Plan and Run (`fixedLabels`), and the default slot feeds the
// Debrief replay and the Drill board (`roomLabelTransform`). With the Layer
// lens off, every name must sit where main put it; the one deliberate change is
// DOCK CORRIDOR, which goes just outside its outer wall (PR #83 R1-N2). Every
// name also stays inside the board's frame, the outside slot included.
//
// room-labels-F1.main.json was recorded on main at b5b2898 by running main's
// own `fixedLabels` and `roomLabelMatrix` on the cached F1 level (RUN_SEED),
// rounded to 3 decimals; it is never edited by hand.
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { type FloorGraph, LevelManifest } from "@/domain";
import { act, createRun, type Action } from "@/engine";
import { placeLevel } from "@/level/placer";
import cached from "../../../data/levels/F1.romaine-1974.json";
import baseline from "./room-labels-F1.main.json";
import { fixedLabels, shortLabel, standingOf } from "./board-view";
import { frameOf, LABEL_FONT, project, projectRect, roomLabelMatrix, type Matrix, type Point } from "./iso";
import { addNode, addPawn, matrixBox, placeRoomLabels, quadsOverlap, type Quad, type Taken } from "./labels";
import { RUN_SEED } from "./run-screen";

const placed = placeLevel(LevelManifest.parse(structuredClone(cached)), structuredClone(FIXTURE_FLOORS.F1), RUN_SEED);
const cameras = createRun(placed.level).board.cameras;
const round = (m: readonly number[]) => m.map((n) => Math.round(n * 1000) / 1000);

/** Whether every corner of `quad` lies inside the board's frame for `floor`. */
function inFrame(floor: FloorGraph, quad: Quad): boolean {
  const f = frameOf(floor);
  return quad.every((p: Point) => p.x >= f.minX && p.x <= f.minX + f.width && p.y >= f.minY && p.y <= f.minY + f.height);
}

describe("the rooms' names with the lens off, against main's layout", () => {
  const rooms = fixedLabels(placed, cameras).rooms;

  it("puts every name where main did, but DOCK CORRIDOR", () => {
    expect(rooms.map((r) => r.roomId)).toEqual(baseline.rooms.map((r) => r.roomId));
    rooms.forEach((label, i) => {
      if (label.roomId === "dock-corridor") return;
      expect(round(label.matrix), label.text).toEqual(baseline.rooms[i].matrix);
    });
  });

  it("puts DOCK CORRIDOR outside its outer wall, as large as main had it and over no node or pawn", () => {
    const label = rooms.find((r) => r.roomId === "dock-corridor")!;
    const main = baseline.rooms.find((r) => r.roomId === "dock-corridor")!;
    const room = placed.level.floor.rooms.find((r) => r.id === "dock-corridor")!;
    // Off its tile: the name's box and the tile's diamond do not cross.
    expect(quadsOverlap(label.quad, projectRect(room.rect))).toBe(false);
    // Its scale (the glyphs' run across the board) is no smaller than main's.
    expect(Math.hypot(label.matrix[0], label.matrix[1])).toBeGreaterThanOrEqual(Math.hypot(main.matrix[0], main.matrix[1]) - 1e-3);
    // At the wow beat (the player at dc-west, G4 beside it), no disc or pawn covers it; main's spot was covered.
    const wow = [{ kind: "move", to: "fl-lobby" }, { kind: "move", to: "dc-west" }].reduce((run, action) => {
      const result = act(run, action as Action);
      if (!result.ok) throw new Error(result.reason);
      return result.run;
    }, createRun(placed.level));
    const at = (id: string) => {
      const n = wow.board.nodes.get(id)!;
      return project(n.x, n.y);
    };
    const covers: Taken = { text: [], marks: [] };
    for (const n of placed.level.floor.nodes) addNode(covers, project(n.x, n.y));
    for (const piece of standingOf(wow, at)) addPawn(covers, piece.p);
    expect(covers.marks.filter((m) => quadsOverlap(label.quad, m))).toEqual([]);
    const mainQuad = matrixBox(main.matrix as unknown as Matrix, label.text.length, LABEL_FONT);
    expect(covers.marks.filter((m) => quadsOverlap(mainQuad, m)).length).toBeGreaterThan(0);
  });

  it("keeps the default slot (Debrief's replay and the Drill board) exactly as main has it", () => {
    for (const room of placed.level.floor.rooms) {
      const main = baseline.defaults.find((d) => d.roomId === room.id)!;
      expect(round(roomLabelMatrix(room.rect, shortLabel(room.label).toUpperCase().length)), room.id).toEqual(main.matrix);
    }
  });

  it("keeps every name inside the board's frame, with the lens off and on", () => {
    for (const lens of [false, true]) {
      for (const label of fixedLabels(placed, cameras, lens).rooms) {
        expect(inFrame(placed.level.floor, label.quad), `${label.text}, lens ${lens}`).toBe(true);
      }
    }
  });
});

describe("the outside slot on other floor shapes", () => {
  /** A floor with one corridor along an outer wall, a node every 2 units down its middle, and an office beside it. */
  function corridorFloor(tall: boolean): FloorGraph {
    const corridor = tall ? { x: 0, y: 0, w: 3, h: 22 } : { x: 0, y: 0, w: 22, h: 3 };
    const office = tall ? { x: 3, y: 0, w: 14, h: 22 } : { x: 0, y: 3, w: 22, h: 14 };
    const nodes = Array.from({ length: 11 }, (_, i) => ({
      id: `c${i}`,
      x: tall ? 1.5 : 1 + i * 2,
      y: tall ? 1 + i * 2 : 1.5,
      roomId: "corridor",
      tags: [],
    }));
    return {
      buildingId: "T",
      source: "fixture",
      rooms: [
        { id: "corridor", label: "Service Corridor", rect: corridor },
        { id: "office", label: "Open Office", rect: office },
      ],
      nodes: [...nodes, { id: "o1", x: tall ? 10 : 11, y: tall ? 11 : 10, roomId: "office", tags: [] }],
      edges: nodes.slice(1).map((n, i) => ({ a: nodes[i].id, b: n.id })),
      sightlines: {},
    } as unknown as FloorGraph;
  }

  for (const tall of [false, true]) {
    it(`takes a crowded ${tall ? "tall" : "wide"} corridor's name outside its wall, inside the frame`, () => {
      const floor = corridorFloor(tall);
      const forRooms: Taken = { text: [], marks: [] };
      for (const n of floor.nodes) {
        addNode(forRooms, project(n.x, n.y));
        addPawn(forRooms, project(n.x, n.y));
      }
      const labels = placeRoomLabels(floor, (l) => l.toUpperCase(), forRooms, { text: [], marks: [] }, frameOf(floor));
      const corridor = labels.find((l) => l.roomId === "corridor")!;
      expect(quadsOverlap(corridor.quad, projectRect(floor.rooms[0].rect)), "outside its tile").toBe(false);
      for (const label of labels) expect(inFrame(floor, label.quad), label.text).toBe(true);
    });
  }
});
