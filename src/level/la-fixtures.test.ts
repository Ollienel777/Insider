// The other two LA fixture buildings (#39): F2 × sunset-1986 and F3 × night-desk,
// their cached levels placed on their fixture floors as the Run screen places
// them, with their recorded crew replies. Each level must be winnable (a quiet
// route from the start to the objective and out, whatever the seed) and
// losable (walking straight in trips the alarm), and the crew's recorded
// replies must give Plan a warning and a clean alternative.
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { CrewPlan, LevelManifest } from "@/domain";
import { act, createRun, shortestPath, type Action, type RunState } from "@/engine";
import f2Cached from "../../data/levels/F2.sunset-1986.json";
import f3Cached from "../../data/levels/F3.night-desk.json";
import crewF2 from "../../fixtures/llm/crew-F2.json";
import chiefF2 from "../../fixtures/llm/chief-F2.json";
import chiefF3 from "../../fixtures/llm/chief-F3.json";
import crewF3 from "../../fixtures/llm/crew-F3.json";
import { ChiefRecording } from "@/agents/chief/recorded";
import { placeLevel } from "./placer";
import { quietRoute } from "./quiet-route";
import { validatePlan } from "./validate-plan";

const RUN_SEED = 7; // the Run screen's (src/components/run/run-screen.tsx)
const SEEDS = Array.from({ length: 24 }, (_, i) => i);

interface Case {
  id: "F2" | "F3";
  cached: unknown;
  crew: { replies: { id: string; plan: unknown }[] };
  chief: unknown;
  profile: { era: string; guardCount: number; cameraCount: number; lockKind: string; pickTurns: number };
  entries: [string, string][];
  objective: { node: string; door: string; room: string };
  /** What sees a player who walks straight to the objective from the start. */
  trip: { by: string; zone: string; to: string };
  /** The recorded reply Plan shows clean, and the one it warns about. */
  clean: string;
  warns: { reply: string; text: RegExp };
}

const CASES: Case[] = [
  {
    id: "F2",
    cached: f2Cached,
    crew: crewF2,
    chief: chiefF2,
    profile: { era: "card", guardCount: 3, cameraCount: 3, lockKind: "magstripe", pickTurns: 3 },
    entries: [
      ["dock-W", "fl-car"],
      ["roof", "es-landing"],
    ],
    objective: { node: "vt-boxes", door: "d-vault", room: "vault" },
    trip: { by: "C2", zone: "west-corridor", to: "alert" },
    clean: "dock-wait",
    warns: { reply: "dock", text: /^Camera C2 sees you in the West Corridor on turn 1\.$/ },
  },
  {
    id: "F3",
    cached: f3Cached,
    crew: crewF3,
    chief: chiefF3,
    profile: { era: "smart", guardCount: 4, cameraCount: 5, lockKind: "badge-pin", pickTurns: 4 },
    entries: [
      ["dock-N", "sl-car"],
      ["roof", "es-landing"],
    ],
    objective: { node: "lab-bench", door: "d-lab", room: "prototype-lab" },
    // IP cameras with analytics raise the alarm one step more: calm goes straight to lockdown.
    trip: { by: "C1", zone: "north-hall", to: "lockdown" },
    clean: "quiet",
    warns: { reply: "default", text: /^Camera C1 sees you in the North Hall on turn 1\.$/ },
  },
];

/** Plays every action through the engine; a refused one fails the test. */
function play(run: RunState, actions: readonly Action[]): RunState {
  return actions.reduce((state, action, i) => {
    const result = act(state, action);
    if (!result.ok) throw new Error(`action ${i} (${JSON.stringify(action)}) refused: ${result.reason}`);
    return result.run;
  }, run);
}

