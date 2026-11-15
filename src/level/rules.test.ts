import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FIXTURE_BUILDINGS } from "@/adapters/costar/fake";
import { FIXTURE_AERIALS } from "@/adapters/vexcel/fake";
import {
  type Aerial,
  type Building,
  type BuildingClass,
  LevelManifest,
  Provenance,
  SecurityProfile,
  Zone,
} from "@/domain";
import { deriveSecurityProfile, eraFor, type SecurityDerivation } from "./rules";

const building = (id: string): Building => {
  const found = FIXTURE_BUILDINGS.find((b) => b.id === id);
  if (!found) throw new Error(`no fixture building ${id}`);
  return structuredClone(found);
};
const aerial = (id: string): Aerial => {
  const found = FIXTURE_AERIALS.get(id);
  if (!found) throw new Error(`no fixture aerial ${id}`);
  return structuredClone(found);
};
const derive = (id: string): SecurityDerivation => deriveSecurityProfile(building(id), aerial(id));

const roles = (d: SecurityDerivation, role: string): Provenance[] =>
  d.provenance.filter((p) => p.elementRole === role);

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe("F1 (1974, Class A)", () => {
  const f1 = derive("F1");

  it("is the Analog era: key locks and sweeping analog cameras", () => {
    expect(f1.securityProfile).toMatchObject({ era: "analog", lockKind: "key", cameraKind: "analog-sweep" });
  });

  it("has 4 guards on tight rounds and 2 cameras", () => {
    expect(f1.securityProfile).toMatchObject({ guardCount: 4, patrolTempo: 1, cameraCount: 2 });
  });

  it("is staged on floor 22, with its available suites 2202–2210 as quiet zones", () => {
    expect(f1.stagingFloor).toBe(22);
    const quiet = f1.zones.filter((z) => z.role === "quiet").map((z) => z.id);
    expect(quiet).toEqual([2202, 2203, 2204, 2205, 2206, 2207, 2208, 2209, 2210].map((s) => `quiet-${s}`));
    expect(f1.zones.map((z) => z.role)).toContain("crowded");
    expect(f1.zones.map((z) => z.role)).toContain("secure");
  });

  it("offers the dock and the roof first, then every other aerial tag", () => {
    expect(f1.entries.map((e) => e.id)).toEqual(["dock-N", "roof", "garage-E", "lobby-S", "exit-W"]);
  });

  it("explains the 4th guard by Class A, and the locks by the year built", () => {
    expect(roles(f1, "guard:G4")).toEqual([
      expect.objectContaining({ layer: "costar", field: "buildingClass", value: "A" }),
    ]);
    expect(roles(f1, "guard:G4")[0].rule).toMatch(/4th guard comes from Class A/);
    expect(roles(f1, "profile:lockKind")[0]).toMatchObject({ field: "yearBuilt", value: 1974 });
    expect(roles(f1, "profile:lockKind")[0].rule).toMatch(/Analog era: key locks/);
  });
});

describe("era boundaries (SPEC §4.3)", () => {
  const cases = [
    [1979, "analog", "key", "analog-sweep", 2],
    [1980, "card", "magstripe", "ptz", 3],
    [1999, "card", "magstripe", "ptz", 3],
    [2000, "networked", "prox", "fixed-ip", 4],
    [2014, "networked", "prox", "fixed-ip", 4],
    [2015, "smart", "badge-pin", "ip-analytics", 5],
  ] as const;

  it.each(cases)("%i → %s era, %s locks, %s cameras ×%i", (yearBuilt, era, lockKind, cameraKind, cameraCount) => {
    expect(eraFor(yearBuilt)).toBe(era);
    const d = deriveSecurityProfile({ ...building("F1"), yearBuilt }, aerial("F1"));
    expect(d.securityProfile).toMatchObject({ era, lockKind, cameraKind, cameraCount });
    for (const field of ["era", "lockKind", "cameraKind", "cameraCount"]) {
      expect(roles(d, `profile:${field}`)[0]).toMatchObject({ field: "yearBuilt", value: yearBuilt });
    }
    expect(roles(d, "camera:C1")).toHaveLength(1);
    expect(roles(d, `camera:C${cameraCount}`)).toHaveLength(1);
    expect(roles(d, `camera:C${cameraCount + 1}`)).toHaveLength(0);
  });
});

describe("guard force by class", () => {
  it.each([
    ["A", 4, 1],
    ["B", 3, 1],
    ["C", 2, 2],
  ] as const)("Class %s → %i guards, %i turns per hop", (cls: BuildingClass, guardCount, patrolTempo) => {
    const d = deriveSecurityProfile({ ...building("F1"), buildingClass: cls }, aerial("F1"));
    expect(d.securityProfile).toMatchObject({ guardCount, patrolTempo });
    const guards = d.provenance.filter((p) => p.elementRole.startsWith("guard:")).map((p) => p.elementRole);
    expect(guards).toEqual(Array.from({ length: guardCount }, (_, i) => `guard:G${i + 1}`));
  });
});

