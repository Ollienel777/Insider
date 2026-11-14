// The owner's setup (#125) on the cached F1 manifest (data/levels/F1.romaine-1974.json) and
// the F1 fixture floor: the validator's reasons, and a valid setup played by
// the engine in place of the generated security.
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { type FloorGraph, LevelManifest } from "@/domain";
import { OwnerSetup } from "@/domain/owner-setup";
import { act, type Action, createRun, type RunState } from "@/engine";
import cached from "../../data/levels/F1.romaine-1974.json";
import { applyOwnerSetup, cameraCover, OWNER_RULE, type OwnerPlacedLevel, validateOwnerSetup } from "./owner-setup";
import { placeLevel } from "./placer";

const manifest = (): LevelManifest => LevelManifest.parse(structuredClone(cached));
const floor = (): FloorGraph => structuredClone(FIXTURE_FLOORS.F1);

/** Night shift on F1: a guard walking the office, one standing in the main corridor, a camera down the dock corridor. */
const NIGHT: OwnerSetup = OwnerSetup.parse({
  version: 1,
  name: "Night shift, 2 guards (made up)",
  buildingId: "F1",
  guards: [
    { id: "G1", post: "o-north", round: ["o-west", "o-north", "o-south"], tempo: 1 },
    { id: "G2", post: "mc-2", round: [], tempo: 2 },
  ],
  cameras: [{ id: "C1", node: "dc-west", kind: "sweeping", facing: "e" }],
  doors: { "d-records-room": "key", "d-server-closet": "badge", "d-freight-lobby": "open" },
  desks: ["el-south"],
});

const variant = (change: Partial<OwnerSetup>): OwnerSetup => ({ ...structuredClone(NIGHT), ...change });
const codes = (setup: OwnerSetup) => validateOwnerSetup(setup, floor()).map((e) => [e.code, e.elementRole]);

function placed(setup = NIGHT, seed = 7): OwnerPlacedLevel {
  const result = applyOwnerSetup(manifest(), floor(), setup, seed);
  if (!result.ok) throw new Error(result.errors.map((e) => e.reason).join("; "));
  return result.placed;
}

function play(run: RunState, actions: readonly Action[]): RunState {
  return actions.reduce((state, action, i) => {
    const result = act(state, action);
    if (!result.ok) throw new Error(`action ${i} (${JSON.stringify(action)}) refused: ${result.reason}`);
    return result.run;
  }, run);
}

