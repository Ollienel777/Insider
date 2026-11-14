import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  Aerial,
  Building,
  BuildTrace,
  ChiefOrders,
  CrewPlan,
  DrillReport,
  FloorGraph,
  LevelManifest,
  Mission,
  RunLog,
} from "@/domain";

// ---- valid examples, shaped like the demo building (F1, SPEC §7) ----------

const building = {
  id: "F1",
  name: "Halvorsen Tower",
  city: "LA",
  neighbourhood: "Bunker Hill",
  lat: 34.0522,
  lng: -118.2537,
  yearBuilt: 1974,
  buildingClass: "A",
  stories: 42,
  rbaSf: 1_050_000,
  typicalFloorSf: 25_000,
  availableSpace: [
    { floor: 22, suite: "2202", sf: 4_100 },
    { floor: 22, suite: "2210", sf: 6_300 },
  ],
  layers: { costar: true, vexcel: true, matterport: true },
  source: "fixture",
} satisfies Building;

const aerial = {
  views: [
    { dir: "N", url: "/fixtures/aerial/F1-N.png", width: 1600, height: 1200 },
    { dir: "ortho", url: "/fixtures/aerial/F1-ortho.png", width: 1600, height: 1600 },
  ],
  entries: [
    {
      id: "dock",
      kind: "dock",
      label: "Loading dock",
      view: "N",
      x: 820,
      y: 640,
      note: "The only truck-height door",
    },
  ],
  footprint: [
    [-118.2541, 34.0519],
    [-118.2533, 34.0519],
    [-118.2533, 34.0525],
    [-118.2541, 34.0525],
  ],
  heightM: 160,
  source: "fixture",
} satisfies Aerial;

const floor = {
  nodes: [
    { id: "n1", x: 0, y: 0, roomId: "freight", tags: ["lift", "entry"] },
    { id: "n2", x: 4, y: 0, roomId: "freight", tags: [] },
    { id: "n3", x: 8, y: 0, roomId: "records", tags: [] },
  ],
  edges: [
    { a: "n1", b: "n2" },
    { a: "n2", b: "n3", door: { id: "d1", lockable: true } },
  ],
  rooms: [
    { id: "freight", label: "Freight lift lobby", rect: { x: 0, y: -2, w: 6, h: 4 } },
    { id: "records", label: "Records room", rect: { x: 6, y: -2, w: 4, h: 4 } },
  ],
  sightlines: { n1: ["n2"], n2: ["n1"], n3: [] },
  source: "fixture",
} satisfies FloorGraph;

const mission = {
  id: "romaine-1974",
  city: "LA",
  type: "heist",
  title: "The Romaine Street Papers",
  inspiredBy: {
    event: "Summa Corporation burglary, 7000 Romaine St",
    date: "June 5, 1974",
    sourceUrl: "https://www.cia.gov/stories/story/the-exposing-of-project-azorian",
  },
  objective: "Take the files from the records room",
  exitCondition: "Leave through any entry with the files",
} satisfies Mission;

const yearBuilt = {
  elementRole: "lock:records",
  layer: "costar",
  field: "yearBuilt",
  value: 1974,
  rule: "Analog era: key locks, sweeping CCTV",
} as const;

const manifest = {
  buildingId: "F1",
  securityProfile: {
    era: "analog",
    guardCount: 4,
    patrolTempo: 1,
    cameraKind: "analog-sweep",
    lockKind: "key",
  },
  zones: [
    {
      id: "quiet-2202",
      name: "Suite 2202",
      role: "quiet",
      rule: "Available suite: dark, unpatrolled",
      provenance: [
        {
          elementRole: "zone:quiet-2202",
          layer: "costar",
          field: "availableSpace",
          value: "2202",
          rule: "Available suites become quiet zones",
        },
      ],
    },
  ],
  entries: [{ id: "dock", kind: "dock", label: "Loading dock" }],
  mission: { ...mission, briefing: "Floor 22 is the quietest night in the building." },
  provenance: [
    yearBuilt,
    {
      elementRole: "mission",
      layer: "fiction",
      field: "mission",
      value: "romaine-1974",
      rule: "LA, analog era",
    },
  ],
} satisfies LevelManifest;

const crewPlan = {
  steps: [
    { zoneId: "dock", action: "Enter through the dock" },
    { zoneId: "freight", action: "Wait one turn at the freight lift" },
  ],
  pushback: "Camera C2 covers the dock corridor every other turn.",
  confidence: 0.7,
} satisfies CrewPlan;

const chief = {
  orders: [
    { guardId: "G3", intent: "hold", zoneId: "dock" },
    { guardId: "G1", intent: "sweep", zoneId: "quiet-2202" },
  ],
  lockZones: ["records"],
  rationale: "Lost them by the freight lift. G3 holds the dock. Lock the records room.",
} satisfies ChiefOrders;

