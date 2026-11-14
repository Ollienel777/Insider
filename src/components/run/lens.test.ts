// The Layer lens (#33) on the cached F1 level placed on the F1 fixture floor,
// as the Run and Plan screens place it. Each element's layers must be the
// layers of its own recorded provenance, and the legend's counts must be the
// elements the board draws.
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { LevelManifest, type Provenance } from "@/domain";
import { placeLevel, type PlacedLevel } from "@/level/placer";
import cached from "../../../data/levels/F1.json";
import { describeKinds, layerCounts, lensElements, type LensElement } from "./lens";
import { RUN_SEED } from "./run-screen";

const manifest = LevelManifest.parse(structuredClone(cached));
const placed = placeLevel(manifest, structuredClone(FIXTURE_FLOORS.F1), RUN_SEED);
const allLocked = placed.level.lockedDoors;
const elements = lensElements(placed, allLocked);
const byKey = (key: string) => elements.find((e) => e.key === key)!;

/** The data layers among some entries, as a set: what the lens should show for them. */
const dataLayers = (entries: readonly Provenance[]) =>
  new Set(entries.map((p) => p.layer).filter((layer) => layer !== "fiction"));

describe("lensElements", () => {
  it("has one element per guard, camera, locked door, entry and room, each once", () => {
    const kinds = (kind: LensElement["kind"]) => elements.filter((e) => e.kind === kind).length;
    expect(kinds("guard")).toBe(placed.guards.length);
    expect(kinds("camera")).toBe(placed.cameras.length);
    expect(kinds("lock")).toBe(placed.locks.length);
    expect(kinds("entry")).toBe(placed.entries.length);
    expect(kinds("zone") + kinds("room")).toBe(placed.level.floor.rooms.length);
    expect(new Set(elements.map((e) => e.key)).size).toBe(elements.length);
  });

  it("takes each piece's layers from its own provenance, so the dock post shows Vexcel and CoStar", () => {
    for (const guard of placed.guards) {
      expect(new Set(byKey(`guard:${guard.id}`).layers)).toEqual(dataLayers(guard.provenance));
    }
    for (const camera of placed.cameras) {
      expect(new Set(byKey(`camera:${camera.id}`).layers)).toEqual(dataLayers(camera.provenance));
    }
    for (const entry of placed.entries) {
      expect(new Set(byKey(`entry:${entry.entryId}`).layers)).toEqual(dataLayers(entry.provenance));
    }
    const post = placed.guards.find((g) => g.post)!;
    expect(byKey(`guard:${post.id}`).layers).toEqual(["costar", "vexcel"]);
    expect(byKey("guard:G1").layers).toEqual(["costar"]);
  });

  it("puts every room on Matterport, and a zone's room on its zones' layers too; fiction adds none", () => {
    for (const room of placed.level.floor.rooms) {
      const zones = placed.zones.filter((z) => z.roomIds.includes(room.id));
      const element = byKey(`room:${room.id}`);
      expect(element.kind).toBe(zones.length > 0 ? "zone" : "room");
      expect(new Set(element.layers)).toEqual(
        new Set([...dataLayers(zones.flatMap((z) => z.provenance)), "matterport"]),
      );
    }
    // The records room's only zone is the mission's objective: fiction, so only its tile's layer.
    const records = placed.zones.find((z) => z.role === "objective")!;
    expect(byKey(`room:${records.roomIds[0]}`).layers).toEqual(["matterport"]);
  });

  it("drops a lock once its door is picked open", () => {
    const [picked, ...rest] = allLocked;
    const after = lensElements(placed, rest);
    expect(after.some((e) => e.key === `lock:${picked}`)).toBe(false);
    expect(after.filter((e) => e.kind === "lock")).toHaveLength(rest.length);
  });

  it("reads a layer only from provenance: an element whose entries are all fiction carries none", () => {
    const fictional: PlacedLevel = {
      ...placed,
      cameras: placed.cameras.map((c, i) =>
        i === 0 ? { ...c, provenance: [{ elementRole: `camera:${c.id}`, layer: "fiction", field: "x", value: 1, rule: "r" }] } : c,
      ),
    };
    const camera = lensElements(fictional, allLocked).find((e) => e.key === `camera:${placed.cameras[0].id}`)!;
    expect(camera.layers).toEqual([]);
  });
});

describe("layerCounts", () => {
  it("counts each layer's elements, an element with two layers once under each", () => {
    const sample: LensElement[] = [
      { key: "guard:G1", kind: "guard", layers: ["costar"] },
      { key: "guard:G4", kind: "guard", layers: ["costar", "vexcel"] },
      { key: "entry:dock", kind: "entry", layers: ["vexcel"] },
      { key: "room:r1", kind: "zone", layers: ["costar", "matterport"] },
      { key: "room:r2", kind: "room", layers: ["matterport"] },
      { key: "camera:C9", kind: "camera", layers: [] },
    ];
    const { layers, unsourced } = layerCounts(sample);
    expect(layers.map((l) => [l.layer, l.total])).toEqual([
      ["costar", 3],
      ["vexcel", 2],
      ["matterport", 2],
    ]);
    expect(layers[0].byKind).toEqual([
      { kind: "guard", count: 2 },
      { kind: "zone", count: 1 },
    ]);
    expect(layers[1].byKind).toEqual([
      { kind: "guard", count: 1 },
      { kind: "entry", count: 1 },
    ]);
    expect(unsourced).toBe(1);
  });

  it("gives zeros, not gaps, on an empty board", () => {
    const { layers, unsourced } = layerCounts([]);
    expect(layers.map((l) => l.total)).toEqual([0, 0, 0]);
    expect(layers.every((l) => l.byKind.length === 0)).toBe(true);
    expect(unsourced).toBe(0);
  });

  it("matches F1's board: every element counted under each of its layers", () => {
    const { layers } = layerCounts(elements);
    for (const count of layers) {
      expect(count.total).toBe(elements.filter((e) => e.layers.includes(count.layer)).length);
      expect(count.byKind.reduce((s, k) => s + k.count, 0)).toBe(count.total);
    }
    const vexcel = layers.find((l) => l.layer === "vexcel")!;
    expect(vexcel.byKind).toEqual([
      { kind: "guard", count: 1 },
      { kind: "entry", count: placed.entries.length },
    ]);
    expect(layers.find((l) => l.layer === "matterport")!.total).toBe(placed.level.floor.rooms.length);
  });
});

describe("describeKinds", () => {
  it("names the kinds in words, and Matterport's as rooms", () => {
    expect(
      describeKinds({
        layer: "costar",
        total: 7,
        byKind: [
          { kind: "guard", count: 4 },
          { kind: "camera", count: 2 },
          { kind: "lock", count: 1 },
        ],
      }),
    ).toBe("4 guards, 2 cameras and 1 lock");
    expect(describeKinds({ layer: "vexcel", total: 1, byKind: [{ kind: "entry", count: 1 }] })).toBe("1 entry");
    expect(describeKinds({ layer: "costar", total: 0, byKind: [] })).toBe("nothing");
    expect(
      describeKinds({
        layer: "matterport",
        total: 14,
        byKind: [
          { kind: "zone", count: 4 },
          { kind: "room", count: 10 },
        ],
      }),
    ).toBe("14 rooms");
  });
});