describe.each(CASES)("$id on its fixture floor", (c) => {
  const manifest = () => LevelManifest.parse(structuredClone(c.cached));
  const place = (seed = RUN_SEED) => placeLevel(manifest(), structuredClone(FIXTURE_FLOORS[c.id]), seed);
  const placed = place();
  const reply = (id: string) => CrewPlan.parse(c.crew.replies.find((r) => r.id === id)!.plan);

  it("places the whole security profile: every guard and camera, the entries and the locked objective", () => {
    const { level } = placed;
    expect(manifest().securityProfile).toMatchObject({
      era: c.profile.era,
      guardCount: c.profile.guardCount,
      cameraCount: c.profile.cameraCount,
      lockKind: c.profile.lockKind,
    });
    expect(placed.guards).toHaveLength(c.profile.guardCount);
    expect(placed.cameras).toHaveLength(c.profile.cameraCount);
    expect(placed.unplaced.filter((u) => /^(guard|camera|zone):/.test(u.elementRole))).toEqual([]);
    expect(placed.entries.map((e) => [e.entryId, e.nodeId])).toEqual(c.entries);
    expect(level.start).toBe(c.entries[0][1]);
    expect(level.objective).toBe(c.objective.node);
    expect(level.pickTurns).toBe(c.profile.pickTurns);
    expect(placed.zones.find((z) => z.role === "objective")?.roomIds).toEqual([c.objective.room]);
    expect(placed.locks.find((l) => l.doorId === c.objective.door)?.zoneId).toBe("objective");
    // Every zone of the manifest lands on a room: quiet, crowded, secure and the objective.
    expect(placed.zones.map((z) => z.role).sort()).toEqual(["crowded", "objective", "quiet", "secure"]);
  });

  it("has a quiet route from the dock to the objective and out, whatever the seed (winnable)", () => {
    for (const seed of SEEDS) {
      const p = place(seed);
      const route = quietRoute(p);
      expect(route, `seed ${seed}`).not.toBeNull();
      const end = play(createRun(p.level), route!);
      expect(end.status, `seed ${seed}`).toBe("won");
      expect(end.alarmEvents, `seed ${seed}`).toEqual([]);
    }
  });

  it("trips the alarm on the first move into the watched corridor for a player who walks straight in (losable)", () => {
    const run0 = createRun(placed.level);
    const path = shortestPath(run0.board, placed.level.start, [placed.level.objective])!;
    let run = run0;
    for (const to of path.slice(1)) {
      run = play(run, [{ kind: "move", to }]);
      if (run.alarmEvents.length > 0) break;
    }
    expect(run.alarmEvents[0]).toMatchObject({
      turn: 1,
      from: "calm",
      to: c.trip.to,
      lastKnownZone: c.trip.zone,
      cause: { kind: "camera", id: c.trip.by },
    });
  });

  it("gets caught when the player stays put after the trip", () => {
    const run0 = createRun(placed.level);
    const path = shortestPath(run0.board, placed.level.start, [placed.level.objective])!;
    let run = play(run0, [{ kind: "move", to: path[1] }, { kind: "move", to: path[2] }]);
    for (let i = 0; i < 20 && run.status === "playing"; i++) run = play(run, [{ kind: "wait" }]);
    expect(run.status).toBe("caught");
  });

  it(`warns on the crew's "${c.warns.reply}" reply, and offers the quiet route as advice`, () => {
    const checked = validatePlan(placed, reply(c.warns.reply));
    expect(checked.outcome).toBe("seen");
    expect(checked.warnings[0].text).toMatch(c.warns.text);
    expect(checked.advice).not.toBeNull();
    expect(checked.advice!.summary).toMatch(/nobody sees you\.$/);
    expect(checked.noQuietRoute).toBe(false);
  });

  it(`plays the crew's "${c.clean}" reply clean: it gets out with the objective unseen`, () => {
    const checked = validatePlan(placed, reply(c.clean));
    expect(checked.dropped).toEqual([]);
    expect(checked.warnings).toEqual([]);
    expect(checked.outcome).toBe("clean");
    expect(play(createRun(placed.level), checked.actions).status).toBe("won");
  });

  it("names only zones the cached manifest has, or entries the floor cannot place (dropped, never invented)", () => {
    const known = new Set([...manifest().zones.map((z) => z.id), ...manifest().entries.map((e) => e.id)]);
    for (const r of c.crew.replies) {
      for (const step of CrewPlan.parse(r.plan).steps) expect(known.has(step.zoneId), `${r.id}: ${step.zoneId}`).toBe(true);
    }
  });

  it("has a recorded Chief turn for that first trip, naming only this level's guards and zones", () => {
    const recording = ChiefRecording.parse(c.chief);
    const turn = recording.turns.find(
      (t) => t.when.from === "calm" && t.when.to === c.trip.to && t.when.lastKnownZone === c.trip.zone,
    );
    expect(turn).toBeDefined();
    const guards = new Set(placed.guards.map((g) => g.id));
    const zones = new Set([...Object.keys(placed.level.zones ?? {}), ...placed.level.floor.rooms.map((r) => r.id)]);
    for (const t of recording.turns) {
      for (const order of t.orders.orders) {
        expect(guards.has(order.guardId), `${t.id}: ${order.guardId}`).toBe(true);
        expect(zones.has(order.zoneId), `${t.id}: ${order.zoneId}`).toBe(true);
      }
      for (const zone of t.orders.lockZones) expect(zones.has(zone), `${t.id}: ${zone}`).toBe(true);
    }
  });
});
