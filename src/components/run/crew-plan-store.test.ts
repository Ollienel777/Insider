// The crew plan's hand-off from Plan to Run (#96): blocked site data makes
// even reaching `localStorage` throw, and that must stay inside the store.
import { afterEach, describe, expect, it } from "vitest";
import { CrewPlan } from "@/domain";
import { loadCrewPlan, saveCrewPlan } from "./crew-plan-store";

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
