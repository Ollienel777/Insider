// Owner Mode on a showcase building (issue 205): the floor it plays on, setups
// held in the tab's memory, and the demo pair worked out from the board. Every
// case runs on the F1 fixture: nothing of a kit building or a scan is here.
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { LevelManifest, type FloorGraph } from "@/domain";
import { deleteOwnerSetup, loadOwnerSetups, ownerSetupsKey, saveOwnerSetup } from "@/components/run/owner-setup-store";
import { placeLevel } from "@/level/placer";
import cached from "../../../data/levels/F1.romaine-1974.json";
import { DERIVED_BASE_NAME, derivedDemoPair } from "./derived-demo";
import { setupFromPlaced } from "./owner-edit";
import { OWNER_SEED, ownerFloor } from "./owner-screen";
import { measureSetup } from "./setup-measure";

const manifest = LevelManifest.parse(structuredClone(cached));
const floor = FIXTURE_FLOORS.F1 as FloorGraph;
const placed = placeLevel(manifest, floor, OWNER_SEED);

/** A storage that fails the test if anything reaches it. */
const untouchable = {
  getItem: () => {
    throw new Error("storage was read");
  },
  setItem: () => {
    throw new Error("storage was written");
  },
};

describe("ownerFloor", () => {
  it("keeps a fixture floor as it is", () => {
    expect(ownerFloor(floor)).toBe(floor);
  });

  it("lets every door of a scan take a lock, and changes nothing else", () => {
    const scan: FloorGraph = { ...floor, source: "matterport", edges: floor.edges.map((e) => (e.door ? { ...e, door: { ...e.door, lockable: false } } : e)) };
    const owner = ownerFloor(scan);
    expect(owner.edges.filter((e) => e.door).every((e) => e.door!.lockable)).toBe(true);
    expect(owner.edges.map((e) => [e.a, e.b, e.door?.id])).toEqual(scan.edges.map((e) => [e.a, e.b, e.door?.id]));
    expect(owner.nodes).toBe(scan.nodes);
  });
});

describe("setups held in the tab's memory", () => {
  it("saves, lists and forgets a setup without reaching storage", () => {
    const setup = { ...setupFromPlaced(placed), buildingId: "kit-test", name: "Tab only" };
    expect(saveOwnerSetup(setup, untouchable, true)).toBe(true);
    expect(loadOwnerSetups("kit-test", untouchable, true).map((s) => s.name)).toEqual(["Tab only"]);
    expect(saveOwnerSetup({ ...setup, desks: [] }, untouchable, true)).toBe(true);
    expect(loadOwnerSetups("kit-test", untouchable, true)).toHaveLength(1);
    expect(deleteOwnerSetup("kit-test", "Tab only", untouchable, true)).toBe(true);
    expect(loadOwnerSetups("kit-test", untouchable, true)).toEqual([]);
  });

  it("keeps storage's setups and memory's apart", () => {
    const items = new Map<string, string>();
    const storage = { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v) };
    const setup = { ...setupFromPlaced(placed), name: "On the device" };
    expect(saveOwnerSetup(setup, storage)).toBe(true);
    expect(loadOwnerSetups("F1", storage, true)).toEqual([]);
    expect(items.has(ownerSetupsKey("F1"))).toBe(true);
  });
});

describe("derivedDemoPair", () => {
  const { demos } = derivedDemoPair(manifest, floor, placed);

  it("is the generated security, and the same with one camera moved or turned", () => {
    expect(demos).toHaveLength(2);
    const [a, b] = demos.map((d) => d.setup);
    expect(a).toEqual(setupFromPlaced(placed, DERIVED_BASE_NAME));
    expect(b.name).toMatch(new RegExp(`^${DERIVED_BASE_NAME}, C\\d+ (moved|turned)$`));
    const changed = b.cameras.filter((c, i) => JSON.stringify(c) !== JSON.stringify(a.cameras[i]));
    expect(changed).toHaveLength(1);
    expect({ ...b, cameras: a.cameras, generated: a.generated, name: a.name }).toEqual(a);
  });

  it("leaves fewer open windows, or as many with more coverage", () => {
    const [a, b] = demos.map((d) => measureSetup(manifest, floor, d.setup)!);
    expect(a.windows.measured && b.windows.measured).toBe(true);
    const open = (m: typeof a) => (m.windows.measured ? m.windows.open : Infinity);
    expect(open(b) < open(a) || (open(b) === open(a) && b.coverage > a.coverage)).toBe(true);
  });

  it("is the same every time", () => {
    expect(derivedDemoPair(manifest, floor, placed).demos).toEqual(demos);
  });
});
