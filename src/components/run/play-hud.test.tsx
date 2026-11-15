// Live mode's HUD (issue 100) on the cached F1 level, placed as the Run screen
// places it: the hops left, who noticed the player, the radio's order, and
// what each play mode puts on the screen.
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { BuildingScreen } from "@/components/shell/building-screen";
import { LevelManifest, type FloorGraph } from "@/domain";
import { act, createRun, neighbours, shortestPath, zoneOf, type Action, type Level, type RunState } from "@/engine";
import { placeLevel } from "@/level/placer";
import cached from "../../../data/levels/F1.romaine-1974.json";
import cachedF2 from "../../../data/levels/F2.sunset-1986.json";
import cachedF3 from "../../../data/levels/F3.night-desk.json";
import { choices, describeTurn, planSteps, sprintChoices } from "./board";
import { AlarmBanner } from "./alarm-banner";
import { BoardView } from "./board-view";
import { ChiefPanel, type ChiefState } from "./chief-panel";
import { DangerMeter, UNSEEN, watcherPhrase } from "./danger-meter";
import { LensLegend, LensToggle } from "./layer-lens";
import { panelsOpen, RunLayout, voiced, type RunLayoutProps } from "./live-layout";
import { ObjectiveLine } from "./objective-line";
import {
  calloutOf,
  chiefLines,
  chiefTag,
  endNote,
  nextStep,
  noticedBy,
  noticeOf,
  objectiveInfo,
  radioFacts,
  routeLeft,
  secondsLeft,
  sprintVia,
  usePlayHud,
  type PlayHud,
} from "./play-hud";
import {
  RADIO_HOLD_MS,
  RADIO_SILENT,
  radioHold,
  radioLine,
  radioWake,
  tuneIn,
  tuneRadio,
  type RadioFacts,
  type RadioMessage,
  type RadioState,
} from "./radio";
import { RADIO_QUIET, RadioLine } from "./radio-line";
import { FP } from "./fp/tuning";
import { buildWorld, edgePath } from "./fp/world";
import { firstPersonPace } from "./fp/run-view";
import { Outcome, RUN_SEED } from "./run-screen";
import { whyTargets } from "./why";

const manifest = LevelManifest.parse(structuredClone(cached));
const placed = placeLevel(manifest, structuredClone(FIXTURE_FLOORS.F1), RUN_SEED);
const { mission } = manifest;
const start = () => createRun(placed.level);

function play(run: RunState, actions: readonly Action[]): RunState {
  return actions.reduce((state, action, i) => {
    const result = act(state, action);
    if (!result.ok) throw new Error(`action ${i} (${JSON.stringify(action)}) refused: ${result.reason}`);
    return result.run;
  }, run);
}
const move = (to: string): Action => ({ kind: "move", to });
const wait: Action = { kind: "wait" };

/** The dock corridor's east end, beside the records door, reached on the turns C2 looks the other way. */
const TO_THE_DOOR: readonly Action[] = [move("fl-lobby"), wait, move("dc-west"), move("dc-mid"), move("dc-east")];
const PICK: Action = { kind: "pick", doorId: "d-records-room" };

// ---- the hops left ---------------------------------------------------------------

/**
 * A floor with two ways from `a` to the objective on `b`: one hop through the
 * lockable door `d-short`, or three open hops round by `c` and `e`, the last
 * of them through the lockable door `d-far`.
 */
function twoWays(lockedDoors: readonly string[]): RunState {
  const node = (id: string, x: number, y: number) => ({ id, x, y, roomId: "hall", tags: [] });
  const floor: FloorGraph = {
    nodes: [node("a", 0, 0), node("b", 2, 0), node("c", 0, 2), node("e", 2, 2)],
    edges: [
      { a: "a", b: "b", door: { id: "d-short", lockable: true } },
      { a: "a", b: "c" },
      { a: "c", b: "e" },
      { a: "e", b: "b", door: { id: "d-far", lockable: true } },
    ],
    rooms: [{ id: "hall", label: "Hall", rect: { x: 0, y: 0, w: 3, h: 3 } }],
    sightlines: {},
    source: "fixture",
  };
  const level: Level = {
    buildingId: "T",
    missionId: "two-ways",
    seed: 1,
    floor,
    start: "a",
    objective: "b",
    exits: ["c"],
    lockedDoors,
    pickTurns: 2,
    patrolTempo: 1,
    guards: [],
  };
  return createRun(level);
}

describe("the hops left", () => {
  it("are the shortest open path to the objective, not a shorter one through a locked door", () => {
    expect(routeLeft(twoWays([]))).toEqual({ goal: "b", hops: 1, locks: 0 });
    // The short way is locked: the count is the open way round, three hops.
    expect(routeLeft(twoWays(["d-short"]))).toEqual({ goal: "b", hops: 3, locks: 0 });
  });

  it("with no open path, are the shortest path through locked doors, and say how many it passes", () => {
    expect(routeLeft(twoWays(["d-short", "d-far"]))).toEqual({ goal: "b", hops: 1, locks: 1 });
  });

  it("count down to the records room on F1, through its locked door until it is picked", () => {
    let run = start();
    // Freight lift car, lift lobby, three corridor nodes, the door's node, the files.
    expect(routeLeft(run)).toEqual({ goal: placed.level.objective, hops: 6, locks: 1 });
    expect(shortestPath(run.board, run.playerNode, [placed.level.objective], (e) => !e.doorId || !run.locked.includes(e.doorId))).toBeNull();
    run = play(run, [move("fl-lobby")]);
    expect(routeLeft(run)).toEqual({ goal: placed.level.objective, hops: 5, locks: 1 });
    run = play(run, TO_THE_DOOR.slice(1));
    expect(routeLeft(run)).toEqual({ goal: placed.level.objective, hops: 2, locks: 1 });
    run = play(run, [PICK, PICK]);
    expect(run.locked).not.toContain("d-records-room");
    expect(routeLeft(run)).toEqual({ goal: placed.level.objective, hops: 2, locks: 0 });
    run = play(run, [move("rr-door"), move("rr-files")]);
    expect(routeLeft(run)).toEqual({ goal: placed.level.objective, hops: 0, locks: 0 });
  });

  it("are to the nearest exit once the player carries the objective", () => {
    let run = play(start(), [...TO_THE_DOOR, PICK, PICK, move("rr-door"), move("rr-files")]);
    expect(routeLeft(run)?.goal).toBe(placed.level.objective);
    run = play(run, [{ kind: "take" }]);
    expect(run.carrying).toBe(true);
    // Back the way in: the loading dock is six hops, the roof hatch further.
    expect(routeLeft(run)).toEqual({ goal: "fl-car", hops: 6, locks: 0 });
    for (const exit of placed.level.exits) {
      const path = shortestPath(run.board, run.playerNode, [exit]);
      expect(path!.length - 1).toBeGreaterThanOrEqual(6);
    }
    // A door the Chief locks behind the player is on the way out, and the count says so.
    expect(routeLeft({ ...run, locked: ["d-records-room"] })).toEqual({ goal: "fl-car", hops: 6, locks: 1 });
  });

  it("is null when the floor does not join the player to the goal", () => {
    const run = twoWays([]);
    const island: RunState = { ...run, board: { ...run.board, adjacency: new Map([...run.board.adjacency.keys()].map((id) => [id, []])) } };
    expect(routeLeft(island)).toBeNull();
  });
});

