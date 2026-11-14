// The crew plan's hand-off from Plan to Run (#96): blocked site data makes
// even reaching `localStorage` throw, and that must stay inside the store.
import { afterEach, describe, expect, it, vi } from "vitest";
import { CrewPlan } from "@/domain";
import { crewPlanKey, loadCrewPlan, saveCrewPlan } from "./crew-plan-store";

const plan = CrewPlan.parse({ steps: [{ zoneId: "dock", action: "Wait at the dock" }], pushback: "", confidence: 0.8 });
const own = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

function blockStorage() {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new DOMException("The operation is insecure.", "SecurityError");
    },
  });
}

afterEach(() => {
  if (own) Object.defineProperty(globalThis, "localStorage", own);
  else delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe("the crew plan store with site data blocked (#96)", () => {
  it("saves nothing and loads nothing, without throwing", () => {
    blockStorage();
    expect(() => saveCrewPlan("F1", { plan, recorded: false })).not.toThrow();
    expect(() => loadCrewPlan("F1")).not.toThrow();
    expect(loadCrewPlan("F1")).toBeNull();
  });

  it("still uses a storage it is handed", () => {
    blockStorage();
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    saveCrewPlan("F1", { plan, recorded: true }, storage);
    expect(loadCrewPlan("F1", storage)).toEqual({ plan, recorded: true });
  });

  it("swallows a full storage", () => {
    const full = {
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
    };
    expect(() => saveCrewPlan("F1", { plan, recorded: false }, full)).not.toThrow();
  });
});

describe("a kit building's crew plan (#95)", () => {
  const memoryStorage = () => {
    const items = new Map<string, string>();
    return {
      items,
      getItem: (k: string) => items.get(k) ?? null,
      setItem: vi.fn((k: string, v: string) => void items.set(k, v)),
      removeItem: (k: string) => void items.delete(k),
    };
  };

  it("is held in memory, never stored, and clears a plan stored before", () => {
    const storage = memoryStorage();
    storage.items.set(crewPlanKey("900198", "romaine-1974"), JSON.stringify({ plan, recorded: false }));
    saveCrewPlan("900198", { plan, recorded: true }, storage, "romaine-1974", true);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.items.has(crewPlanKey("900198", "romaine-1974"))).toBe(false);
    // The Run reads it through the same call, after an in-app navigation; a stale stored copy is removed then too.
    storage.items.set(crewPlanKey("900198", "romaine-1974"), JSON.stringify({ plan, recorded: false }));
    expect(loadCrewPlan("900198", storage, "romaine-1974", true)).toEqual({ plan, recorded: true });
    expect(storage.items.has(crewPlanKey("900198", "romaine-1974"))).toBe(false);
    expect(loadCrewPlan("900198", storage, "sunset-1986")).toBeNull();
  });

  it("reads none stored before #95 for a kit building, and removes it; a fixture building's still loads", () => {
    const storage = memoryStorage();
    const stale = JSON.stringify({ plan, recorded: false });
    storage.items.set(crewPlanKey("900101", "romaine-1974"), stale);
    storage.items.set(crewPlanKey("F1", "romaine-1974"), stale);
    expect(loadCrewPlan("900101", storage, "romaine-1974", true)).toBeNull();
    expect(storage.items.has(crewPlanKey("900101", "romaine-1974"))).toBe(false);
    expect(loadCrewPlan("F1", storage, "romaine-1974", false)).toEqual({ plan, recorded: false });
    expect(storage.items.get(crewPlanKey("F1", "romaine-1974"))).toBe(stale);
  });

  it("stores a fixture building's plan as before", () => {
    const storage = memoryStorage();
    saveCrewPlan("F2", { plan, recorded: true }, storage, "romaine-1974");
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.items.get(crewPlanKey("F2", "romaine-1974"))!)).toEqual({ plan, recorded: true });
    expect(loadCrewPlan("F2", storage, "romaine-1974")).toEqual({ plan, recorded: true });
  });
});
