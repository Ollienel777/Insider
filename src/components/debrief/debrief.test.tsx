// The Debrief (#22) on the cached F1 level placed on the F1 fixture floor, as
// the Run screen places it: every figure and line is read off a log the
// engine wrote for a run played here.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { F1_DEMO, FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { replanChief } from "@/agents/chief";
import { LevelManifest, RunLog } from "@/domain";
import { act, applyChiefOrders, createRun, toRunLog, type Action, type RunState } from "@/engine";
import { placeLevel, quietRoute } from "@/level/placer";
import { chiefRequest, chiefZones, toEngineOrders } from "@/components/run/chief-request";
import { clearRunLog, loadRunLog, runLogKey, runLogOf, saveRunLog } from "@/components/run/run-log-store";
import { RUN_SEED } from "@/components/run/run-screen";
import cached from "../../../data/levels/F1.json";
import { debriefOf, LATE_NOTE, notStarted, parOf, UnreadableLog, type Debrief } from "./debrief";
import { ReplayBoard } from "./replay-board";

const manifest = LevelManifest.parse(structuredClone(cached));
const placed = placeLevel(manifest, structuredClone(FIXTURE_FLOORS.F1), RUN_SEED);
const PAR = parOf(placed);

function play(run: RunState, actions: readonly Action[]): RunState {
  return actions.reduce((state, action, i) => {
    const result = act(state, action);
    if (!result.ok) throw new Error(`action ${i} (${JSON.stringify(action)}) refused: ${result.reason}`);
    return result.run;
  }, run);
}
const wait: Action = { kind: "wait" };

beforeEach(() => {
  vi.stubEnv("HEIST_MODE", "fake");
  vi.stubEnv("LLM_MODE", "fake");
});
afterEach(() => vi.unstubAllEnvs());

/** The quiet route, played to a clean exit: the engine's own shortest route that nobody sees. */
function quietWin(): RunLog {
  const route = quietRoute(placed)!;
  const run = play(createRun(placed.level), route);
  expect(run.status).toBe("won");
  return RunLog.parse(toRunLog(run));
}

/**
 * Beat 5 as the Run screen plays it: into C2's cover, the Chief's recorded
 * re-plan applied between turns (logged on the next turn, with its source),
 * then waiting until the guards close in. C2's second sighting (Lockdown)
 * lands on the catching turn, so its answer arrives after the run ended: the
 * Run screen shows it, and the log keeps it as late (R1-C1).
 */
async function caughtAtTheWowBeat(): Promise<{ log: RunLog; answers: number }> {
  const zones = chiefZones(placed);
  const sources = new Map<number, "model" | "recorded" | "template">();
  let answers = 0;
  let run = play(createRun(placed.level), [{ kind: "move", to: F1_DEMO.freightLiftWait }, { kind: "move", to: "dc-west" }]);
  let event = run.alarmEvents[run.alarmEvents.length - 1];
  const answer = (await replanChief(chiefRequest("F1", placed, zones, run, event)))!;
  answers++;
  expect(answer.source).toBe("recorded");
  run = applyChiefOrders(run, toEngineOrders(answer.orders, zones)).run;
  sources.set(run.turn, answer.source);
  for (let i = 0; i < 12 && run.status === "playing"; i++) {
    const before = run.alarmEvents.length;
    run = play(run, [wait]);
    // The demo's later sighting is on the catching turn, never on a turn the run goes on after.
    expect(run.alarmEvents.length > before && run.status === "playing").toBe(false);
  }
  expect(run.status).toBe("caught");
  event = run.alarmEvents[run.alarmEvents.length - 1];
  expect(event.turn).toBe(run.turn - 1);
  expect(event.to).toBe("lockdown");
  const late = (await replanChief(chiefRequest("F1", placed, zones, run, event)))!;
  answers++;
  const log = runLogOf(run, sources, { turn: run.turn, chief: toEngineOrders(late.orders, zones), chiefSource: late.source });
  return { log: RunLog.parse(log), answers };
}

