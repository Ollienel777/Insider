// The labels that say where a kit building's level comes from (#95): a real
// CoStar record, and either its real Matterport scan or a stand-in floor plan.
// Fixture buildings get no label, so they render as before.
import { describe, expect, it } from "vitest";
import { dossierLabel, placedFloor, recordLabel, recordNote, REAL_SCAN_LABEL, STAND_IN_LABEL } from "./record-label";

describe("recordLabel", () => {
  it("names the real record and the real scan for a kit building played on its scan", () => {
    expect(recordLabel("costar", "scan")).toBe("Real CoStar record · real Matterport scan");
    expect(REAL_SCAN_LABEL).toBe("Real CoStar record · real Matterport scan");
  });

  it("never claims a real scan for a kit building on the stand-in floor", () => {
    expect(recordLabel("costar", "stand-in")).toBe("Real CoStar record · stand-in floor plan");
    expect(STAND_IN_LABEL).not.toMatch(/scan/i);
  });

  it("gives a fixture building no label, on any floor", () => {
    expect(recordLabel("fixture", "scan")).toBeNull();
    expect(recordLabel("fixture", "stand-in")).toBeNull();
    expect(recordLabel(undefined, "scan")).toBeNull();
  });
});

describe("dossierLabel (the Dossier, before any floor loads)", () => {
  it("names the real record only, never a floor: a live scan can still fail or not hold the level", () => {
    expect(dossierLabel("costar")).toBe("Real CoStar record");
    expect(dossierLabel("costar")).not.toMatch(/scan|floor/i);
  });

  it("gives a fixture building no label", () => {
    expect(dossierLabel("fixture")).toBeNull();
    expect(dossierLabel(undefined)).toBeNull();
  });
});

describe("placedFloor (the Run, once the level is placed)", () => {
  it("is the scan only for a floor that came from Matterport", () => {
    expect(placedFloor("matterport")).toBe("scan");
  });

  it("is the stand-in for the fixture floor, including after an unplaceable scan fell back to it", () => {
    expect(placedFloor("fixture")).toBe("stand-in");
  });
});

describe("recordNote (the Why card)", () => {
  const rows = [
    { layer: "vexcel" as const, field: "entries.kind" },
    { layer: "costar" as const, field: "buildingClass" },
    { layer: "costar" as const, field: "yearBuilt" },
    { layer: "costar" as const, field: "buildingClass" },
    { layer: "fiction" as const, field: "mission" },
  ];

  it("cites the CoStar fields a kit building's card used, once each, in order", () => {
    expect(recordNote("costar", rows)).toBe("From its real CoStar record: buildingClass, yearBuilt");
  });

  it("says nothing for a fixture building, or a card with no CoStar row", () => {
    expect(recordNote("fixture", rows)).toBeNull();
    expect(recordNote(undefined, rows)).toBeNull();
    expect(recordNote("costar", [{ layer: "vexcel", field: "entries.kind" }])).toBeNull();
  });
});
