import { describe, expect, it } from "vitest";
import { modeChip, serviceModes } from "@/lib/mode";

describe("serviceModes", () => {
  it("is fake everywhere with an empty environment", () => {
    expect(serviceModes({})).toEqual({
      llm: "fake",
      costar: "fake",
      vexcel: "fake",
      matterport: "fake",
    });
  });

  it("treats anything but `live` as fake", () => {
    expect(serviceModes({ HEIST_MODE: "LIVE" }).costar).toBe("fake");
    expect(serviceModes({ HEIST_MODE: "" }).costar).toBe("fake");
  });

  it("lets a per-service variable override HEIST_MODE both ways", () => {
    const modes = serviceModes({ HEIST_MODE: "live", COSTAR_MODE: "fake" });
    expect(modes).toEqual({ llm: "live", costar: "fake", vexcel: "live", matterport: "live" });
    expect(serviceModes({ NEXT_PUBLIC_MATTERPORT_MODE: "live" }).matterport).toBe("live");
  });
});

describe("modeChip", () => {
  it("says FIXTURES when every service is fake", () => {
    expect(modeChip(serviceModes({}))).toEqual({
      label: "FIXTURES",
      onFixtures: ["Model", "CoStar", "Vexcel", "Matterport"],
    });
  });

  it("says LIVE and lists the services still on fixtures when mixed", () => {
    expect(modeChip(serviceModes({ HEIST_MODE: "live", VEXCEL_MODE: "fake" }))).toEqual({
      label: "LIVE",
      onFixtures: ["Vexcel"],
    });
  });
});