describe("par", () => {
  it("is the engine's quiet route on F1: 17 turns", () => {
    expect(PAR).toBe(17);
  });
});

describe("a quiet-route win", () => {
  const log = quietWin();
  const debrief = debriefOf(placed, log, PAR);

  it("states the clean exit and how: through the entry it came in by, never seen", () => {
    expect(debrief.outcome).toBe("won");
    expect(debrief.headline).toBe("Out with the files.");
    const exit = placed.entries.find((e) => e.nodeId === placed.level.start)!.label.toLowerCase();
    expect(debrief.detail).toBe(`Out through the ${exit} in 17 turns, never seen.`);
  });

  it("grades S: never seen, never sprinted, on par", () => {
    expect(debrief.grade).toBe("S");
    expect(debrief.gradeReason).toBe("Never seen, and on par: 17 turns.");
  });

  it("counts turns, noise and detections from the log", () => {
    expect(debrief.stats).toEqual({ turns: 17, par: 17, noise: 2, picks: 2, sprints: 0, detections: 0, peak: "calm" });
  });

  it("says the Chief never re-planned, because the alarm never moved", () => {
    expect(debrief.decisions).toEqual([]);
    expect(debrief.noDecisions).toBe("The alarm never moved, so the Chief never re-planned.");
  });

  it("has a frame per turn after the start, each with the log's positions", () => {
    expect(debrief.frames).toHaveLength(18);
    expect(debrief.frames[0].player).toBe(placed.level.start);
    expect(debrief.frames[0].guards.map((g) => g.nodeId)).toEqual(placed.level.guards.map((g) => g.patrol[0]));
    log.turns.forEach((t, i) => {
      expect(debrief.frames[i + 1].player).toBe(t.player.nodeId);
      expect(debrief.frames[i + 1].guards).toEqual(t.guards);
      expect(debrief.frames[i + 1].alarm).toBe(t.alarm);
    });
    expect(debrief.frames.at(-1)!.carrying).toBe(true);
  });
});