const drill = {
  scenario: "Stair B is blocked on floor 22; 140 occupants evacuate by stair A.",
  recommendations: ["Post a warden at stair A", "Hold the lifts", "Sweep suite 2210 last"],
} satisfies DrillReport;

const trace = {
  buildingId: "F1",
  events: [
    { atMs: 0, kind: "todo", agent: "level-builder", label: "Read the building", status: "completed" },
    {
      atMs: 400,
      kind: "tool",
      agent: "data-analyst",
      label: "derive_security_profile",
      status: "completed",
      durationMs: 120,
    },
  ],
} satisfies BuildTrace;

const runLog = {
  buildingId: "F1",
  missionId: "romaine-1974",
  seed: 42,
  turns: [
    { turn: 0, player: { kind: "move", nodeId: "n1" }, guards: [{ guardId: "G1", nodeId: "n3" }], alarm: "calm" },
    {
      turn: 1,
      player: { kind: "move", nodeId: "n2" },
      guards: [{ guardId: "G1", nodeId: "n2" }],
      alarm: "alert",
      chief,
    },
  ],
} satisfies RunLog;

// ---- one valid and one invalid example of each schema -----------------------

type Case = { schema: z.ZodType; valid: unknown; invalid: unknown; why: string };

const cases: Record<string, Case> = {
  Building: {
    schema: Building,
    valid: building,
    invalid: { ...building, buildingClass: "D" },
    why: "class D does not exist",
  },
  Aerial: {
    schema: Aerial,
    valid: aerial,
    invalid: { ...aerial, entries: [{ ...aerial.entries[0], view: "S" }] },
    why: "an entry sits on a view that is not in views",
  },
  FloorGraph: {
    schema: FloorGraph,
    valid: floor,
    invalid: { ...floor, edges: [...floor.edges, { a: "n3", b: "n9" }] },
    why: "an edge ends at an unknown node",
  },
  Mission: {
    schema: Mission,
    valid: mission,
    invalid: { ...mission, type: "robbery" },
    why: "missions are heist or prevent",
  },
  LevelManifest: {
    schema: LevelManifest,
    valid: manifest,
    invalid: { ...manifest, provenance: [{ ...yearBuilt, layer: "matterport" }] },
    why: "the manifest never holds Matterport data",
  },
  RunLog: {
    schema: RunLog,
    valid: runLog,
    invalid: { ...runLog, turns: [{ ...runLog.turns[0], alarm: "panic" }] },
    why: "unknown alarm state",
  },
  CrewPlan: {
    schema: CrewPlan,
    valid: crewPlan,
    invalid: { ...crewPlan, confidence: 1.5 },
    why: "confidence is between 0 and 1",
  },
  ChiefOrders: {
    schema: ChiefOrders,
    valid: chief,
    invalid: { ...chief, rationale: "x".repeat(281) },
    why: "the rationale is at most 280 characters",
  },
  DrillReport: {
    schema: DrillReport,
    valid: drill,
    invalid: { ...drill, recommendations: drill.recommendations.slice(0, 2) },
    why: "there are exactly three recommendations",
  },
  BuildTrace: {
    schema: BuildTrace,
    valid: trace,
    invalid: { ...trace, events: [{ ...trace.events[0], agent: "chief" }] },
    why: "the trace only names the builder and its two subagents",
  },
};

describe.each(Object.entries(cases))("%s", (_name, { schema, valid, invalid, why }) => {
  it("parses a valid example", () => {
    expect(schema.safeParse(valid).error).toBeUndefined();
  });

  it(`rejects an invalid example: ${why}`, () => {
    expect(schema.safeParse(invalid).success).toBe(false);
  });
});

// ---- the specific rules ------------------------------------------------------

describe("Building has no tenant field", () => {
  // Fails to compile if a key containing "tenant" is ever added to the type.
  type TenantKeys = Extract<Lowercase<keyof Building>, `${string}tenant${string}`>;
  const noTenantKey: [TenantKeys] extends [never] ? true : false = true;

  it("declares no tenant key", () => {
    expect(noTenantKey).toBe(true);
    expect(Object.keys(Building.shape).filter((k) => /tenant/i.test(k))).toEqual([]);
  });

  it("rejects a record that carries tenants, rather than passing them through", () => {
    expect(Building.safeParse({ ...building, tenants: ["Acme Corp"] }).success).toBe(false);
    expect(
      Building.safeParse({
        ...building,
        availableSpace: [{ floor: 22, suite: "2202", sf: 4_100, tenant: "Acme Corp" }],
      }).success,
    ).toBe(false);
  });
});

