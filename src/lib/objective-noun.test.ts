import { describe, expect, it } from "vitest";
import { MISSIONS } from "@/agents/builder/missions";
import { objectiveLabel, objectiveNoun, OBJECTIVE_NOUNS } from "./objective-noun";

describe("the objective noun (#70)", () => {
  it("names each mission's objective, and the marker shows it upper-case", () => {
    expect(objectiveNoun("romaine-1974")).toBe("files");
    expect(objectiveNoun("sunset-1986")).toBe("boxes");
    expect(objectiveLabel("sunset-1986")).toBe("BOXES");
    expect(objectiveLabel("night-desk")).toBe("PROTOTYPE");
  });

  it("falls back to the files with no mission, or one without a noun", () => {
    for (const id of [null, undefined, "", "not-a-mission", "toString"]) {
      expect(objectiveNoun(id)).toBe("files");
      expect(objectiveLabel(id)).toBe("FILES");
    }
  });

  it("has a noun for every library mission, and none for a mission the library lacks", () => {
    expect(Object.keys(OBJECTIVE_NOUNS).sort()).toEqual(MISSIONS.map((m) => m.id).sort());
  });

  it("takes each noun from the mission's own objective text", () => {
    for (const m of MISSIONS) expect(m.objective.toLowerCase()).toContain(OBJECTIVE_NOUNS[m.id]);
  });
});