describe("caught at the wow beat", () => {
  let log: RunLog;
  let answers: number;
  let debrief: Debrief;
  beforeEach(async () => {
    ({ log, answers } = await caughtAtTheWowBeat());
    debrief = debriefOf(placed, log, PAR);
  });

  it("states the outcome, what tripped the alarm, and who caught the player", () => {
    const last = log.turns.at(-1)!;
    const by = last.guards.filter((g) => g.nodeId === last.player.nodeId).map((g) => g.guardId);
    expect(by.length).toBeGreaterThan(0);
    expect(debrief.outcome).toBe("caught");
    expect(debrief.grade).toBe("D");
    expect(debrief.gradeReason).toBe("A caught run grades D, whatever came before.");
    expect(debrief.headline).toMatch(/^Caught in the .+\.$/);
    expect(debrief.detail).toContain("C2 saw you in the Dock Corridor on turn 2.");
    expect(debrief.detail).toContain(`reached you on turn ${log.turns.length}.`);
    for (const id of by) expect(debrief.detail).toContain(id);
  });

  it("counts the camera's sighting as a detection, at a peak of Alert or above", () => {
    expect(debrief.stats.detections).toBe(log.alarmEvents!.filter((e) => e.cause.kind !== "decay").length);
    expect(debrief.stats.detections).toBeGreaterThanOrEqual(1);
    expect(["alert", "lockdown"]).toContain(debrief.stats.peak);
    expect(debrief.stats.turns).toBe(log.turns.length);
  });

  it("lists the Chief's decision with its turn, rationale, orders and source", () => {
    const logged = log.turns.find((t) => t.chief)!;
    const [decision] = debrief.decisions;
    expect(decision.turn).toBe(2);
    expect(decision.turn).toBe(logged.turn);
    expect(decision.rationale).toBe(logged.chief!.rationale);
    expect(decision.orders.map((o) => o.guardId)).toEqual(logged.chief!.orders.map((o) => o.guardId));
    expect(decision.locks).toEqual(["Records room"]);
    expect(decision.source).toBe("recorded");
    expect(decision.late).toBe(false);
  });

  it("lists every answer the Run screen showed, the Lockdown re-plan as late, on the last frame", () => {
    expect(debrief.decisions).toHaveLength(answers);
    expect(debrief.decisions.map((d) => d.late)).toEqual([false, true]);
    const late = debrief.decisions[1];
    expect(late.turn).toBe(log.turns.length);
    expect(late.rationale).toBe(log.lateChief!.chief.rationale);
    expect(late.rationale).toMatch(/^Second contact, dock corridor\. Lockdown\./);
    expect(late.source).toBe("recorded");
    expect(late.orders.length + late.locks.length).toBeGreaterThan(0);
    expect(LATE_NOTE).toBe("Arrived after the run ended. None of these orders reached the guards.");
  });

  it("rejects a late decision that is not on the last frame of a finished run", () => {
    const off = { ...log, lateChief: { ...log.lateChief!, turn: 2 } };
    expect(() => debriefOf(placed, off, PAR)).toThrow(UnreadableLog);
    expect(() => debriefOf(placed, { ...log, status: "playing" }, PAR)).toThrow(UnreadableLog);
  });

  it("says no orders reached the guards when the alarm moved but no answer ever came", () => {
    const silent: RunLog = {
      ...log,
      lateChief: undefined,
      turns: log.turns.map((t) => ({ turn: t.turn, player: t.player, guards: t.guards, alarm: t.alarm })),
    };
    const d = debriefOf(placed, silent, PAR);
    expect(d.decisions).toEqual([]);
    expect(d.noDecisions).toBe("No orders reached the guards before the run ended.");
  });

  it("rejects a pending decision on a finished run, or off the last frame", () => {
    const pending = { turn: log.turns.length, chief: log.lateChief!.chief, chiefSource: "recorded" as const };
    expect(() => debriefOf(placed, { ...log, lateChief: undefined, pendingChief: pending }, PAR)).toThrow(UnreadableLog);
    const playing = { ...log, status: "playing" as const, lateChief: undefined };
    expect(() => debriefOf(placed, { ...playing, pendingChief: { ...pending, turn: 2 } }, PAR)).toThrow(UnreadableLog);
  });

  it("lights C2's lens on the frame its sighting raised the alarm", () => {
    expect(debrief.frames[2].tripped).toBe("C2");
    expect(debrief.frames[1].tripped).toBeNull();
    // Every frame with a lit lens is one a sighting raised the alarm on.
    for (const f of debrief.frames.filter((x) => x.tripped)) {
      expect(log.alarmEvents!.some((e) => e.turn === f.turn - 1 && e.cause.id === f.tripped)).toBe(true);
    }
  });
});

/**
 * Opened from the step rail mid-run (R3-C1): the wow beat to the Chief's first
 * answer, applied to the guards, as the Run screen saves it then.
 */