describe("the objective line's words", () => {
  it("is the mission's own objective and the hops to it", () => {
    const info = objectiveInfo(placed, start(), mission.objective, mission.exitCondition);
    expect(info).toEqual({
      label: "Objective",
      goal: mission.objective,
      hops: 6,
      locks: 1,
      taken: null,
      take: null,
      outcome: null,
    });
  });

  it("offers the take where the player stands on the objective, then names the exit", () => {
    let run = play(start(), [...TO_THE_DOOR, PICK, PICK, move("rr-door"), move("rr-files")]);
    expect(objectiveInfo(placed, run, mission.objective, mission.exitCondition)).toMatchObject({ hops: 0, take: "Take the files" });
    run = play(run, [{ kind: "take" }]);
    expect(objectiveInfo(placed, run, mission.objective, mission.exitCondition)).toEqual({
      label: "Way out",
      goal: "Out by the loading dock or the roof hatch. Reach either with the files and the run ends.",
      hops: 6,
      locks: 0,
      taken: "Carrying the files",
      take: null,
      outcome: null,
    });
  });

  it("says how the run ended, with no hops left to count", () => {
    const run = start();
    const caught = objectiveInfo(placed, { ...run, status: "caught" }, mission.objective, mission.exitCondition);
    expect(caught).toMatchObject({ label: "Caught", goal: "Caught in the Freight Lift Lobby.", hops: null, outcome: "caught" });
    const won = objectiveInfo(placed, { ...run, status: "won", carrying: true }, mission.objective, mission.exitCondition);
    expect(won).toMatchObject({ label: "Clean exit", goal: "Out with the files.", hops: null, outcome: "won" });
    expect(endNote({ ...run, turn: 12 })).toBe("12 turns, 0 alarm raises. The debrief has the replay.");
  });

  it("renders the goal, the count and the lock, or the action in the count's place", () => {
    const out = renderToStaticMarkup(<ObjectiveLine label="Objective" goal={mission.objective} hops={6} locks={1} />);
    expect(out).toContain(mission.objective);
    expect(out).toMatch(/data-testid="hops-left" data-hops="6" data-locks="1"/);
    expect(out).toContain("locked door");
    expect(renderToStaticMarkup(<ObjectiveLine label="Objective" goal="x" hops={1} />)).toMatch(/>hop</);
    const acting = renderToStaticMarkup(
      <ObjectiveLine label="Objective" goal="x" hops={0} action={{ label: "Take the files", onAct: () => {}, keyHint: "Space" }} />,
    );
    expect(acting).toContain("Take the files");
    expect(acting).not.toContain('data-testid="hops-left"');
    expect(renderToStaticMarkup(<ObjectiveLine label="Caught" goal="x" hops={null} tone="danger" />)).not.toContain("hops-left");
  });
});

// ---- first person: the same in real time -----------------------------------------

describe("the HUD in first person (issue 115): seconds and plain words, not hops and turns", () => {
  const pace = { unitM: 1, mps: 1, turnMs: 1000 };
  const FIRST_PERSON_PACE = firstPersonPace(placed.level.floor);

  it("counts the seconds the route takes at a run, and a turn for each pick its locks still need", () => {
    // Round by c and e: three open hops of 2 units.
    expect(secondsLeft(twoWays(["d-short"]), pace)).toBe(6);
    // Straight through the locked d-short: one hop of 2 units, then its two picks.
    const locked = twoWays(["d-short", "d-far"]);
    expect(secondsLeft(locked, pace)).toBe(4);
    expect(secondsLeft({ ...locked, picking: { doorId: "d-short", progress: 1 } }, pace)).toBe(3);
    // On the goal: nothing left.
    expect(secondsLeft({ ...locked, playerNode: "b" }, pace)).toBe(0);
    // Rounded up: never 0 short of the goal.
    expect(secondsLeft(twoWays([]), { ...pace, mps: 3 })).toBe(1);
  });

  it("walks each edge the way the body does, through its doorway, when the pace knows the way", () => {
    // The hop through d-short bends out by 1 unit and back: 2 * sqrt(2) units, not 2.
    const bent = (a: string, b: string) =>
      a === "a" && b === "b" ? [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }] : [];
    const locked = twoWays(["d-short", "d-far"]);
    expect(secondsLeft(locked, { ...pace, edge: bent, turnMs: 0 })).toBe(Math.ceil(2 * Math.SQRT2));
    // An edge the pace has no way for is straight, as before.
    expect(secondsLeft(twoWays(["d-short"]), { ...pace, edge: bent })).toBe(6);
  });

  it("on a fixture floor, follows the walker's doorways at the controller's one speed", () => {
    const floor = placed.level.floor;
    const run = start();
    const world = buildWorld(floor);
    const path = shortestPath(run.board, run.playerNode, [run.board.level.objective])!;
    const throughDoors = path.slice(1).reduce((m, to, i) => {
      const way = edgePath(world, path[i], to);
      return m + way.slice(1).reduce((n, p, k) => n + Math.hypot(p.x - way[k].x, p.y - way[k].y), 0);
    }, 0);
    const straight = path.slice(1).reduce((m, to, i) => {
      const [a, b] = [run.board.nodes.get(path[i])!, run.board.nodes.get(to)!];
      return m + Math.hypot(b.x - a.x, b.y - a.y) * FP.unitM;
    }, 0);
    expect(throughDoors).toBeGreaterThan(straight);
    const ran = firstPersonPace(floor);
    expect(ran.mps).toBe(FP.runMps);
    // Less the records door's picks, the time is the doorway path at that speed.
    expect(routeLeft(run)?.locks).toBe(1);
    expect(secondsLeft(run, { ...ran, turnMs: 0 })).toBe(Math.ceil(throughDoors / FP.runMps));
  });

  it("on a live scan's floor, times node to node in a straight line in the scan's own metres", () => {
    const floor = { ...placed.level.floor, source: "matterport" } as typeof placed.level.floor;
    const ran = firstPersonPace(floor);
    // A scan's board is in metres already (its ground's `unitM` is 1), not the fixture floors' plan units.
    expect(ran.unitM).toBe(1);
    expect(ran.edge).toBeUndefined();
    expect(ran.mps).toBe(FP.runMps);
    expect(firstPersonPace(placed.level.floor).unitM).toBe(FP.unitM);
  });

  it("keeps the Details panel in real time: the plan says hold E, no turn count, the end in plain words", () => {
    const run = start();
    const lockStep = (realTime: boolean) => planSteps(placed, run, mission.objective, realTime).map((s) => s.label)[1];
    expect(lockStep(true)).toBe("Pick the records room door: hold E at it");
    expect(lockStep(false)).toBe("Pick the records room door, 2 turns");
    expect(renderToStaticMarkup(<AlarmBanner alarm="calm" turn={null} />)).not.toContain('data-testid="turn"');
    expect(renderToStaticMarkup(<AlarmBanner alarm="calm" turn={4} />)).toContain('data-testid="turn"');
    const over: RunState = { ...run, turn: 12, status: "caught" };
    const fp = renderToStaticMarkup(<Outcome placed={placed} run={over} realTime />);
    expect(fp).toContain("No alarm raised. The debrief has the replay.");
    expect(fp).not.toMatch(/turns?/);
    expect(renderToStaticMarkup(<Outcome placed={placed} run={over} />)).toContain("12 turns, 0 alarm raises.");
  });

  it("gives the objective line seconds as well as the hops, and leaves the board's line as it was", () => {
    const board = objectiveInfo(placed, start(), mission.objective, mission.exitCondition);
    expect(board).not.toHaveProperty("seconds");
    const fp = objectiveInfo(placed, start(), mission.objective, mission.exitCondition, FIRST_PERSON_PACE);
    expect(fp).toEqual({ ...board, seconds: secondsLeft(start(), FIRST_PERSON_PACE) });
    expect(fp.seconds).toBeGreaterThan(0);
    const caught = objectiveInfo(placed, { ...start(), status: "caught" }, mission.objective, mission.exitCondition, FIRST_PERSON_PACE);
    expect(caught).toMatchObject({ hops: null, seconds: null, outcome: "caught" });
  });

  it("renders the seconds in place of the hops", () => {
    const out = renderToStaticMarkup(<ObjectiveLine label="Objective" goal="x" hops={6} seconds={9} locks={1} />);
    expect(out).toMatch(/data-testid="time-left" data-seconds="9" data-locks="1"/);
    expect(out).toContain(">seconds<");
    expect(out).not.toMatch(/>hops?</);
    expect(out).not.toContain("hops-left");
    expect(renderToStaticMarkup(<ObjectiveLine label="Objective" goal="x" hops={1} seconds={1} />)).toContain(">second<");
    expect(renderToStaticMarkup(<ObjectiveLine label="Caught" goal="x" hops={null} seconds={null} />)).not.toContain("time-left");
  });

  it("ends the run with the alarms in plain words, not the turns", () => {
    const run = start();
    expect(endNote({ ...run, turn: 12 }, true)).toBe("No alarm raised. The debrief has the replay.");
    const raised = (n: number): RunState => ({ ...run, alarmEvents: Array.from({ length: n }, () => ({ turn: 1, cause: { kind: "camera", id: "C1" } }) as RunState["alarmEvents"][number]) });
    expect(endNote(raised(1), true)).toBe("One alarm raised. The debrief has the replay.");
    expect(endNote(raised(3), true)).toBe("3 alarms raised. The debrief has the replay.");
    expect(endNote(raised(3))).toBe("0 turns, 3 alarm raises. The debrief has the replay.");
  });

  it("tells the player to move with the keys, and how to pick, not how many turns", () => {
    const run = start();
    expect(nextStep(placed, run, mission.objective, null, true)).toBe("You're in at the loading dock. Move with W, A, S and D.");
    expect(nextStep(placed, play(run, [move("fl-lobby")]), mission.objective, null, true)).toBe("Pick the records room door: hold E at it");
    // The board's own words are unchanged.
    expect(nextStep(placed, play(run, [move("fl-lobby")]), mission.objective, null)).toBe("Pick the records room door, 2 turns");
  });
});

