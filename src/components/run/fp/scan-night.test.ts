// The night look's settings and the two heights it asks for (issue 198), on
// made-up numbers: no scan is read here.
import { describe, expect, it } from "vitest";
import { CEILING_GAP_M, CEILING_MAX_M, FLOOR_GAP_M, fillCeilingY, fillFloorY, NIGHT_DEFAULTS, nightSettings } from "./scan-night";

describe("the night look's settings", () => {
  it("is on with its defaults when nothing is set", () => {
    expect(nightSettings({})).toEqual(NIGHT_DEFAULTS);
  });

  it("is off only when it is switched off", () => {
    for (const off of ["0", "off", "false", " OFF "]) expect(nightSettings({ NEXT_PUBLIC_SCAN_NIGHT: off })).toBeNull();
    for (const on of ["1", "on", "", "yes"]) expect(nightSettings({ NEXT_PUBLIC_SCAN_NIGHT: on })).not.toBeNull();
  });

  it("takes each number from its setting", () => {
    expect(
      nightSettings({
        NEXT_PUBLIC_SCAN_NIGHT_AMBIENT: "0.2",
        NEXT_PUBLIC_SCAN_NIGHT_TORCH: "1.5",
        NEXT_PUBLIC_SCAN_NIGHT_REACH_M: "12",
        NEXT_PUBLIC_SCAN_NIGHT_CONE_DEG: "40",
      }),
    ).toEqual({ ambient: 0.2, torch: 1.5, reachM: 12, coneDeg: 40 });
  });

  it("keeps the default for a setting that is not a number or is out of range: a typo never blacks the scene out", () => {
    expect(
      nightSettings({
        NEXT_PUBLIC_SCAN_NIGHT_AMBIENT: "dim",
        NEXT_PUBLIC_SCAN_NIGHT_TORCH: "0",
        NEXT_PUBLIC_SCAN_NIGHT_REACH_M: "-4",
        NEXT_PUBLIC_SCAN_NIGHT_CONE_DEG: "400",
      }),
    ).toEqual(NIGHT_DEFAULTS);
  });
});

describe("the plain floor's height", () => {
  it("is just under the lowest floor, so the scan's own floor is always in front of it", () => {
    expect(fillFloorY([0.02, -0.11, 0.3])).toBeCloseTo(-0.11 - FLOOR_GAP_M);
  });

  it("is null with no floor measured", () => {
    expect(fillFloorY([])).toBeNull();
    expect(fillFloorY([Number.NaN])).toBeNull();
  });
});

describe("the plain ceiling's height", () => {
  it("is just over the highest ceiling above the scan's positions", () => {
    const positions = [
      { y: 1.5, rise: 1.2 },
      { y: 1.6, rise: 1.9 },
      { y: 1.5, rise: 1.1 },
    ];
    expect(fillCeilingY(positions)).toBeCloseTo(3.5 + CEILING_GAP_M);
  });

  it("leaves out a position open to the sky or under an atrium", () => {
    const positions = [
      { y: 1.5, rise: 1.2 },
      { y: 1.5, rise: null },
      { y: 1.5, rise: CEILING_MAX_M + 10 },
    ];
    expect(fillCeilingY(positions)).toBeCloseTo(2.7 + CEILING_GAP_M);
  });

  it("is null when no position has a ceiling", () => {
    expect(fillCeilingY([{ y: 1.5, rise: null }])).toBeNull();
    expect(fillCeilingY([])).toBeNull();
  });
});
