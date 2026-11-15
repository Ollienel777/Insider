// The fallback's search is bounded (issue 140): on a board where no shape plays
// clean, it gives up after MAX_TRIES plays instead of trying every shape, so a
// large open-plan scan can't freeze the Plan screen.
import { describe, expect, it, vi } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { LevelManifest } from "@/domain";
import f2 from "../../data/levels/F2.sunset-1986.json";
import { placeLevel } from "./placer";

const plays = vi.hoisted(() => ({ count: 0 }));

// Every play is caught, as on a floor where the quiet route fits no plan's shape.
vi.mock("./validate-plan", async (original) => {
  const real = await original<typeof import("./validate-plan")>();
  return {
    ...real,
    validatePlan: (...args: Parameters<typeof real.validatePlan>) => {
      plays.count += 1;
      return { ...real.validatePlan(...args), outcome: "seen" as const };
    },
  };
});

const { fallbackPlan, MAX_TRIES } = await import("./fallback-plan");

describe("the fallback plan's search", () => {
  it("stops after its cap of plays when no shape is clean, and still answers with the shortest plan", () => {
    const placed = placeLevel(LevelManifest.parse(structuredClone(f2)), structuredClone(FIXTURE_FLOORS.F2), 2);
    plays.count = 0;
    fallbackPlan(placed);
    const uncapped = plays.count;
    // F2's full search is more than this small cap, so the cap is what stops it.
    const cap = 40;
    expect(uncapped).toBeGreaterThan(cap + 1);
    expect(uncapped).toBeLessThanOrEqual(MAX_TRIES + 1);
    plays.count = 0;
    const plan = fallbackPlan(placed, { maxTries: cap });
    // The search, plus the one play of the shortest plan it falls back to.
    expect(plays.count).toBe(cap + 1);
    expect(plan.confidence).toBe(0.3);
    expect(plan.steps.length).toBeGreaterThanOrEqual(3);
  });
});