// ---- who noticed the player ------------------------------------------------------

describe("who noticed the player", () => {
  it("names the camera whose cover the player steps into, and nobody on a quiet turn", () => {
    const quiet = start();
    const inLobby = play(quiet, [move("fl-lobby")]);
    expect(noticedBy(quiet, inLobby)).toEqual([]);
    // C2 watches the corridor's west end on turn 1: the wow beat.
    const tripped = play(inLobby, [move("dc-west")]);
    expect(tripped.alarm).toBe("alert");
    const watchers = noticedBy(inLobby, tripped);
    expect(watchers).toEqual([{ id: "C2", sense: "sees" }]);
    expect(calloutOf(watchers, 1, "Dock Corridor")).toEqual({ turn: 1, kind: "sighting", text: "C2 sees you in the Dock Corridor." });
    expect(calloutOf([], 1, "Dock Corridor")).toBeNull();
  });

  it("names a guard who hears a sprint, as a noise", () => {
    const before = play(start(), [
      { kind: "sprint", to: "dc-west", via: "fl-lobby" },
      { kind: "sprint", to: "dc-east", via: "dc-mid" },
    ]);
    expect(before.alarm).toBe("calm");
    const after = play(before, [{ kind: "sprint", to: "o-north", via: "o-west" }]);
    expect(after.alarmEvents.at(-1)).toMatchObject({ to: "suspicious", cause: { kind: "noise", id: "G2" } });
    const watchers = noticedBy(before, after);
    expect(watchers).toEqual([{ id: "G2", sense: "hears" }]);
    expect(calloutOf(watchers, before.turn, "Open Office 2210")).toMatchObject({ kind: "noise", text: "G2 hears you in the Open Office 2210." });
  });

  it("names whoever goes on seeing the player at Lockdown, where the engine raises no event to read it from", () => {
    // A camera: into C2's cover on a turn it watches, already at Lockdown and last seen there a turn ago.
    const inLobby = play(start(), [move("fl-lobby")]);
    const cover = play(inLobby, [move("dc-west")]);
    const lockedDown: RunState = { ...inLobby, alarm: "lockdown", lastKnown: cover.lastKnown, lastSeen: { nodeId: "dc-west", turn: 0 } };
    const seenAgain = play(lockedDown, [move("dc-west")]);
    expect(seenAgain.alarmEvents).toHaveLength(lockedDown.alarmEvents.length);
    expect(seenAgain.lastSeen).toEqual({ nodeId: "dc-west", turn: 1 });
    expect(noticedBy(lockedDown, seenAgain)).toEqual([{ id: "C2", sense: "sees" }]);

    // A guard, after its own move: nobody sees the open office's south end as the turn starts, and G2 walks into view of it.
    const run = start();
    const hiding: RunState = { ...run, playerNode: "o-south", alarm: "lockdown", lastKnown: zoneOf(run.board, "o-south"), lastSeen: { nodeId: "o-south", turn: 0 } };
    const found = play(hiding, [wait]);
    expect(found.status).toBe("playing");
    expect(found.alarmEvents).toHaveLength(hiding.alarmEvents.length);
    expect(noticedBy(hiding, found)).toEqual([{ id: "G2", sense: "sees" }]);
  });

  it("looks for the player on a sprint's middle node when two nodes could have been it, as the engine does", () => {
    // Four turns in, G1's round looks into the west suites' north-east corner, not their south-west one.
    const run = play(start(), [wait, wait, wait, wait]);
    const there: RunState = { ...run, playerNode: "s1-se" };
    // Two neighbours lead to the far corner, in this order on the floor's edge list.
    const middles = neighbours(there.board, "s1-se")
      .map((first) => first.to)
      .filter((mid) => neighbours(there.board, mid).some((second) => second.to === "s1-w"));
    expect(middles).toEqual(["s1-sw", "s1-ne"]);
    // The board's choice says which of the two the sprint takes: the first clockwise, not the first on the
    // edge list. That is the action a key or a click plays, and the middle node read back.
    const sprint = sprintChoices(there).find((c) => c.nodeId === "s1-w")!;
    expect(sprint.action).toEqual({ kind: "sprint", to: "s1-w", via: "s1-ne" });
    expect(sprintVia(there, "s1-w")).toBe("s1-ne");

    // At Lockdown, last seen there a turn ago: the engine sees the player on the way and raises no event for it.
    const before: RunState = { ...there, alarm: "lockdown", lastKnown: zoneOf(run.board, "s1-ne"), lastSeen: { nodeId: "s1-ne", turn: 3 } };
    const after = play(before, [sprint.action]);
    expect(after.playerNode).toBe("s1-w");
    expect(after.status).toBe("playing");
    expect(after.lastSeen).toEqual({ nodeId: "s1-ne", turn: 4 });
    expect(after.alarmEvents).toHaveLength(before.alarmEvents.length);
    expect(noticedBy(before, after)).toEqual([{ id: "G1", sense: "sees" }]);
  });

  it("reads no middle node into a sprint a guard stopped on its first hop", () => {
    // The player ends on a neighbour: that node is where the engine looked, and there is no second.
    expect(sprintVia(start(), "fl-lobby")).toBeNull();
    // A sprint the board offers, with one way through.
    expect(sprintVia(start(), "dc-west")).toBe("fl-lobby");
  });

  it("is nobody across anything but one turn of the same run", () => {
    const run = start();
    const later = play(run, [move("fl-lobby"), move("dc-west")]);
    expect(noticedBy(run, later)).toEqual([]);
    expect(noticedBy(later, later)).toEqual([]);
    expect(noticedBy(start(), play(start(), [move("fl-lobby")]))).toEqual([]);
  });

  it.each([
    ["F1", cached],
    ["F2", cachedF2],
    ["F3", cachedF3],
  ] as const)("agrees with the engine on every turn of 400 seeded walks on %s: somebody is named exactly when the engine detected the player", (id, level) => {
    const floorPlaced = placeLevel(LevelManifest.parse(structuredClone(level)), structuredClone(FIXTURE_FLOORS[id]), RUN_SEED);
    const random = (seed: number) => {
      let s = seed >>> 0;
      return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    };
    const seen = { turns: 0, noticed: 0, sprints: 0, noise: 0, twoWays: 0, twoWaysNoticed: 0 };
    for (let seed = 1; seed <= 400; seed++) {
      const next = random(seed);
      let run = createRun(floorPlaced.level);
      for (let i = 0; i < 80 && run.status === "playing"; i++) {
        const pool: Action[] = [...choices(run), ...sprintChoices(run)].map((c) => c.action);
        pool.push(wait, wait);
        const result = act(run, pool[Math.floor(next() * pool.length)]);
        if (!result.ok) continue;
        const [before, after] = [run, result.run];
        const watchers = noticedBy(before, after);
        const kind = after.turns.at(-1)!.player.kind;
        const events = after.alarmEvents.slice(before.alarmEvents.length).filter((e) => e.cause.kind !== "decay");
        // Whoever raised the alarm this turn is named: a sighting as one. (A guard who heard the
        // player may have gone on to see them after its move, and is then named as seeing.)
        for (const { cause } of events) {
          const named = watchers.find((w) => w.id === cause.id);
          expect(named, `seed ${seed} turn ${before.turn}: ${cause.kind} ${cause.id}`).toBeDefined();
          if (cause.kind !== "noise") expect(named!.sense, `seed ${seed} turn ${before.turn}`).toBe("sees");
        }
        // The engine marks the turn it last detected the player on: every turn, every kind of action.
        expect(watchers.length > 0, `seed ${seed} turn ${before.turn} (${kind})`).toBe(after.lastSeen?.turn === before.turn);
        // A sprint that two different middle nodes could have carried.
        const ways = neighbours(before.board, before.playerNode).filter(
          (first) => first.to !== after.playerNode && neighbours(before.board, first.to).some((second) => second.to === after.playerNode),
        );
        const twoWays = kind === "sprint" && ways.length > 1;
        seen.turns += 1;
        seen.noticed += watchers.length > 0 ? 1 : 0;
        seen.sprints += kind === "sprint" ? 1 : 0;
        seen.noise += events.filter((e) => e.cause.kind === "noise").length;
        seen.twoWays += twoWays ? 1 : 0;
        seen.twoWaysNoticed += twoWays && watchers.length > 0 ? 1 : 0;
        run = after;
      }
    }
    // The walks reach every kind of turn the check is about.
    expect(seen.turns).toBeGreaterThan(500);
    expect(seen.noticed).toBeGreaterThan(100);
    expect(seen.turns - seen.noticed).toBeGreaterThan(100);
    expect(seen.sprints).toBeGreaterThan(100);
    // F1's open office and west suites have nodes two ways apart, and its guards hear a sprint there.
    if (id === "F1") {
      expect(seen.noise).toBeGreaterThan(0);
      expect(seen.twoWays).toBeGreaterThan(0);
      expect(seen.twoWaysNoticed).toBeGreaterThan(0);
    }
  });

  it("says who in words, sightings first, each watcher once", () => {
    expect(watcherPhrase([])).toBe("");
    expect(watcherPhrase([{ id: "C2", sense: "sees" }])).toBe("C2 sees you");
    expect(watcherPhrase([{ id: "G1", sense: "sees" }, { id: "C2", sense: "sees" }])).toBe("G1 and C2 see you");
    expect(watcherPhrase([{ id: "G1", sense: "sees" }, { id: "G2", sense: "sees" }, { id: "C2", sense: "sees" }])).toBe("G1, G2 and C2 see you");
    expect(watcherPhrase([{ id: "G2", sense: "hears" }])).toBe("G2 hears you");
    expect(watcherPhrase([{ id: "G2", sense: "hears" }, { id: "G3", sense: "hears" }])).toBe("G2 and G3 hear you");
    expect(watcherPhrase([{ id: "G2", sense: "hears" }, { id: "C2", sense: "sees" }, { id: "C2", sense: "hears" }])).toBe("C2 sees you, G2 hears you");
  });
});