describe("a run still being played, after the Chief's first answer", () => {
  const zones = chiefZones(placed);
  let run: RunState;
  let sources: Map<number, "model" | "recorded" | "template">;
  let log: RunLog;
  let debrief: Debrief;
  beforeEach(async () => {
    run = play(createRun(placed.level), [{ kind: "move", to: F1_DEMO.freightLiftWait }, { kind: "move", to: "dc-west" }]);
    const answer = (await replanChief(chiefRequest("F1", placed, zones, run, run.alarmEvents.at(-1)!)))!;
    run = applyChiefOrders(run, toEngineOrders(answer.orders, zones)).run;
    sources = new Map([[run.turn, answer.source]]);
    log = RunLog.parse(runLogOf(run, sources));
    debrief = debriefOf(placed, log, PAR);
  });

  it("saves the applied orders as pending, on the frame they were given", () => {
    expect(log.status).toBe("playing");
    expect(log.turns.some((t) => t.chief)).toBe(false);
    expect(log.pendingChief).toEqual({ turn: 2, chief: run.chief, chiefSource: "recorded" });
  });

  it("lists the decision the guards are acting on, and claims no end and no grade", () => {
    expect(debrief.outcome).toBe("playing");
    expect(debrief.grade).toBeNull();
    expect(debrief.decisions).toHaveLength(1);
    const [decision] = debrief.decisions;
    expect(decision).toMatchObject({ turn: 2, rationale: run.chief!.rationale, source: "recorded", late: false });
    expect(decision.locks).toEqual(["Records room"]);
    for (const line of [debrief.headline, debrief.detail, debrief.gradeReason, debrief.noDecisions]) {
      expect(line).not.toMatch(/ended|never/);
    }
  });

  it("moves the decision onto the next turn's entry once the player moves, on the same frame", () => {
    const next = RunLog.parse(runLogOf(play(run, [wait]), sources));
    expect(next.pendingChief).toBeUndefined();
    expect(next.turns[2]).toMatchObject({ turn: 2, chief: run.chief, chiefSource: "recorded" });
    expect(debriefOf(placed, next, PAR).decisions).toEqual(debrief.decisions);
  });

  it("says the Chief hasn't answered yet while the call is out, and nothing about an end", () => {
    const asked = { ...log, pendingChief: undefined };
    const d = debriefOf(placed, asked, PAR);
    expect(d.decisions).toEqual([]);
    expect(d.noDecisions).toBe("The Chief hadn't answered when you left the run.");
    const calm = RunLog.parse(toRunLog(play(createRun(placed.level), quietRoute(placed)!.slice(0, 3))));
    expect(debriefOf(placed, calm, PAR).noDecisions).toBe("The alarm hasn't moved yet, so the Chief hasn't re-planned.");
  });
});

describe("the grade", () => {
  const won = quietWin();
  const grade = (log: RunLog) => {
    const d = debriefOf(placed, log, PAR);
    return [d.grade, d.gradeReason];
  };

  it("drops to A over par, to B for a detection at Suspicious, to C after Alert", () => {
    expect(grade(won)).toEqual(["S", "Never seen, and on par: 17 turns."]);
    expect(debriefOf(placed, won, 15).grade).toBe("A");
    expect(debriefOf(placed, won, 15).gradeReason).toBe("Never seen, 2 turns over par.");
    const heard = { turn: 5, from: "calm", to: "suspicious", lastKnownZone: "dock-corridor", cause: { kind: "noise", id: "G1" } } as const;
    expect(grade({ ...won, alarmEvents: [heard] })).toEqual(["B", "Out, but the alarm reached Suspicious."]);
    const seen = { ...heard, to: "alert", cause: { kind: "camera", id: "C2" } } as const;
    expect(grade({ ...won, alarmEvents: [seen] })).toEqual(["C", "Out, but the alarm reached Alert."]);
  });

  it("does not count the alarm decaying as a detection (R3-N1)", () => {
    const seen = { turn: 5, from: "calm", to: "alert", lastKnownZone: "dock-corridor", cause: { kind: "camera", id: "C2" } } as const;
    const decay = { turn: 9, from: "alert", to: "suspicious", lastKnownZone: null, cause: { kind: "decay" } } as const;
    expect(debriefOf(placed, { ...won, alarmEvents: [seen, decay] }, PAR).stats.detections).toBe(1);
  });

  it("drops to A for a sprint", () => {
    const turns = won.turns.map((t, i) => (i === 3 ? { ...t, player: { ...t.player, kind: "sprint" as const } } : t));
    expect(grade({ ...won, turns })).toEqual(["A", "Never seen, but you sprinted 1 time."]);
  });

  it("is withheld while the run is still being played", () => {
    const run = play(createRun(placed.level), quietRoute(placed)!.slice(0, 3));
    const d = debriefOf(placed, RunLog.parse(toRunLog(run)), PAR);
    expect(d.outcome).toBe("playing");
    expect(d.grade).toBeNull();
    expect(d.headline).toBe("Still on the floor.");
    expect(d.detail).toBe("3 turns played so far.");
  });
});