describe("validateOwnerSetup", () => {
  it("passes a setup that fits the floor", () => {
    expect(validateOwnerSetup(NIGHT, floor())).toEqual([]);
  });

  it("names a guard posted on no node", () => {
    const errors = validateOwnerSetup(variant({ guards: [{ id: "G1", post: "nowhere", round: [], tempo: 1 }] }), floor());
    expect(errors).toEqual([
      { code: "guard-off-floor", elementRole: "guard:G1", reason: 'Guard G1 is posted on "nowhere", which is not a node of this floor' },
    ]);
  });

  it("names a round that is not a connected loop, and the break in it", () => {
    // o-north and mc-2 are not neighbours; neither are the last and first nodes of an open chain.
    const errors = validateOwnerSetup(variant({ guards: [{ id: "G1", post: "o-west", round: ["o-west", "o-north", "mc-2"], tempo: 1 }] }), floor());
    expect(errors.map((e) => e.code)).toEqual(["round-broken", "round-broken"]);
    expect(errors[0].reason).toBe('Guard G1\'s round is not a connected loop: "o-north" and "mc-2" are not neighbours');
    expect(errors[1].reason).toContain('"mc-2" and "o-west"');

    const chain = variant({ guards: [{ id: "G1", post: "mc-1", round: ["mc-1", "mc-2", "mc-3"], tempo: 1 }] });
    expect(codes(chain)).toEqual([["round-broken", "guard:G1"]]);
  });

  it("accepts a two-node round, walked back and forth over its one edge", () => {
    expect(codes(variant({ guards: [{ id: "G1", post: "mc-1", round: ["mc-1", "mc-2"], tempo: 1 }] }))).toEqual([]);
    expect(codes(variant({ guards: [{ id: "G1", post: "mc-1", round: ["mc-1", "mc-1"], tempo: 1 }] }))).toEqual([["round-broken", "guard:G1"]]);
  });

  it("names a round off the floor, and a post off its round", () => {
    expect(codes(variant({ guards: [{ id: "G1", post: "mc-1", round: ["mc-1", "ghost"], tempo: 1 }] }))).toEqual([["round-off-floor", "guard:G1"]]);
    expect(codes(variant({ guards: [{ id: "G1", post: "mc-e", round: ["o-west", "o-north", "o-south"], tempo: 1 }] }))).toEqual([
      ["post-off-round", "guard:G1"],
    ]);
  });

  it("names a camera on no node, an unknown door, a lock on a door that does not lock, and a desk off the floor", () => {
    const setup = variant({
      cameras: [{ id: "C1", node: "attic", kind: "ptz", facing: "n" }],
      doors: { "d-vault": "key", "d-freight-lobby": "badge", "d-2210-north": "open" },
      desks: ["front-desk"],
    });
    expect(validateOwnerSetup(setup, floor())).toEqual([
      { code: "camera-off-floor", elementRole: "camera:C1", reason: 'Camera C1 is mounted over "attic", which is not a node of this floor' },
      { code: "unknown-door", elementRole: "door:d-vault", reason: '"d-vault" is not a door of this floor' },
      { code: "door-not-lockable", elementRole: "door:d-freight-lobby", reason: 'Door "d-freight-lobby" cannot take a badge reader: it does not lock' },
      { code: "desk-off-floor", elementRole: "desk:front-desk", reason: 'The staffed desk at "front-desk" is not on a node of this floor' },
    ]);
  });

  it("names duplicate ids", () => {
    const setup = variant({
      guards: [NIGHT.guards[0], { ...NIGHT.guards[1], id: "G1" }],
      cameras: [NIGHT.cameras[0], { ...NIGHT.cameras[0], facing: "w" }],
      desks: ["el-south", "el-south"],
    });
    expect(codes(setup)).toEqual([
      ["duplicate-id", "guard:G1"],
      ["duplicate-id", "camera:C1"],
      ["duplicate-id", "desk:el-south"],
    ]);
  });
});