describe("the danger meter", () => {
  it("shows the alarm level as a word and as steps, and who noticed the player", () => {
    const calm = renderToStaticMarkup(<DangerMeter alarm="calm" watchers={[]} />);
    expect(calm).toMatch(/data-testid="danger-level"[^>]*>Calm</);
    // One kind of live region for the level: an alert, with no second, politer one beside it.
    expect(calm).toMatch(/<span role="alert" data-testid="danger-level"/);
    expect(calm).not.toMatch(/aria-live|role="status"/);
    expect(calm).toContain('data-reached="1"');
    expect(calm).toContain(UNSEEN);
    // Calm is quiet: nothing in an alarm colour, and no flash.
    expect(calm).not.toMatch(/danger"|warning|alarm-change/);

    const alert = renderToStaticMarkup(<DangerMeter alarm="alert" watchers={[{ id: "C2", sense: "sees" }]} />);
    expect(alert).toMatch(/data-testid="danger-level"[^>]*text-danger[^>]*>Alert</);
    expect(alert).toContain('data-reached="3"');
    expect(alert).toContain("C2 sees you");
    expect(alert).not.toContain(UNSEEN);
    expect(alert).toContain("alarm-change");

    expect(renderToStaticMarkup(<DangerMeter alarm="suspicious" watchers={[]} />)).toMatch(/text-warning[^>]*>Suspicious</);
    expect(renderToStaticMarkup(<DangerMeter alarm="lockdown" watchers={[]} />)).toContain('data-reached="4"');
  });
});

// ---- the radio's order -----------------------------------------------------------

const STEP = "Pick the records room door, 2 turns";
const SIGHTING = { turn: 3, kind: "sighting", text: "C2 sees you in the Dock Corridor." } as const;
const CHIEF = ["C2 has them in the dock corridor.", "G1 and G4, up through the elevator lobby and converge.", "Lock the records room."];
/** One run, as the radio tells runs apart; `ANOTHER_RUN` is the run after Restart. */
const THIS_RUN = { run: "this one" };
const ANOTHER_RUN = { run: "the next" };
const facts = (over: Partial<RadioFacts> = {}): RadioFacts => ({ run: THIS_RUN, step: STEP, note: null, callout: null, chief: null, ...over });
const answer = { id: "an answer" };
const chief = (lines: number, done = lines === CHIEF.length) => ({ answer, lines: CHIEF.slice(0, lines), done, tag: "Recorded" });

/** Runs the radio's own clock from `now` until it has nothing left to change, and returns each line as it took the air. */
function listen(state: RadioState, what: RadioFacts, now: number): { state: RadioState; heard: { at: number; line: RadioMessage | null }[] } {
  const heard: { at: number; line: RadioMessage | null }[] = [];
  let next = tuneRadio(state, what, now);
  heard.push({ at: now, line: radioLine(next, what) });
  for (let wake = radioWake(next, what), i = 0; wake !== null && i < 50; wake = radioWake(next, what), i++) {
    next = tuneRadio(next, what, wake);
    heard.push({ at: wake, line: radioLine(next, what) });
  }
  return { state: next, heard };
}

describe("the radio's order", () => {
  it("says the crew's next plan step when nobody else is talking, and nothing when there is none", () => {
    expect(radioLine(RADIO_SILENT, facts())).toEqual({ kind: "step", text: STEP });
    expect(radioLine(RADIO_SILENT, facts({ step: null }))).toBeNull();
    // A note stands in for the step while it applies.
    expect(radioLine(RADIO_SILENT, facts({ note: "Sprinting." }))).toEqual({ kind: "note", text: "Sprinting." });
  });

  it("puts a sighting on the air in place of the plan step at once: in the render of its own turn, before any clock ticks", () => {
    const state = tuneRadio(RADIO_SILENT, facts(), 0);
    expect(radioLine(state, facts())).toMatchObject({ kind: "step" });
    // The same remembered state, the new turn's facts: no tune, no time passed.
    expect(radioLine(state, facts({ callout: SIGHTING }))).toEqual({ kind: "sighting", text: SIGHTING.text });
    expect(radioLine(state, facts({ callout: { ...SIGHTING, kind: "noise", text: "G2 hears you." } }))).toMatchObject({ kind: "noise" });
  });

  it("keeps a callout on the air for its hold when the next turn is quiet, then goes back to the step", () => {
    const state = tuneRadio(RADIO_SILENT, facts({ callout: SIGHTING }), 1000);
    const quiet = facts();
    const hold = radioHold(SIGHTING.text);
    expect(radioLine(tuneRadio(state, quiet, 1000 + hold - 1), quiet)).toMatchObject({ kind: "sighting" });
    expect(radioWake(state, quiet)).toBe(1000 + hold);
    expect(radioLine(tuneRadio(state, quiet, 1000 + hold), quiet)).toEqual({ kind: "step", text: STEP });
    // The next turn's callout does not wait for the hold: it is this turn's truth.
    const again = { ...SIGHTING, turn: 4, text: "G1 sees you in the Dock Corridor." };
    expect(radioLine(tuneRadio(state, facts({ callout: again }), 1001), facts({ callout: again }))).toMatchObject({ text: again.text });
  });

  it("reads the Chief's lines in the order they streamed, one at a time, each for its hold, after the sighting has had its own", () => {
    // The trip, then the Chief's whole answer a moment later.
    let state = tuneRadio(RADIO_SILENT, facts({ callout: SIGHTING }), 0);
    const all = facts({ callout: SIGHTING, chief: chief(3) });
    const { state: end, heard } = listen(state, all, 200);
    state = end;
    expect(heard.map((h) => h.line?.text)).toEqual([SIGHTING.text, CHIEF[0], CHIEF[1], CHIEF[2], SIGHTING.text]);
    expect(heard.slice(1, 4).every((h) => h.line?.kind === "chief" && h.line.tag === "Recorded")).toBe(true);
    // The sighting kept the air for its whole hold; each Chief line for its own.
    expect(heard[1].at).toBe(radioHold(SIGHTING.text));
    expect(heard[2].at - heard[1].at).toBe(radioHold(CHIEF[0]));
    expect(heard[3].at - heard[2].at).toBe(radioHold(CHIEF[1]));
    expect(heard[4].at - heard[3].at).toBe(radioHold(CHIEF[2]));
    expect(radioHold(CHIEF[0])).toBeGreaterThanOrEqual(RADIO_HOLD_MS);
    // Read out once: with nothing new, the radio has nothing more to change.
    expect(radioWake(state, all)).toBeNull();
    expect(tuneRadio(state, all, 60_000)).toBe(state);
  });

  it("never says a line the stream has not reached, and takes the next one as soon as it has", () => {
    let state = tuneRadio(RADIO_SILENT, facts(), 0);
    // The answer lands with no sentence finished yet: the step stays.
    state = tuneRadio(state, facts({ chief: chief(0) }), 100);
    expect(radioLine(state, facts({ chief: chief(0) }))).toMatchObject({ kind: "step" });
    // The first sentence: on the air at once, as no callout holds it.
    state = tuneRadio(state, facts({ chief: chief(1) }), 300);
    expect(radioLine(state, facts({ chief: chief(1) }))).toEqual({ kind: "chief", text: CHIEF[0], tag: "Recorded" });
    // Its hold is over, but the stream has no second sentence yet: the radio waits on the first.
    const waiting = 300 + radioHold(CHIEF[0]) + 500;
    expect(radioWake(state, facts({ chief: chief(1) }))).toBeNull();
    expect(radioLine(tuneRadio(state, facts({ chief: chief(1) }), waiting), facts({ chief: chief(1) }))).toMatchObject({ text: CHIEF[0] });
    // The second arrives: it takes the air on the next tune.
    state = tuneRadio(state, facts({ chief: chief(2) }), waiting);
    expect(radioLine(state, facts({ chief: chief(2) }))).toMatchObject({ kind: "chief", text: CHIEF[1] });
    // The stream ends: the last line gets its hold, then the Chief is off the air.
    const { heard } = listen(state, facts({ chief: chief(3) }), waiting + 10);
    expect(heard.map((h) => h.line?.text)).toEqual([CHIEF[1], CHIEF[2], STEP]);
  });

  it("holds a later callout back while the Chief is read out, and shows it once the read-out is over", () => {
    let state = tuneRadio(RADIO_SILENT, facts({ chief: chief(3) }), 0);
    expect(radioLine(state, facts({ chief: chief(3) }))).toMatchObject({ kind: "chief", text: CHIEF[0] });
    // A new turn, a guard sees the player, the same answer still being read: the Chief keeps the air.
    const seen = facts({ callout: { turn: 5, kind: "sighting", text: "G1 sees you in the Dock Corridor." }, chief: chief(3) });
    state = tuneRadio(state, seen, 400);
    expect(radioLine(state, seen)).toMatchObject({ kind: "chief", text: CHIEF[0] });
    const { heard } = listen(state, seen, 401);
    expect(heard.map((h) => h.line?.text)).toEqual([CHIEF[0], CHIEF[1], CHIEF[2], "G1 sees you in the Dock Corridor."]);
  });

  it("drops the Chief's old answer the moment a new alarm takes it away: the sighting is on the air at once", () => {
    let state = tuneRadio(RADIO_SILENT, facts({ chief: chief(3) }), 0);
    // The alarm rises again: the Run screen has a new call out, and no answer yet.
    const rising = facts({ callout: { turn: 6, kind: "sighting", text: "C2 sees you in the Dock Corridor." } });
    expect(radioLine(state, rising)).toMatchObject({ kind: "sighting" });
    state = tuneRadio(state, rising, 500);
    expect(state.chief).toBeNull();
    // The new answer starts from its first line, after the sighting's hold.
    const second = { answer: { id: "second" }, lines: ["Second contact, dock corridor.", "Lockdown."], done: true };
    const { heard } = listen(state, { ...rising, chief: second }, 600);
    expect(heard.map((h) => h.line?.text)).toEqual([rising.callout!.text, second.lines[0], second.lines[1], rising.callout!.text]);
    expect(heard[1].at).toBe(500 + radioHold(rising.callout!.text));
  });

  it("starts a new run from silence: neither a callout still holding the air nor the Chief's read-out carries over", () => {
    const BACK = "Back at the start. The guards are on their rounds.";
    // Seen, and the Chief's first line on the air.
    const seen = facts({ callout: SIGHTING, chief: chief(3) });
    let state = tuneRadio(RADIO_SILENT, facts({ callout: SIGHTING }), 0);
    state = tuneRadio(state, seen, radioHold(SIGHTING.text));
    expect(radioLine(state, seen)).toMatchObject({ kind: "chief", text: CHIEF[0] });

    // Restart, well inside the sighting's hold: the same remembered state, the fresh run's facts.
    // Nobody has noticed the player, no Chief has answered, and the status line says where they are.
    const fresh = facts({ run: ANOTHER_RUN, note: BACK });
    expect(radioLine(state, fresh)).toEqual({ kind: "note", text: BACK });
    // The Chief's old answer object turning up again on the new run is not read out either.
    expect(radioLine(state, { ...fresh, chief: chief(3) })).toEqual({ kind: "note", text: BACK });

    // A callout alone, restarted 200 ms after it took the air, with over a second of its hold left.
    const held = tuneRadio(RADIO_SILENT, facts({ callout: SIGHTING }), 0);
    expect(held.callout!.until).toBeGreaterThan(1200);
    expect(radioLine(held, fresh)).toEqual({ kind: "note", text: BACK });
    const tuned = tuneRadio(held, fresh, 200);
    expect(tuned).toEqual({ run: ANOTHER_RUN, callout: null, chief: null });
    expect(radioLine(tuned, fresh)).toEqual({ kind: "note", text: BACK });
    // Nothing of the old run is left to wake for.
    expect(radioWake(held, fresh)).toBeNull();
    expect(radioWake(tuned, fresh)).toBeNull();

    // The same turn number and the same words on the new run are a new callout, with its own hold.
    const again = facts({ run: ANOTHER_RUN, callout: SIGHTING });
    expect(tuneRadio(held, again, 5000).callout).toEqual({ ...SIGHTING, until: 5000 + radioHold(SIGHTING.text) });
    // On the run it belongs to, the memory is kept as before.
    expect(tuneRadio(held, facts({ callout: SIGHTING }), 200)).toBe(held);
  });

  it("drops a sighting on Restart, on the board: seen by C2, then a fresh run, and the radio says where the player is", () => {
    const hud = (run: RunState, before: RunState | null, status: string) =>
      radioFacts({
        placed,
        run,
        before,
        watchers: before ? noticedBy(before, run) : [],
        mission,
        crewPlan: null,
        chief: IDLE,
        revealed: { words: 0, done: false },
        status,
      });
    const inLobby = play(start(), [move("fl-lobby")]);
    const seen = play(inLobby, [move("dc-west")]);
    const seenFacts = hud(seen, inLobby, describeTurn(placed, inLobby, seen));
    const state = tuneRadio(RADIO_SILENT, seenFacts, 0);
    expect(radioLine(state, seenFacts)).toEqual({ kind: "sighting", text: "C2 sees you in the Dock Corridor." });
    // A later state of the same run is the same run to the radio.
    expect(hud(play(seen, [wait]), seen, "").run).toBe(seenFacts.run);

    // Restart, 200 ms later: a fresh run on a fresh board, and the status line's word for it.
    const BACK = "Back at the start. The guards are on their rounds.";
    const fresh = start();
    const freshFacts = hud(fresh, null, BACK);
    expect(freshFacts.run).not.toBe(seenFacts.run);
    expect(freshFacts.callout).toBeNull();
    expect(radioLine(state, freshFacts)).toEqual({ kind: "note", text: BACK });
    expect(radioLine(tuneRadio(state, freshFacts, 200), freshFacts)).toEqual({ kind: "note", text: BACK });
  });

  it("joins a run under way without reading out what the Chief has already said", () => {
    const told = facts({ chief: chief(3) });
    const joined = tuneIn(told, 0);
    expect(radioLine(joined, told)).toEqual({ kind: "step", text: STEP });
    expect(listen(joined, told, 10).heard.every((h) => h.line?.kind === "step")).toBe(true);
    // Mid-stream, it joins at the line being said.
    const midway = facts({ chief: chief(2, false) });
    expect(radioLine(tuneIn(midway, 0), midway)).toMatchObject({ kind: "chief", text: CHIEF[1] });
  });

  it("gives a long line longer on the air, up to a limit", () => {
    expect(radioHold("Lock it.")).toBe(RADIO_HOLD_MS);
    expect(radioHold("x".repeat(100))).toBeGreaterThan(RADIO_HOLD_MS);
    expect(radioHold("x".repeat(100))).toBeLessThan(radioHold("x".repeat(150)));
    expect(radioHold("x".repeat(5000))).toBe(radioHold("x".repeat(10_000)));
  });
});

describe("the Chief's words on the radio", () => {
  const rationale = "C2 has them in the dock corridor. G1 and G4, up through the elevator lobby and converge. Lock the records room.";

  it("are the sentences of its rationale that the stream has finished, in order, word for word", () => {
    const words = rationale.split(/\s+/).length;
    expect(chiefLines(rationale, 0)).toEqual([]);
    // Six of the first sentence's seven words: not a line yet.
    expect(chiefLines(rationale, 6)).toEqual([]);
    expect(chiefLines(rationale, 7)).toEqual([CHIEF[0]]);
    expect(chiefLines(rationale, words - 1)).toEqual(CHIEF.slice(0, 2));
    expect(chiefLines(rationale, words)).toEqual(CHIEF);
    // Nothing of the reasoning is left out or reworded: the lines are the rationale.
    expect(chiefLines(rationale, words).join(" ")).toBe(rationale);
  });

  it("keeps a rationale with no full stop as one line, once its last word is in", () => {
    expect(chiefLines("Hold the dock", 2)).toEqual([]);
    expect(chiefLines("Hold the dock", 3)).toEqual(["Hold the dock"]);
  });

  it("says where the answer came from beside the Chief's name, unless a live model wrote it", () => {
    const ready = (source: "model" | "recorded" | "template", late = false) =>
      ({ status: "ready", seq: 0, late, answer: { source }, applied: { applied: [], dropped: [], locked: [] } }) as unknown as Extract<
        ChiefState,
        { status: "ready" }
      >;
    expect(chiefTag(ready("model"))).toBeNull();
    expect(chiefTag(ready("recorded"))).toBe("Recorded");
    expect(chiefTag(ready("template"))).toBe("Rule-based");
    expect(chiefTag(ready("recorded", true))).toBe("Late");
  });
});

describe("the radio line", () => {
  it("shows one line with its speaker: the crew for a step or a callout, the Chief for its own words", () => {
    const step = renderToStaticMarkup(<RadioLine line={voiced({ kind: "step", text: STEP })} />);
    expect(step).toMatch(/data-testid="radio-speaker"[^>]*>Crew</);
    expect(step).toContain(STEP);
    expect(step.match(/data-testid="radio-text"/g)).toHaveLength(1);

    const sighting = renderToStaticMarkup(<RadioLine line={voiced({ kind: "sighting", text: SIGHTING.text })} />);
    expect(sighting).toMatch(/data-speaker="Crew" data-tone="danger"/);
    expect(renderToStaticMarkup(<RadioLine line={voiced({ kind: "noise", text: "G2 hears you." })} />)).toContain('data-tone="warning"');

    const chiefLine = renderToStaticMarkup(<RadioLine line={voiced({ kind: "chief", text: CHIEF[1], tag: "Recorded" })} />);
    expect(chiefLine).toMatch(/data-testid="radio-speaker"[^>]*>Chief</);
    expect(chiefLine).toMatch(/data-testid="radio-tag"[^>]*>Recorded</);
    // The Chief's sentence, whole.
    expect(chiefLine).toContain(CHIEF[1]);
    expect(renderToStaticMarkup(<RadioLine line={voiced({ kind: "chief", text: CHIEF[1] })} />)).not.toContain("radio-tag");
  });

  it("says so when the radio is quiet", () => {
    const quiet = renderToStaticMarkup(<RadioLine line={voiced(null)} />);
    expect(quiet).toContain(RADIO_QUIET);
    expect(quiet).not.toContain('data-testid="radio-text"');
  });
});

describe("the crew's line", () => {
  it("opens with where the player is and how to move, then follows the plan", () => {
    const run = start();
    expect(nextStep(placed, run, mission.objective, null)).toBe("You're in at the loading dock. Pick a number to move.");
    // A turn the clock played for the player is not a move: the opening line stays.
    expect(nextStep(placed, play(run, [wait]), mission.objective, null)).toBe("You're in at the loading dock. Pick a number to move.");
    expect(nextStep(placed, play(run, [move("fl-lobby")]), mission.objective, null)).toBe("Pick the records room door, 2 turns");
    const briefed = { recorded: true, plan: { steps: [{ zoneId: "dock-N", action: "Up from the loading dock on the freight lift" }, { zoneId: "objective", action: "Take the files" }], pushback: "", confidence: 0.5 } };
    expect(nextStep(placed, play(run, [move("fl-lobby")]), mission.objective, briefed)).toBe("Take the files");
  });
});

// ---- what each mode puts on the screen -------------------------------------------

const noop = () => {};
const IDLE: ChiefState = { status: "idle" };

/** The Run screen's pieces as it hands them to the layout: the real lens toggle, board, legend and Chief panel. */
function pieces(run: RunState, why: string | null = null) {
  return {
    bar: (
      <div className="flex h-14 shrink-0 items-center gap-3 px-6">
        <LensToggle on={false} onToggle={noop} />
      </div>
    ),
    board: (
      <div className="relative min-h-0 flex-1">
        <BoardView placed={placed} run={run} choices={choices(run)} onChoose={noop} initialWhy={why} />
      </div>
    ),
    legend: <LensLegend placed={placed} locked={run.locked} />,
    footer: (
      <div className="flex h-16 shrink-0 items-center justify-between gap-6 px-6">
        <p data-testid="run-status">You move to the Dock Corridor.</p>
        <span data-testid="keys-legend">1–9 move</span>
      </div>
    ),
    panel: <ChiefPanel state={IDLE} revealed={{ words: 0, rows: 0, done: false }} zoneName={(id) => id} onRetry={noop} />,
    action: <button type="button">See the debrief</button>,
  } satisfies Record<string, ReactNode>;
}

function hudOf(run: RunState, radio: RadioMessage | null = { kind: "step", text: STEP }, moment: PlayHud["moment"] = null): PlayHud {
  return {
    objective: objectiveInfo(placed, run, mission.objective, mission.exitCondition),
    danger: { alarm: run.alarm, watchers: [] },
    radio,
    moment,
  };
}

function layout(run: RunState, props: Partial<RunLayoutProps> & Pick<RunLayoutProps, "mode">, why: string | null = null): string {
  return renderToStaticMarkup(
    <RunLayout
      details={false}
      onDetails={noop}
      hud={hudOf(run)}
      loading={false}
      onTake={noop}
      onRestart={noop}
      canRestart
      {...pieces(run, why)}
      {...props}
    />,
  );
}

/** The markup less everything inside an element with the `hidden` attribute: what is on the screen. */
function shown(markup: string): string {
  let out = "";
  let at = 0;
  /** How deep inside a hidden element the walk is; 0 outside one. */
  let depth = 0;
  for (const tag of markup.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|[^>"])*?)(\/?)>/g)) {
    const [whole, closing, , attrs, selfClosing] = tag;
    if (depth === 0) out += markup.slice(at, tag.index);
    at = tag.index + whole.length;
    if (depth > 0) {
      if (closing) depth -= 1;
      else if (!selfClosing) depth += 1;
    } else if (!closing && / hidden=""/.test(attrs)) {
      if (!selfClosing) depth = 1;
    } else {
      out += whole;
    }
  }
  return out + markup.slice(at);
}

const PANELS = ['data-testid="chief-panel"', 'data-testid="lens-toggle"', 'data-testid="lens-legend"', 'data-testid="keys-legend"'];
const HUD = ['data-testid="objective-line"', 'data-testid="danger-meter"', 'data-testid="radio-line"'];
const DETAILS = 'data-testid="details-toggle"';

describe("the Run screen's layout", () => {
  it("in Tactical is the screen as it was before Live: the same markup, with nothing of the HUD in it", () => {
    const run = play(start(), [move("fl-lobby")]);
    const p = pieces(run);
    const before = renderToStaticMarkup(
      <BuildingScreen
        visualLabel="Run board"
        visual={
          <div className="absolute inset-0 flex flex-col" data-fullscreen-root="">
            {p.bar}
            {p.board}
            {p.legend}
            {p.footer}
          </div>
        }
        panel={p.panel}
        action={p.action}
      />,
    );
    // Whatever Details was left at, and with a HUD worked out or not, Tactical does not read them.
    for (const details of [false, true]) {
      expect(layout(run, { mode: "tactical", details })).toBe(before);
      expect(layout(run, { mode: "tactical", details, hud: null })).toBe(before);
    }
    for (const part of [...HUD, DETAILS, 'data-testid="play-hud"']) expect(before).not.toContain(part);
    for (const part of PANELS) expect(before).toContain(part);
    // The shell itself, as every other screen still gets it.
    // The open case file's two pages (issue 166): the board on the left page, the panel on the right.
    expect(before).toMatch(
      /^<div class="grid min-h-0 flex-1 gap-3 grid-rows-\[minmax\(320px,1fr\)_auto\] lg:grid-cols-\[minmax\(0,1fr\)_minmax\(340px,420px\)\] lg:grid-rows-1"><section aria-label="Run board" class="[^"]*bg-surface-0[^"]*relative min-h-0 overflow-hidden"><div class="absolute inset-0 flex flex-col" data-fullscreen-root="">/,
    );
    expect(before).toMatch(/<aside class="[^"]*bg-surface-0[^"]*flex min-h-0 flex-col">/);
  });

  it("reads what is on the screen: an element with the hidden attribute, and all inside it, is not", () => {
    expect(shown('<div><p hidden="">a<b>b</b><br/></p><i>c</i><span hidden=""></span>d</div>')).toBe("<div><i>c</i>d</div>");
    expect(shown('<a title="x > y">e</a>')).toBe('<a title="x > y">e</a>');
  });

  it("in Live shows the objective line, the danger meter and the radio line, with the panels closed", () => {
    const run = play(start(), [move("fl-lobby")]);
    const markup = layout(run, { mode: "live" });
    const out = shown(markup);
    for (const part of HUD) expect(out).toContain(part);
    expect(out).toContain(mission.objective);
    expect(out).toMatch(/data-testid="hops-left" data-hops="5"/);
    expect(out).toMatch(/data-testid="danger-level"[^>]*>Calm</);
    expect(out).toContain(STEP);
    // Closed: the Chief's panel, the lens and the legends are not on the screen, and no side panel is.
    for (const part of PANELS) expect(out).not.toContain(part);
    expect(out).not.toContain("<aside");
    expect(out).toMatch(/data-testid="details-toggle" aria-pressed="false"/);
    // Closed is hidden, not removed: each is still in the page, going on with its work.
    for (const part of PANELS) expect(markup).toContain(part);
    expect(markup).toContain('<aside hidden=""');
    // The bar's Restart is closed with the bar, so the HUD has one.
    expect(out).toContain('data-testid="live-restart"');
    // The board is still there, whole.
    expect(out).toContain('data-testid="run-board"');
    expect(out).toContain('data-testid="player-piece"');
  });

  it("opens the panels in Live with Details, beside the HUD", () => {
    const run = play(start(), [move("fl-lobby")]);
    const markup = layout(run, { mode: "live", details: true });
    const out = shown(markup);
    // Nothing is hidden once Details is open.
    expect(out).toBe(markup);
    for (const part of [...HUD, ...PANELS]) expect(out).toContain(part);
    expect(out).toContain("<aside");
    expect(out).not.toContain('data-testid="live-restart"');
    expect(out).toMatch(/data-testid="details-toggle" aria-pressed="true"/);
    expect(panelsOpen("live", false)).toBe(false);
    expect(panelsOpen("live", true)).toBe(true);
    expect(panelsOpen("tactical", false)).toBe(true);
  });

  it("keeps a kit building's record label on the screen in Live: in the HUD while the bar is closed (#95)", () => {
    const run = play(start(), [move("fl-lobby")]);
    const record = <span data-testid="record-label">Real CoStar record · stand-in floor plan</span>;
    const closed = shown(layout(run, { mode: "live", record }));
    expect(closed.match(/data-testid="record-label"/g)).toHaveLength(1);
    expect(closed).toMatch(/data-testid="play-hud"[^>]*><div class="flex w-full min-w-0"><span data-testid="record-label">/);
    // With Details open the bar carries it (run-screen.tsx puts it there), so the HUD doesn't.
    expect(layout(run, { mode: "live", details: true, record })).not.toContain('data-testid="record-label"');
    // Tactical is unchanged: the bar carries it.
    expect(layout(run, { mode: "tactical", record })).toBe(layout(run, { mode: "tactical" }));
  });

  it.each(["guard", "camera", "lock"] as const)("still opens a Why card from a %s in Live with the panels closed", (kind) => {
    const run = play(start(), [move("fl-lobby")]);
    const target = whyTargets(placed).find((t) => t.kind === kind)!;
    expect(layout(run, { mode: "live" })).not.toContain('data-testid="why-card"');
    const out = shown(layout(run, { mode: "live" }, target.key));
    expect(out).toContain('data-testid="why-card"');
    expect(out).toContain(`data-why-target="${target.key}"`);
    for (const part of PANELS) expect(out).not.toContain(part);
  });

  it("once a Live run is over, says how it ended in the objective line, with the way to the debrief beside it", () => {
    const caught: RunState = { ...play(start(), [move("fl-lobby")]), status: "caught" };
    const closed = shown(layout(caught, { mode: "live" }));
    expect(closed).toMatch(/data-testid="objective-label" class="text-danger">Caught</);
    expect(closed).toMatch(/data-testid="live-end"[^>]*><button type="button">See the debrief</);
    // One way to the debrief and one Restart on the screen, whichever way Details is.
    expect(closed.match(/See the debrief/g)).toHaveLength(1);
    expect(closed).toContain('data-testid="live-restart"');
    const open = shown(layout(caught, { mode: "live", details: true }));
    expect(open).not.toContain('data-testid="live-end"');
    expect(open.match(/See the debrief/g)).toHaveLength(1);
    // A run still on has no end to show.
    expect(layout(play(start(), [move("fl-lobby")]), { mode: "live" })).not.toContain('data-testid="live-end"');
  });

  it("offers Restart in the HUD once there is a turn to start over", () => {
    const run = play(start(), [move("fl-lobby")]);
    const restart = (markup: string) => shown(markup).match(/<button[^>]*data-testid="live-restart"[^>]*>/)?.[0] ?? "";
    expect(restart(layout(run, { mode: "live" }))).not.toBe("");
    expect(restart(layout(run, { mode: "live" }))).not.toContain(`disabled=""`);
    expect(restart(layout(start(), { mode: "live", canRestart: false }))).toContain('disabled=""');
  });

  it("holds the HUD's place with a skeleton while the board is set up, and is Tactical's screen when no board is coming", () => {
    const run = start();
    const loading = shown(layout(run, { mode: "live", hud: null, loading: true }));
    expect(loading).toContain('data-testid="hud-skeleton"');
    expect(loading).toContain(DETAILS);
    for (const part of [...HUD, ...PANELS]) expect(loading).not.toContain(part);
    // No floor, or an error: nothing to show a HUD for, so the board's message keeps its bar and its panel.
    const none = layout(run, { mode: "live", hud: null, loading: false });
    expect(none).toBe(layout(run, { mode: "tactical" }));
  });
});

describe("the HUD on the Run screen", () => {
  function Probe({ live, run, status = "" }: { live: boolean; run: RunState | null; status?: string }) {
    const hud = usePlayHud({
      live,
      placed,
      run,
      mission,
      crewPlan: null,
      chief: IDLE,
      revealed: { words: 0, rows: 0, done: false },
      status,
    });
    return <pre>{JSON.stringify(hud)}</pre>;
  }
  const read = (node: ReactNode): PlayHud | null =>
    JSON.parse(renderToStaticMarkup(node).replace(/^<pre>|<\/pre>$/g, "").replace(/&quot;/g, '"').replace(/&#x27;/g, "'"));

  it("is nothing in Tactical, and nothing without a run", () => {
    expect(read(<Probe live={false} run={start()} />)).toBeNull();
    expect(read(<Probe live run={null} />)).toBeNull();
  });

  it("in Live reads the objective, the alarm and the crew's line off the run", () => {
    const hud = read(<Probe live run={start()} />)!;
    expect(hud.objective).toMatchObject({ label: "Objective", goal: mission.objective, hops: 6, locks: 1 });
    expect(hud.danger).toEqual({ alarm: "calm", watchers: [] });
    expect(hud.radio).toEqual({ kind: "step", text: "You're in at the loading dock. Pick a number to move." });
    // The status line's opening words are the crew's own first line: said once, as the step.
    const opening = "You're in at the loading dock. Pick a number to move.";
    expect(read(<Probe live run={start()} status={opening} />)!.radio).toEqual({ kind: "step", text: opening });
    // Any other notice on a fresh run stands in for the step.
    const back = "Back at the start. The guards are on their rounds.";
    expect(read(<Probe live run={start()} status={back} />)!.radio).toEqual({ kind: "note", text: back });
  });

  it("puts the status line's notices on the radio, and leaves its account of the turn to the board", () => {
    const before = start();
    const after = play(before, [move("fl-lobby")]);
    const told = describeTurn(placed, before, after);
    expect(told).toBe("You move to the Freight Lift Lobby.");
    expect(noticeOf(placed, before, after, told)).toBeNull();
    expect(noticeOf(placed, before, after, "")).toBeNull();
    for (const notice of ["Nowhere to sprint from here: nothing is two open hops away.", "Not possible: the door is locked.", "Walking again. Pick a number to move."]) {
      expect(noticeOf(placed, before, after, notice)).toBe(notice);
    }
    // A fresh run has no last turn: whatever the status line says is a notice.
    expect(noticeOf(placed, null, before, "Back at the start. The guards are on their rounds.")).toBe("Back at the start. The guards are on their rounds.");
  });
});