describe("LevelManifest", () => {
  it("rejects a stray key, so no floor graph rides along", () => {
    expect(LevelManifest.safeParse({ ...manifest, floor }).success).toBe(false);
  });

  it("rejects duplicate zone ids", () => {
    const zones = [manifest.zones[0], manifest.zones[0]];
    expect(LevelManifest.safeParse({ ...manifest, zones }).success).toBe(false);
  });
});

describe("Aerial as a massing (keyless fake mode)", () => {
  // No image anywhere: the Scout screen renders footprint and heightM, and the
  // entries are anchored in space.
  const massing = {
    ...aerial,
    views: [
      { dir: "N", width: 1600, height: 1000 },
      { dir: "ortho", width: 1200, height: 1200 },
    ],
    entries: [
      {
        id: "dock-N",
        kind: "dock",
        label: "Loading dock",
        view: "N",
        at: { lngLat: [-118.2537, 34.0525], elevM: 0 },
        note: "The only truck-height door",
      },
      {
        id: "roof",
        kind: "roof",
        label: "Roof hatch",
        view: "ortho",
        at: { lngLat: [-118.2536, 34.0522], elevM: 160 },
        note: "Off the helipad",
      },
    ],
  } satisfies Aerial;
  const dock = massing.entries[0];

  it("parses with no view url and entries placed by `at`", () => {
    expect(Aerial.safeParse(massing).error).toBeUndefined();
  });

  it("rejects an entry on an imageless view that has only a pixel", () => {
    const entries = [{ ...dock, at: undefined, x: 820, y: 640 }];
    expect(Aerial.safeParse({ ...massing, entries }).success).toBe(false);
  });

  it("rejects a live Vexcel aerial with a view that has no url", () => {
    expect(Aerial.safeParse({ ...massing, source: "vexcel" }).success).toBe(false);
    expect(Aerial.safeParse({ ...aerial, source: "vexcel" }).success).toBe(true);
  });

  it("rejects an entry with neither a pixel nor `at`, or with half a pixel", () => {
    const bare = { ...aerial.entries[0], x: undefined, y: undefined };
    expect(Aerial.safeParse({ ...aerial, entries: [bare] }).success).toBe(false);
    expect(Aerial.safeParse({ ...aerial, entries: [{ ...bare, x: 820 }] }).success).toBe(false);
  });

  it("rejects an anchor above the roof", () => {
    const entries = [{ ...dock, at: { ...dock.at, elevM: 161 } }];
    expect(Aerial.safeParse({ ...massing, entries }).success).toBe(false);
  });
});

describe("Mission", () => {
  it("accepts a fictional mission with no inspiredBy", () => {
    const fictional = { ...mission, id: "night-desk", type: "prevent", inspiredBy: null };
    expect(Mission.safeParse(fictional).success).toBe(true);
  });

  it("requires a source URL for a documented event", () => {
    const inspiredBy = { ...mission.inspiredBy, sourceUrl: "a book I read" };
    expect(Mission.safeParse({ ...mission, inspiredBy }).success).toBe(false);
  });
});

describe("FloorGraph references", () => {
  it("rejects a node in an unknown room", () => {
    const nodes = [...floor.nodes, { id: "n4", x: 0, y: 0, roomId: "lobby", tags: [] }];
    expect(FloorGraph.safeParse({ ...floor, nodes }).success).toBe(false);
  });

  it("rejects a sightline to an unknown node", () => {
    const sightlines = { ...floor.sightlines, n3: ["n9"] };
    expect(FloorGraph.safeParse({ ...floor, sightlines }).success).toBe(false);
  });

  it("rejects duplicate node ids", () => {
    const nodes = [...floor.nodes, floor.nodes[0]];
    expect(FloorGraph.safeParse({ ...floor, nodes }).success).toBe(false);
  });
});

describe("RunLog", () => {
  it("rejects turns out of order", () => {
    const turns = [runLog.turns[1], runLog.turns[0]];
    expect(RunLog.safeParse({ ...runLog, turns }).success).toBe(false);
  });
});

describe("src/domain contains no any", () => {
  const ANY = /(:\s*any\b|\bas\s+any\b|<\s*any\s*[,>]|\bany\s*\[\]|z\.any\s*\()/;
  const dir = fileURLToPath(new URL(".", import.meta.url));
  const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f));

  it("would catch one", () => {
    // Spelled in pieces so this file does not trip its own check.
    const a = ["a", "n", "y"].join("");
    for (const line of [`let x: ${a} = 1`, `y as ${a}`, `Array<${a}>`, `${a}[]`, `z.${a}()`]) {
      expect(ANY.test(line)).toBe(true);
    }
  });

  it("finds none in any domain file", () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
    const offenders = files.filter((f) => ANY.test(readFileSync(join(dir, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