describe("applyOwnerSetup on F1", () => {
  it("refuses a setup for another building, or one that does not fit, with every reason", () => {
    const result = applyOwnerSetup(manifest(), floor(), variant({ buildingId: "F2", desks: ["nowhere"] }), 7);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.code)).toEqual(["wrong-building", "desk-off-floor"]);
  });

  it("puts the owner's security in place of the generated one, and keeps the entries, zones and objective", () => {
    const generated = placeLevel(manifest(), floor(), 7);
    const owner = placed();
    expect(owner.entries).toEqual(generated.entries);
    expect(owner.zones).toEqual(generated.zones);
    expect(owner.objective).toEqual(generated.objective);
    expect(owner.level.start).toBe(generated.level.start);

    expect(owner.level.guards).toEqual([
      { id: "G1", patrol: ["o-north", "o-south", "o-west"] },
      { id: "G2", patrol: ["mc-2"] },
    ]);
    expect(owner.level.guardTempo).toEqual({ G1: 1, G2: 2 });
    expect(owner.level.lockedDoors).toEqual(["d-records-room", "d-server-closet"]);
    expect(owner.level.doorPickTurns).toEqual({ "d-records-room": 2, "d-server-closet": 3 });
    expect(owner.level.cameras).toEqual([{ id: "C1", kind: "analog-sweep", cover: owner.cameras[0].cover, phase: 0 }]);
    expect(owner.level.cleaners).toEqual([{ id: "D1", patrol: ["el-south"] }]);
    expect(owner.locks.map((l) => [l.doorId, l.lock, l.zoneId])).toEqual([
      ["d-records-room", "key", generated.objective.zoneId],
      ["d-server-closet", "badge", expect.any(String)],
    ]);
    expect(owner.unplaced.filter((u) => /^(guard|camera|lock):/.test(u.elementRole))).toEqual([]);
  });

  it("marks everything it places as the owner's, never as data", () => {
    const owner = placed();
    const elements = [...owner.guards, ...owner.cameras, ...owner.locks, ...owner.desks];
    expect(elements).toHaveLength(6);
    for (const element of elements) {
      expect(element.provenance).toHaveLength(1);
      expect(element.provenance[0]).toMatchObject({ layer: "owner", value: NIGHT.name, rule: OWNER_RULE });
    }
    expect(owner.guards[0].provenance[0]).toEqual({
      elementRole: "guard:G1",
      layer: "owner",
      field: "guards.G1",
      value: NIGHT.name,
      rule: "Placed by the owner's setup",
    });
  });

  it("points a camera's cover where it faces", () => {
    const f = floor();
    // From the dock corridor's west end, east is down the corridor; west is back towards the freight lobby.
    const east = cameraCover(f, "dc-west", "e", "sweeping");
    expect(east[0]).toBeDefined();
    expect(east).toContain("dc-west");
    expect(east).toContain("dc-mid");
    expect(cameraCover(f, "dc-west", "w", "sweeping")).not.toContain("dc-mid");
    for (const id of cameraCover(f, "dc-west", "e", "fixed")) expect(east).toContain(id);
  });

  it("starts a run the engine plays the same way every time, with the setup's tempo and locks", () => {
    const route: Action[] = [
      { kind: "move", to: "fl-lobby" }, // turn 0: the freight lobby door is open
      { kind: "move", to: "dc-west" }, // 1
      { kind: "pick", doorId: "d-server-closet" }, // 2: a badge reader takes three
      { kind: "pick", doorId: "d-server-closet" }, // 3
    ];
    // The camera faces away from the way in here, so the run stays calm and the guards keep to their rounds.
    const quiet = variant({ cameras: [{ id: "C1", node: "mc-e", kind: "sweeping", facing: "e" }] });
    const playOnce = () => play(createRun(placed(quiet).level), route);
    const run = playOnce();
    expect(run.status).toBe("playing");
    expect(run.locked).toEqual(["d-records-room", "d-server-closet"]);
    const opened = play(run, [{ kind: "pick", doorId: "d-server-closet" }]);
    expect(opened.locked).toEqual(["d-records-room"]);

    // G1 hops every turn round the office; G2 (tempo 2) stands its post; the desk never moves.
    const g1 = run.turns.map((t) => t.guards.find((g) => g.guardId === "G1")?.nodeId);
    expect(g1).toEqual(["o-south", "o-west", "o-north", "o-south"]);
    expect(run.turns.map((t) => t.guards.find((g) => g.guardId === "G2")?.nodeId)).toEqual(["mc-2", "mc-2", "mc-2", "mc-2"]);
    expect(run.guards.find((g) => g.id === "G2")?.nodeId).toBe("mc-2");
    expect(run.cleaners.map((c) => c.nodeId)).toEqual(["el-south"]);

    expect(run.turns.every((t) => t.alarm === "calm")).toBe(true);

    expect(playOnce().turns).toEqual(run.turns);
    expect(play(createRun(placed(quiet, 7).level), route).turns).toEqual(run.turns);
  });

  it("raises the alarm when the owner's camera sees the player", () => {
    // C1 hangs over dc-west facing down the dock corridor, and watches its own node.
    const run = play(createRun(placed().level), [{ kind: "move", to: "fl-lobby" }, { kind: "move", to: "dc-west" }, { kind: "wait" }]);
    expect(run.turns.some((t) => t.alarm !== "calm")).toBe(true);
  });

  it("does not change its inputs", () => {
    const m = manifest();
    const f = floor();
    const setup = structuredClone(NIGHT);
    applyOwnerSetup(m, f, setup, 7);
    expect(m).toEqual(manifest());
    expect(f).toEqual(floor());
    expect(setup).toEqual(NIGHT);
  });
});