describe("a log the Debrief cannot read", () => {
  const won = quietWin();
  it("is one written before the Debrief existed", () => {
    const old = { ...won, status: undefined, alarmEvents: undefined };
    expect(() => debriefOf(placed, old, PAR)).toThrow(UnreadableLog);
  });
  it("is one for another mission or a node this floor does not have", () => {
    expect(() => debriefOf(placed, { ...won, missionId: "sunset-1986" }, PAR)).toThrow(UnreadableLog);
    const turns = won.turns.map((t, i) => (i === 0 ? { ...t, player: { ...t.player, nodeId: "nowhere" } } : t));
    expect(() => debriefOf(placed, { ...won, turns }, PAR)).toThrow(UnreadableLog);
  });
});

describe("the run log in storage", () => {
  const store = () => {
    const map = new Map<string, string>();
    return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), map };
  };
  it("round-trips under the Run screen's key", () => {
    const storage = store();
    const log = quietWin();
    saveRunLog(log, storage);
    expect([...storage.map.keys()]).toEqual([runLogKey("F1")]);
    expect(loadRunLog("F1", storage)).toEqual(log);
  });
  it("does nothing, and reads nothing, when storage is blocked or full", () => {
    const own = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
    try {
      expect(() => saveRunLog(quietWin())).not.toThrow();
      expect(loadRunLog("F1")).toBeNull();
    } finally {
      if (own) Object.defineProperty(globalThis, "localStorage", own);
      else delete (globalThis as { localStorage?: Storage }).localStorage;
    }
    const refusing = {
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
      getItem: () => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    };
    expect(() => saveRunLog(quietWin(), refusing)).not.toThrow();
    expect(loadRunLog("F1", refusing)).toBeNull();
  });
  it("holds a fresh run's empty log in place of the last run's, and is cleared when the board has no run", () => {
    const storage = store();
    saveRunLog(quietWin(), storage);
    // A new run (opening the Run screen, or Restart) writes its own log at once.
    saveRunLog(runLogOf(createRun(placed.level), new Map()), storage);
    const fresh = loadRunLog("F1", storage)!;
    expect(fresh).toEqual({ buildingId: "F1", missionId: placed.level.missionId, seed: RUN_SEED, turns: [], status: "playing", alarmEvents: [] });
    expect(notStarted(fresh)).toBe(true);
    clearRunLog("F1", { removeItem: (k: string) => void storage.map.delete(k) });
    expect(loadRunLog("F1", storage)).toBeNull();
    expect(() => clearRunLog("F1", { removeItem: () => { throw new DOMException("x", "SecurityError"); } })).not.toThrow();
  });
  it("counts a run as started from its first turn, and a finished run always", () => {
    expect(notStarted(RunLog.parse(toRunLog(play(createRun(placed.level), [wait]))))).toBe(false);
    expect(notStarted(quietWin())).toBe(false);
  });
  it("reads nothing for an empty, garbled or other building's entry", () => {
    const storage = store();
    expect(loadRunLog("F1", storage)).toBeNull();
    storage.setItem(runLogKey("F1"), "{not json");
    expect(loadRunLog("F1", storage)).toBeNull();
    storage.setItem(runLogKey("F1"), JSON.stringify({ ...quietWin(), buildingId: "F2" }));
    expect(loadRunLog("F1", storage)).toBeNull();
  });
});

describe("the replay board", () => {
  it("stands every piece where the log puts it on the frame shown, with paths up to it", async () => {
    const { log } = await caughtAtTheWowBeat();
    const debrief = debriefOf(placed, log, PAR);
    for (const frame of [0, 3, debrief.frames.length - 1]) {
      const html = renderToStaticMarkup(
        <ReplayBoard placed={placed} frames={debrief.frames} frame={frame} caught />,
      );
      const f = debrief.frames[frame];
      expect(html).toContain(`data-frame="${frame}"`);
      expect(html).toMatch(new RegExp(`data-testid="player-piece" data-node="${f.player}"`));
      for (const g of f.guards) {
        expect(html).toMatch(new RegExp(`data-testid="guard-piece" data-node="${g.nodeId}" data-id="${g.guardId}"`));
      }
      if (frame === 0) expect(html).not.toContain('data-testid="player-path"');
      else expect(html).toContain('data-testid="player-path"');
    }
  });
});
