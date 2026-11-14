// The owner's saved setups (issue 125): a round trip per building, and storage that
// throws (blocked site data, a full quota) stays inside the store.
import { afterEach, describe, expect, it } from "vitest";
import { OwnerSetup } from "@/domain/owner-setup";
import { deleteOwnerSetup, loadOwnerSetups, ownerSetupsKey, saveOwnerSetup } from "./owner-setup-store";

const setup = (name: string, buildingId = "F1"): OwnerSetup =>
  OwnerSetup.parse({
    version: 1,
    name,
    buildingId,
    guards: [{ id: "G1", post: "o-west", round: ["o-west", "o-north", "o-south"], tempo: 2 }],
    cameras: [{ id: "C1", node: "dc-west", kind: "sweeping", facing: "e" }],
    doors: { "d-records-room": "key" },
    desks: ["el-south"],
  });

function memory() {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
}

const own = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
afterEach(() => {
  if (own) Object.defineProperty(globalThis, "localStorage", own);
  else delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe("the owner setup store", () => {
  it("round-trips named setups per building, a same-named save replacing the old one", () => {
    const storage = memory();
    expect(saveOwnerSetup(setup("Night shift, 3 guards"), storage)).toBe(true);
    expect(saveOwnerSetup(setup("Weekend"), storage)).toBe(true);
    expect(saveOwnerSetup(setup("Other building", "F2"), storage)).toBe(true);
    const changed = { ...setup("Night shift, 3 guards"), desks: [] };
    expect(saveOwnerSetup(changed, storage)).toBe(true);

    expect(loadOwnerSetups("F1", storage)).toEqual([setup("Weekend"), changed]);
    expect(loadOwnerSetups("F2", storage).map((s) => s.name)).toEqual(["Other building"]);
    expect(deleteOwnerSetup("F1", "Weekend", storage)).toBe(true);
    expect(loadOwnerSetups("F1", storage)).toEqual([changed]);
  });

  it("drops a stored entry that no longer parses and keeps the rest", () => {
    const storage = memory();
    storage.setItem(ownerSetupsKey("F1"), JSON.stringify([{ ...setup("Old"), version: 0 }, setup("Kept"), { ...setup("Moved"), buildingId: "F2" }]));
    expect(loadOwnerSetups("F1", storage).map((s) => s.name)).toEqual(["Kept"]);
  });

  it("reads damaged storage as none, and a save writes over it", () => {
    const storage = memory();
    storage.setItem(ownerSetupsKey("F1"), "{not json");
    expect(loadOwnerSetups("F1", storage)).toEqual([]);
    expect(saveOwnerSetup(setup("Fresh"), storage)).toBe(true);
    expect(loadOwnerSetups("F1", storage).map((s) => s.name)).toEqual(["Fresh"]);
  });

  it("says a save failed when storage throws, and loads nothing, without throwing", () => {
    const throwing = {
      getItem: (): string | null => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
    };
    expect(loadOwnerSetups("F1", throwing)).toEqual([]);
    expect(saveOwnerSetup(setup("Night"), throwing)).toBe(false);
    expect(deleteOwnerSetup("F1", "Night", throwing)).toBe(false);

    const full = { getItem: () => null, setItem: throwing.setItem };
    expect(saveOwnerSetup(setup("Night"), full)).toBe(false);
  });

  it("reaches localStorage inside its guard, so blocked site data does not throw", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
    expect(loadOwnerSetups("F1")).toEqual([]);
    expect(saveOwnerSetup(setup("Night"))).toBe(false);
    expect(deleteOwnerSetup("F1", "Night")).toBe(false);
  });
});
