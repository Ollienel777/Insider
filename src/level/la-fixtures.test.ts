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
  /** Each way in or out the mission's exit text or briefing names, and the aerial entry it is. */
  exitNames: [string, string][];
  /** Every name the recorded texts give each aerial entry, placed or not, as a crew step would say it (#85). */
  entryNames: Record<string, string[]>;
  /**
   * Every guard or camera a recorded text names: the crew reply or Chief turn
   * (`text`, its id), the phrase, and either the room the guard or camera is
   * placed in, or, for a Chief order, the zone that turn orders the guard to.
   */
  claims: ({ text: string; phrase: string; who: string } & ({ room: string } | { order: string }))[];
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
      ["lobby-E", "el-car"],
      ["garage-N", "gl-car"],
      ["exit-S", "ws-landing"],
    ],
    exitNames: [
      ["the garage", "garage-N"],
      ["the plaza stair", "exit-S"],
      ["the helipad", "roof"],
      ["the Figueroa lobby", "lobby-E"],
      ["the loading dock", "dock-W"],
      ["freight lift from the loading dock", "dock-W"],
      ["garage shuttle lift", "garage-N"],
    ],
    entryNames: {
      "dock-W": ["loading dock", "freight lift"],
      roof: ["helipad", "east stair"],
      "lobby-E": ["figueroa lobby", "passenger lift"],
      "garage-N": ["garage"],
      "exit-S": ["plaza stair", "service entry"],
    },
    claims: [
      { text: "c2-west-corridor", phrase: "C2 has them in the west corridor", who: "C2", room: "west-corridor" },
      { text: "c2-west-corridor", phrase: "G2, from the mail room", who: "G2", room: "mail-room" },
      { text: "c2-west-corridor", phrase: "G3, from the elevator lobby", who: "G3", room: "elevator-lobby" },
      { text: "c2-west-corridor", phrase: "G1 leaves the mail room", who: "G1", room: "mail-room" },
      { text: "c2-west-corridor", phrase: "G2, from the mail room, and G3, from the elevator lobby, converge on it", who: "G2", order: "west-corridor" },
      { text: "c2-west-corridor", phrase: "G2, from the mail room, and G3, from the elevator lobby, converge on it", who: "G3", order: "west-corridor" },
      { text: "c2-west-corridor", phrase: "G1 leaves the mail room too and blocks the loading dock", who: "G1", order: "dock-W" },
      { text: "dock-wait", phrase: "Camera C2 turns along the west corridor", who: "C2", room: "west-corridor" },
      { text: "quiet", phrase: "the way to it is the west corridor, and C2 has you", who: "C2", room: "west-corridor" },
      { text: "lobby", phrase: "the service hall, where C1 turns", who: "C1", room: "service-hall" },
      { text: "garage", phrase: "the service hall, and C1 turns along that hall", who: "C1", room: "service-hall" },
      { text: "dock", phrase: "Camera C2 covers the west corridor", who: "C2", room: "west-corridor" },
      { text: "default", phrase: "Camera C2 covers the west corridor", who: "C2", room: "west-corridor" },
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
    exitNames: [
      ["the service lift", "dock-N"],
      ["the east stair", "roof"],
      ["the loading dock", "dock-N"],
    ],
    entryNames: {
      "dock-N": ["loading dock", "service lift"],
      roof: ["roof deck", "east stair"],
      "lobby-S": ["wilshire lobby"],
      "garage-W": ["garage"],
      "bike-E": ["bike room"],
    },
    claims: [
      { text: "c1-north-hall", phrase: "C1's analytics flagged someone in the north hall", who: "C1", room: "north-hall" },
      { text: "c1-north-hall", phrase: "G4, from its post in the pantry", who: "G4", room: "pantry" },
      { text: "c1-north-hall", phrase: "G3, from the south hall", who: "G3", room: "south-hall" },
      { text: "c1-north-hall", phrase: "G2 holds the prototype lab", who: "G2", order: "objective" },
      { text: "c1-north-hall", phrase: "G1 blocks the loading dock", who: "G1", order: "dock-N" },
      { text: "quiet", phrase: "the south hall's glass wall looks into the middle of the suite, and G3 walks that hall", who: "G3", room: "south-hall" },
      { text: "quiet", phrase: "see which way G3 is facing", who: "G3", room: "south-hall" },
      { text: "roof", phrase: "the north hall's C1 and C2", who: "C1", room: "north-hall" },
      { text: "roof", phrase: "the north hall's C1 and C2", who: "C2", room: "north-hall" },
      { text: "lobby", phrase: "the north hall's C1 and C2", who: "C1", room: "north-hall" },
      { text: "lobby", phrase: "the north hall's C1 and C2", who: "C2", room: "north-hall" },
      { text: "garage", phrase: "the north hall's C1 and C2", who: "C1", room: "north-hall" },
      { text: "garage", phrase: "the north hall's C1 and C2", who: "C2", room: "north-hall" },
      { text: "dock", phrase: "The north hall is the short way, but C1 and C2 watch it", who: "C1", room: "north-hall" },
      { text: "dock", phrase: "The north hall is the short way, but C1 and C2 watch it", who: "C2", room: "north-hall" },
      { text: "default", phrase: "the short way is the north hall, and C1 and C2 there", who: "C1", room: "north-hall" },
      { text: "default", phrase: "the short way is the north hall, and C1 and C2 there", who: "C2", room: "north-hall" },
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

  it("places every way in or out the mission's exit text, its briefing and the crew's replies name (#39 review)", () => {
    const { mission } = manifest();
    const text = `${mission.exitCondition} ${mission.briefing}`.toLowerCase();
    const placedIds = new Set(placed.entries.map((e) => e.entryId));
    for (const [phrase, entryId] of c.exitNames) {
      expect(text, phrase).toContain(phrase.toLowerCase());
      expect(placedIds.has(entryId), `${phrase} → ${entryId}`).toBe(true);
    }
    // An aerial entry the floor cannot place is never offered as a way out in the text.
    for (const entry of manifest().entries.filter((e) => !placedIds.has(e.id))) {
      expect(text, entry.id).not.toContain(entry.label.toLowerCase());
      // By kind too ("the garage"), except where the word names a lift ("the service lift" is the dock's).
      expect(mission.exitCondition.toLowerCase(), entry.id).not.toMatch(new RegExp(`\\b${entry.kind}\\b(?! lift)`));
    }
    // Every entry a recorded crew step goes to is a placed entry: no step is dropped.
    const entryIds = new Set(manifest().entries.map((e) => e.id));
    for (const r of c.crew.replies) {
      for (const step of CrewPlan.parse(r.plan).steps) {
        if (entryIds.has(step.zoneId)) expect(placedIds.has(step.zoneId), `${r.id}: ${step.zoneId}`).toBe(true);
      }
      expect(validatePlan(placed, reply(r.id)).dropped, r.id).toEqual([]);
    }
  });

  it("opens every crew reply where the run starts, and names in the exit line the level's exits and no other way (#85)", () => {
    // The aerial entries a text names, by the names the recorded texts use for them.
    const named = (text: string) =>
      Object.entries(c.entryNames)
        .filter(([, names]) => names.some((n) => text.toLowerCase().includes(n)))
        .map(([id]) => id)
        .sort();
    const start = placed.entries[0];
    const entryIds = new Set(manifest().entries.map((e) => e.id));
    for (const r of c.crew.replies) {
      const [first, ...rest] = CrewPlan.parse(r.plan).steps;
      // The board walks every plan from the start, so a plan that opens anywhere else is not the one played.
      expect(first.zoneId, r.id).toBe(start.entryId);
      expect(named(first.action), `${r.id}: ${first.action}`).toEqual([start.entryId]);
      // A later step to an entry says which one it walks to, and no other.
      for (const step of rest.filter((s) => entryIds.has(s.zoneId))) {
        expect(named(step.action), `${r.id}: ${step.action}`).toEqual([step.zoneId]);
      }
      // A reply the board catches warns about the camera or guard that does it, not another.
      const plan = CrewPlan.parse(r.plan);
      const caughtBy = validatePlan(placed, plan).warnings[0]?.text.match(/\b[CG]\d+\b/)?.[0];
      if (caughtBy) {
        const said = [plan.pushback, ...plan.steps.map((s) => s.action)].join(" ");
        expect(said, `${r.id} is caught by ${caughtBy}`).toMatch(new RegExp(`\\b${caughtBy}\\b`));
      }
    }
    // The exit line names each exit the Run screen's plan lists ("Out by the …"), and nothing else.
    const exits = placed.entries.filter((e) => placed.level.exits.includes(e.nodeId)).map((e) => e.entryId);
    const exitLine = manifest().mission.exitCondition;
    expect(named(exitLine)).toEqual([...exits].sort());
    // Nor any entry that is not an exit, by its label or its kind ("the service lift" is the dock's).
    for (const entry of manifest().entries.filter((e) => !exits.includes(e.id))) {
      expect(exitLine.toLowerCase(), entry.id).not.toContain(entry.label.toLowerCase());
      expect(exitLine.toLowerCase(), entry.id).not.toMatch(new RegExp(`\\b${entry.kind}\\b(?! lift)`));
    }
  });

  it("puts each guard and camera a recorded crew or Chief text places where that text says (#39 review)", () => {
    // Each crew reply's and Chief turn's own text, by its id; a claim is checked against that text alone.
    const recording = ChiefRecording.parse(c.chief);
    const texts = new Map<string, string>([
      ...c.crew.replies.map((r): [string, string] => {
        const plan = CrewPlan.parse(r.plan);
        return [r.id, [plan.pushback, ...plan.steps.map((s) => s.action)].join(" ")];
      }),
      ...recording.turns.map((t): [string, string] => [t.id, t.orders.rationale]),
    ]);
    expect(texts.size, "a crew reply and a Chief turn share an id").toBe(c.crew.replies.length + recording.turns.length);
    const roomOf = new Map(placed.level.floor.nodes.map((n) => [n.id, n.roomId]));
    for (const claim of c.claims) {
      const { text, phrase, who } = claim;
      expect(texts.get(text), `${text}: ${phrase}`).toContain(phrase);
      expect(phrase, `${text}: ${phrase}`).toMatch(new RegExp(`\\b${who}\\b`));
      if ("order" in claim) {
        const turn = recording.turns.find((t) => t.id === text);
        expect(turn, `${text} is a Chief turn`).toBeDefined();
        expect(turn!.orders.orders.map((o) => [o.guardId, o.zoneId]), `${text}: ${phrase}`).toContainEqual([who, claim.order]);
        continue;
      }
      const guard = placed.guards.find((g) => g.id === who);
      const camera = placed.cameras.find((cam) => cam.id === who);
      const rooms = guard ? [guard.roomId] : (camera?.cover ?? []).map((id) => roomOf.get(id));
      expect(rooms.length, `${text}: ${who} is on the board`).toBeGreaterThan(0);
      for (const r of rooms) expect(r, `${text}: ${phrase}: ${who}`).toBe(claim.room);
    }
    // Every mention of a guard or camera in a recorded text sits inside a checked claim phrase for that
    // text, so a second sentence about an id the text already claims fails too (#68 R1-M1). Case-insensitive.
    for (const [id, text] of texts) {
      let rest = text;
      for (const cl of c.claims.filter((x) => x.text === id)) rest = rest.split(cl.phrase).join(" ");
      expect(rest.match(/\b[cg]\d+\b/gi) ?? [], `${id} names a guard or camera outside its claims`).toEqual([]);
    }
  });
});
