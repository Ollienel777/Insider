// The crew's fallback plan, worked out from the placed level (issue 140): on
// the fixture floors, where a quiet route exists, and on an open-plan scan
// shaped like a kit building's, where it doesn't.
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { toFloorGraph } from "@/adapters/matterport/mapping";
import { LevelManifest } from "@/domain";
import f1 from "../../data/levels/F1.romaine-1974.json";
import f2 from "../../data/levels/F2.sunset-1986.json";
import f3 from "../../data/levels/F3.night-desk.json";
import { fallbackPlan } from "./fallback-plan";
import { placeLevel } from "./placer";
import { validatePlan } from "./validate-plan";

const SEED = 7;

describe.each([
  ["F1", f1],
  ["F2", f2],
  ["F3", f3],
] as const)("the fallback plan on %s", (id, cached) => {
  const placed = placeLevel(LevelManifest.parse(structuredClone(cached)), structuredClone(FIXTURE_FLOORS[id]), SEED);
  const plan = fallbackPlan(placed);
  const checked = validatePlan(placed, plan);

  it("goes in by the run's start, takes the objective and leaves by an exit, every step on the board", () => {
    expect(plan.steps).toHaveLength(3);
    const start = placed.entries.find((e) => e.nodeId === placed.level.start)!;
    expect(plan.steps[0].zoneId).toBe(start.entryId);
    expect(plan.steps[1].zoneId).toBe(placed.objective.zoneId);
    const exit = placed.entries.find((e) => e.entryId === plan.steps[2].zoneId)!;
    expect(placed.level.exits).toContain(exit.nodeId);
    expect(checked.dropped).toEqual([]);
    expect(checked.startNote).toBeNull();
  });

  it("pushes back with what the board says: who sees the plan and where, and the quiet way's first wait", () => {
    expect(plan.pushback.length).toBeGreaterThan(0);
    if (checked.outcome === "clean") {
      expect(plan.pushback).toMatch(/^Nothing on this way sees us/);
      return;
    }
    const warning = checked.warnings[0];
    expect(plan.pushback).toContain(warning.text);
    if (warning.by) expect(plan.pushback).toMatch(new RegExp(`\\b${warning.by}\\b`));
    // These floors have a quiet route, so the crew sounds fairly sure and points at it.
    expect(checked.noQuietRoute).toBe(false);
    expect(plan.confidence).toBe(0.6);
    expect(plan.pushback).toMatch(/The quiet way|nobody sees you/);
  });

  it("is the same plan every time for the same placement", () => {
    expect(fallbackPlan(placed)).toEqual(plan);
  });
});

describe("the fallback plan on an open-plan scan with no quiet route", () => {
  // Two open rooms, 3 + 6 columns of 3 sweeps 5 m apart (#127's shape): at seed 7 nothing gets through unseen.
  const v = (x: number, z: number) => ({ x, y: 1.5, z });
  const at = new Map<string, { x: number; z: number; room: string }>();
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) at.set(`w-${i}-${j}`, { x: i * 5, z: j * 5, room: "r-west" });
  for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) at.set(`e-${i}-${j}`, { x: 15 + i * 5, z: j * 5, room: "r-east" });
  const sweeps = Object.fromEntries(
    [...at].map(([sid, p]) => [
      sid,
      {
        sid,
        uuid: `uuid-${sid}`,
        enabled: true,
        neighbors: [...at].filter(([o, q]) => o !== sid && Math.hypot(p.x - q.x, p.z - q.z) <= 9).map(([o]) => o),
        position: v(p.x, p.z),
        floorInfo: { id: "floor-a", sequence: 0 },
        roomInfo: { id: p.room },
      },
    ]),
  );
  const floor = toFloorGraph(sweeps, {
    "r-west": { id: "r-west", label: "", bounds: { min: v(-1, -1), max: v(11, 11) } },
    "r-east": { id: "r-east", label: "", bounds: { min: v(14, -1), max: v(41, 11) } },
  });
  const m = structuredClone(f1) as typeof f1;
  m.securityProfile.guardCount = 2;
  m.securityProfile.cameraCount = 2;
  m.entries = m.entries.filter((e) => e.kind === "roof" || e.kind === "lobby");
  const placed = placeLevel(LevelManifest.parse(m), floor, SEED);
  const plan = fallbackPlan(placed);
  const checked = validatePlan(placed, plan);

  it("still gives a plan the board can play, every step placed", () => {
    expect(checked.noQuietRoute).toBe(true);
    expect(plan.steps).toHaveLength(3);
    expect(checked.dropped).toEqual([]);
  });

  it("names what catches it, says there is no way through unseen, and sounds unsure", () => {
    const warning = checked.warnings[0];
    expect(warning.by).not.toBeNull();
    expect(plan.pushback).toContain(warning.text);
    expect(plan.pushback).toMatch(new RegExp(`\\b${warning.by}\\b`));
    expect(plan.pushback).toContain("no way through this floor unseen");
    expect(plan.confidence).toBe(0.3);
  });
});