describe("staging floor and zones", () => {
  it("breaks a tie in available area toward the lower floor, whatever order the suites come in", () => {
    const availableSpace = [
      { floor: 30, suite: "3001", sf: 2000 },
      { floor: 12, suite: "1201", sf: 1500 },
      { floor: 12, suite: "1202", sf: 500 },
    ];
    const a = deriveSecurityProfile({ ...building("F1"), availableSpace }, aerial("F1"));
    const b = deriveSecurityProfile({ ...building("F1"), availableSpace: [...availableSpace].reverse() }, aerial("F1"));
    expect(a.stagingFloor).toBe(12);
    expect(b).toEqual(a);
  });

  it("stages a fully let building on its middle floor, all of it crowded", () => {
    const d = deriveSecurityProfile({ ...building("F5"), availableSpace: [] }, aerial("F5"));
    expect(d.stagingFloor).toBe(3);
    expect(roles(d, "level:stagingFloor")[0]).toMatchObject({ field: "stories", value: 6 });
    expect(d.zones.map((z) => z.role)).toEqual(["crowded", "secure"]);
  });

  it("has no crowded zone when the staged floor is entirely available", () => {
    const b = building("F3");
    const d = deriveSecurityProfile({ ...b, typicalFloorSf: 18_974 }, aerial("F3"));
    expect(d.zones.map((z) => z.role)).toEqual(["quiet", "secure"]);
  });

  it("offers a fixture no entries without an aerial, so a degraded build fails", () => {
    expect(deriveSecurityProfile(building("F1"), null).entries).toEqual([]);
  });

  it("offers a kit building the roof and the street lobby without an aerial, each with its rule (#93)", () => {
    const d = deriveSecurityProfile({ ...building("F1"), id: "900001", source: "costar" }, null);
    expect(d.entries.map((e) => e.kind)).toEqual(["roof", "lobby"]);
    for (const entry of d.entries) {
      const why = d.provenance.find((p) => p.elementRole === `entry:${entry.id}`);
      expect(why?.layer).toBe("fiction");
      expect(why?.rule).toMatch(/No Vexcel aerial/);
    }
  });

  it("offers a kit building the roof and the street lobby when its live aerial tags no entries", () => {
    // Live imagery aimed from the kit building's CoStar facts: nothing in them marks a dock.
    const untagged = { ...aerial("F1"), entries: [], derived: true as const };
    const d = deriveSecurityProfile({ ...building("F1"), id: "900001", source: "costar" }, untagged);
    expect(d.entries.map((e) => e.kind)).toEqual(["roof", "lobby"]);
    // The provenance names CoStar's facts, which the massing came from, not that no aerial answered.
    const roof = d.provenance.find((p) => p.elementRole === "entry:roof")!;
    expect(roof.rule).toMatch(/^Nothing in CoStar's facts marks a way in/);
    const none = deriveSecurityProfile({ ...building("F1"), id: "900001", source: "costar" }, null);
    expect(none.provenance.find((p) => p.elementRole === "entry:roof")!.rule).toMatch(/^No Vexcel aerial answered/);
  });

  it("still offers a fixture no entries when its aerial tags none, so a degraded build fails", () => {
    expect(deriveSecurityProfile(building("F1"), { ...aerial("F1"), entries: [] }).entries).toEqual([]);
    // Nor a kit building whose aerial is a hand-made massing's: only a derived one tags none by design.
    expect(deriveSecurityProfile({ ...building("F1"), source: "costar" }, { ...aerial("F1"), entries: [] }).entries).toEqual([]);
  });

  it("offers only the aerial's entries when it tags some", () => {
    expect(deriveSecurityProfile(building("F1"), aerial("F1")).provenance.some((p) => /No Vexcel aerial/.test(p.rule))).toBe(false);
  });
});

describe("all five fixture buildings", () => {
  // The expected level for each fixture, worked by hand from SPEC §4.3.
  const expected = {
    F1: { era: "analog", guardCount: 4, stagingFloor: 22, quiet: 9 },
    F2: { era: "card", guardCount: 3, stagingFloor: 41, quiet: 1 },
    F3: { era: "smart", guardCount: 4, stagingFloor: 24, quiet: 1 },
    F4: { era: "card", guardCount: 4, stagingFloor: 19, quiet: 2 },
    F5: { era: "networked", guardCount: 3, stagingFloor: 4, quiet: 1 },
  } as const;

  it("covers exactly the fixture set", () => {
    expect(FIXTURE_BUILDINGS.map((b) => b.id).sort()).toEqual(Object.keys(expected));
  });

  it("gives no two fixture buildings the same security profile (#39), so each one plays differently", () => {
    const profiles = FIXTURE_BUILDINGS.map((b) => [b.id, JSON.stringify(deriveSecurityProfile(b, aerial(b.id)).securityProfile)]);
    const seen = new Map<string, string>();
    for (const [id, profile] of profiles) {
      expect(seen.get(profile), `${id} has the same profile as ${seen.get(profile)}`).toBeUndefined();
      seen.set(profile, id);
    }
    expect(seen.size).toBe(5);
  });

  describe.each(Object.entries(expected))("%s", (id, want) => {
    const b = building(id);
    const a = aerial(id);
    const d = deriveSecurityProfile(b, a);

    it("derives the level the table gives", () => {
      expect(d.securityProfile).toMatchObject({ era: want.era, guardCount: want.guardCount });
      expect(d.stagingFloor).toBe(want.stagingFloor);
      expect(d.zones.filter((z) => z.role === "quiet")).toHaveLength(want.quiet);
      expect(b.availableSpace.some((s) => s.floor === d.stagingFloor)).toBe(true);
    });

    it("stages the floor with the most available area", () => {
      const byFloor = new Map<number, number>();
      for (const s of b.availableSpace) byFloor.set(s.floor, (byFloor.get(s.floor) ?? 0) + s.sf);
      expect(byFloor.get(d.stagingFloor)).toBe(Math.max(...byFloor.values()));
    });

    it("has schema-valid outputs that drop into a valid LevelManifest", () => {
      expect(SecurityProfile.parse(d.securityProfile)).toEqual(d.securityProfile);
      d.zones.forEach((z) => Zone.parse(z));
      const manifest = {
        buildingId: b.id,
        missionId: "test-mission",
        securityProfile: d.securityProfile,
        zones: d.zones,
        entries: d.entries,
        provenance: d.provenance,
        mission: {
          id: "test-mission",
          city: b.city,
          type: "heist",
          title: "Test",
          inspiredBy: null,
          objective: "Take the files",
          exitCondition: "Leave",
          briefing: "A test briefing. The security is game fiction.",
        },
      };
      expect(LevelManifest.safeParse(manifest).success).toBe(true);
    });

    it("offers every aerial tag, the dock and the roof first", () => {
      expect(d.entries.map((e) => e.id).sort()).toEqual(a.entries.map((e) => e.id).sort());
      expect(d.entries.slice(0, 2).map((e) => e.kind)).toEqual(["dock", "roof"]);
    });

    it("gives every output field a provenance entry with layer, field, value and a rule", () => {
      d.provenance.forEach((p) => Provenance.parse(p));
      expect(new Set(d.provenance.map((p) => p.elementRole)).size).toBe(d.provenance.length);

      // Each profile field reads the CoStar field that produced it, with its real value.
      const source: Record<keyof SecurityProfile, keyof Building> = {
        era: "yearBuilt",
        lockKind: "yearBuilt",
        cameraKind: "yearBuilt",
        cameraCount: "yearBuilt",
        guardCount: "buildingClass",
        patrolTempo: "buildingClass",
      };
      expect(Object.keys(d.securityProfile).sort()).toEqual(Object.keys(source).sort());
      for (const [field, from] of Object.entries(source)) {
        expect(roles(d, `profile:${field}`), field).toEqual([
          expect.objectContaining({ layer: "costar", field: from, value: b[from] }),
        ]);
      }

      expect(roles(d, "level:stagingFloor")).toEqual([
        expect.objectContaining({ layer: "costar", field: "availableSpace" }),
      ]);
      for (let n = 1; n <= d.securityProfile.guardCount; n++) expect(roles(d, `guard:G${n}`)).toHaveLength(1);
      for (let n = 1; n <= d.securityProfile.cameraCount; n++) expect(roles(d, `camera:C${n}`)).toHaveLength(1);
      for (const zone of d.zones) {
        expect(zone.provenance.length).toBeGreaterThan(0);
        for (const p of zone.provenance) expect(d.provenance).toContainEqual(p);
        expect(roles(d, `zone:${zone.id}`)).toHaveLength(1);
      }
      for (const entry of d.entries) {
        expect(roles(d, `entry:${entry.id}`)).toEqual([
          expect.objectContaining({ layer: "vexcel", field: "entries.kind", value: entry.kind }),
        ]);
      }
    });
  });
});

describe("purity", () => {
  it("gives equal results for equal inputs, and never writes to them", () => {
    const b = deepFreeze(building("F1"));
    const a = deepFreeze(aerial("F1"));
    const first = deriveSecurityProfile(b, a);
    expect(deriveSecurityProfile(b, a)).toEqual(first);
    expect(b).toEqual(building("F1"));
  });

  it("imports only domain types, and reads no clock, randomness, network, file or environment", () => {
    const source = readFileSync(fileURLToPath(new URL("./rules.ts", import.meta.url)), "utf8");
    const imports = [...source.matchAll(/^import\s+(type\s+)?[\s\S]*?from\s+"([^"]+)";/gm)];
    expect(imports.map((m) => [m[1]?.trim(), m[2]])).toEqual([["type", "@/domain"]]);
    expect(source).not.toMatch(/\b(Date|Math\.random|fetch|process|require|globalThis|window|localStorage)\b/);
  });
});
