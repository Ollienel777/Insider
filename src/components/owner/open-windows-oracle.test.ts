// Open windows against the engine (issue 144 review): for every way in and
// every start turn, `openWindows` must say open exactly when a forward search
// that plays only the engine's own `act`, from a fresh run with the guards
// stepped to that absolute turn, finds a way in, the take and a way out with
// the alarm never leaving calm. Nothing here reads the measure's own tables,
// so a night that is looped from the wrong state (turn 0 instead of turn C:
// a guard starts facing its first hop and comes back facing the other way)
// shows up as a disagreement. The floors have no night cleaners, which the
// measure leaves out, so "calm" is exactly "never seen or heard".
import { describe, expect, it } from "vitest";
import type { FloorGraph } from "@/domain";
import { act, compileBoard, createRun, moveGuards, type Action, type Level, type RunState } from "@/engine";
import { cycleLength } from "./night";
import { openWindows } from "./open-windows";

/** Whether a crew stepping in on `entry` at absolute turn `turn` can take the objective and get out, never seen or heard, within `maxTurns` actions. */
function engineOpen(lvl: Level, entry: string, turn: number, maxTurns: number): boolean {
  const start = createRun({ ...lvl, start: entry });
  let guards = start.guards;
  for (let t = 0; t < turn; t++) guards = moveGuards(start.board, guards);
  const { board } = start;
  let frontier: RunState[] = [{ ...start, guards, turn }];
  for (let depth = 0; depth < maxTurns && frontier.length > 0; depth++) {
    const next = new Map<string, RunState>();
    for (const run of frontier) {
      const here = run.playerNode;
      const exits = board.adjacency.get(here) ?? [];
      const actions: Action[] = [{ kind: "wait" }, { kind: "take" }];
      for (const e of exits) {
        actions.push({ kind: "move", to: e.to });
        if (e.doorId !== undefined) actions.push({ kind: "pick", doorId: e.doorId });
        for (const f of board.adjacency.get(e.to) ?? []) actions.push({ kind: "sprint", to: f.to, via: e.to });
      }
      for (const action of actions) {
        const r = act(run, action);
        if (!r.ok || r.run.alarm !== "calm") continue;
        if (r.run.status === "won") return true;
        if (r.run.status !== "playing") continue;
        const s = r.run;
        next.set(`${s.playerNode}|${s.carrying}|${s.locked.join(",")}|${s.picking?.doorId}:${s.picking?.progress}`, s);
      }
    }
    frontier = [...next.values()];
  }
  return false;
}

/** For each way in, the start turns the engine finds open, as a string of 0/1 by turn of the night. */
function engineTurns(lvl: Level, entries: readonly string[], maxTurns: number): Record<string, string> {
  const C = cycleLength(compileBoard(lvl));
  return Object.fromEntries(
    entries.map((e) => [e, Array.from({ length: C }, (_, t) => (engineOpen(lvl, e, t, maxTurns) ? "1" : "0")).join("")]),
  );
}

/** Plays a window's actions with the engine from its absolute start turn; true when it gets out with the alarm still calm. */
function playsClean(lvl: Level, entry: string, turn: number, actions: readonly Action[]): boolean {
  const start = createRun({ ...lvl, start: entry });
  let guards = start.guards;
  for (let t = 0; t < turn; t++) guards = moveGuards(start.board, guards);
  let run: RunState = { ...start, guards, turn };
  for (const action of actions) {
    const r = act(run, action);
    if (!r.ok || r.run.alarm !== "calm") return false;
    run = r.run;
  }
  return run.status === "won";
}

/**
 * `openWindows`, one way in at a time, read as the engine's bit string can be:
 * the count of open start turns, the first one, and whether that first
 * window's own actions play out clean through `act`.
 */
function measureWay(lvl: Level, entry: string, maxTurns: number): { open: number; first: number; replays: boolean } {
  const w = openWindows(lvl, [entry], maxTurns);
  return {
    open: w.open,
    first: w.first ? w.first.turn : -1,
    replays: w.first ? playsClean(lvl, entry, w.first.turn, w.first.actions) : true,
  };
}

const ones = (bits: string) => [...bits].filter((b) => b === "1").length;

/** A small deterministic generator (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KINDS = ["analog-sweep", "ptz", "fixed-ip", "ip-analytics"] as const;

/** A random small floor with guards, cameras, doors and hearing, whose night is at most 12 turns; null when the draw does not fit. */
function randomLevel(seed: number): { level: Level; entries: string[] } | null {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const N = 4 + Math.floor(r() * 4);
  const ids = Array.from({ length: N }, (_, i) => `n${i}`);
  const edges: { a: string; b: string; door?: { id: string; lockable: boolean } }[] = [];
  const has = new Set<string>();
  const addEdge = (a: string, b: string) => {
    const key = [a, b].sort().join("-");
    if (a === b || has.has(key)) return;
    has.add(key);
    const door = r() < 0.3 ? { id: `d${edges.length}`, lockable: true } : undefined;
    edges.push({ a, b, ...(door && { door }) });
  };
  for (let i = 1; i < N; i++) addEdge(ids[i], ids[Math.floor(r() * i)]);
  for (let k = Math.floor(r() * 3); k > 0; k--) addEdge(pick(ids), pick(ids));
  const sightlines = Object.fromEntries(ids.map((id) => [id, ids.filter((o) => o !== id && r() < 0.35)]));
  const floor: FloorGraph = {
    nodes: ids.map((id) => ({ id, x: Math.floor(r() * 5), y: Math.floor(r() * 5), roomId: "hall", tags: [] })),
    edges,
    rooms: [{ id: "hall", label: "Hall", rect: { x: 0, y: 0, w: 5, h: 5 } }],
    sightlines,
    source: "fixture",
  };
  const doors = edges.flatMap((e) => (e.door ? [e.door.id] : []));
  const lockedDoors = doors.filter(() => r() < 0.5).slice(0, 2);
  const guards = Array.from({ length: Math.floor(r() * 3) }, (_, g) => ({
    id: `G${g}`,
    patrol: Array.from({ length: 1 + Math.floor(r() * 3) }, () => pick(ids)),
  }));
  const guardTempo = Object.fromEntries(guards.filter(() => r() < 0.4).map((g) => [g.id, 1 + Math.floor(r() * 3)]));
  const cameras = Array.from({ length: Math.floor(r() * 3) }, (_, c) => ({
    id: `C${c}`,
    kind: pick(KINDS),
    cover: ids.filter(() => r() < 0.3).slice(0, 3),
    phase: Math.floor(r() * 3),
  })).filter((c) => c.cover.length > 0);
  const entries = [...new Set([pick(ids), pick(ids)])].slice(0, 1 + Math.floor(r() * 2));
  const objective = pick(ids.filter((id) => !entries.includes(id)));
  const level: Level = {
    buildingId: "T",
    missionId: "t",
    seed,
    floor,
    start: entries[0],
    objective,
    exits: entries,
    lockedDoors,
    pickTurns: 1 + Math.floor(r() * 2),
    patrolTempo: 1 + Math.floor(r() * 2),
    guards,
    guardTempo,
    cameras,
    hearing: Math.floor(r() * 3),
  };
  try {
    if (cycleLength(compileBoard(level)) > 12) return null;
  } catch {
    return null;
  }
  return { level, entries };
}

/**
 * Every way in and start turn on one level: per way in, the measure's count
 * equals the engine's, its first window is the engine's first open turn, and
 * that window replays clean.
 */
function agree(level: Level, entries: readonly string[], maxTurns: number) {
  const engine = engineTurns(level, entries, maxTurns);
  const measured = Object.fromEntries(entries.map((e) => [e, measureWay(level, e, maxTurns)]));
  const same = entries.every((e) => {
    const m = measured[e];
    return m.open === ones(engine[e]) && m.first === engine[e].indexOf("1") && m.replays;
  });
  return { engine, measured, same };
}

/**
 * The reviewer's seed 591, as dumped: G0 walks n0↔n1 at tempo 1 with a
 * sightline n0→n4. At turn 0 it faces n1 (its first hop), so n4 is behind it;
 * from turn 2 on it stands on n0 facing back and sees n4 on every even turn.
 */
const seed591: Level = {
  buildingId: "T",
  missionId: "t",
  seed: 591,
  floor: {
    nodes: [
      { id: "n0", x: 2, y: 3, roomId: "hall", tags: [] },
      { id: "n1", x: 4, y: 2, roomId: "hall", tags: [] },
      { id: "n2", x: 1, y: 4, roomId: "hall", tags: [] },
      { id: "n3", x: 3, y: 4, roomId: "hall", tags: [] },
      { id: "n4", x: 1, y: 4, roomId: "hall", tags: [] },
    ],
    edges: [
      { a: "n1", b: "n0" },
      { a: "n2", b: "n0" },
      { a: "n3", b: "n1" },
      { a: "n4", b: "n3" },
    ],
    rooms: [{ id: "hall", label: "Hall", rect: { x: 0, y: 0, w: 5, h: 5 } }],
    sightlines: { n0: ["n1", "n4"], n1: ["n2"], n2: [], n3: [], n4: ["n2", "n3"] },
    source: "fixture",
  },
  start: "n4",
  objective: "n3",
  exits: ["n4", "n0"],
  lockedDoors: [],
  pickTurns: 2,
  patrolTempo: 1,
  guards: [{ id: "G0", patrol: ["n0", "n1"] }],
  cameras: [
    { id: "C0", kind: "analog-sweep", cover: ["n1", "n4"] },
    { id: "C1", kind: "ptz", cover: ["n0", "n4"] },
  ],
  hearing: 2,
};


/**
 * A window that crosses the end of the night, built by hand. n0 is the way in,
 * the files are on n3 beside it, and G1 walks n1↔n2 at tempo 1 (a 2-turn night)
 * with a sightline from n1 back to n0. On turn 0 G1 stands on n1 facing its
 * first hop, n2, so n0 is behind it; from turn 2 on it comes back to n1 facing
 * n0 and sees it on every even turn. With three turns (in to n3, take, back to
 * n0) a crew stepping in on turn 0 is back on n0 on turn 2 = C and is seen; one
 * stepping in on turn 1 is back on turn 3, when G1 is on n2. Read against turn
 * 0 instead of turn 2, the first would look open.
 */
const wrapCase: Level = {
  buildingId: "T",
  missionId: "t",
  seed: 1,
  floor: {
    nodes: [
      { id: "n0", x: 0, y: 0, roomId: "hall", tags: [] },
      { id: "n1", x: 1, y: 0, roomId: "hall", tags: [] },
      { id: "n2", x: 2, y: 0, roomId: "hall", tags: [] },
      { id: "n3", x: 0, y: 1, roomId: "hall", tags: [] },
    ],
    edges: [
      { a: "n0", b: "n1" },
      { a: "n1", b: "n2" },
      { a: "n0", b: "n3" },
    ],
    rooms: [{ id: "hall", label: "Hall", rect: { x: 0, y: 0, w: 3, h: 2 } }],
    sightlines: { n1: ["n0"] },
    source: "fixture",
  },
  start: "n0",
  objective: "n3",
  exits: ["n0"],
  lockedDoors: [],
  pickTurns: 2,
  patrolTempo: 1,
  guards: [{ id: "G1", patrol: ["n1", "n2"] }],
  hearing: 0,
};

describe("open windows agree with the engine on every way in and start turn", () => {
  it("seed 591 (the review's first counter-example): a way in seen from turn 2 on is open on no turn", () => {
    const { engine, measured, same } = agree(seed591, ["n4", "n0"], 30);
    expect(engine).toEqual({ n4: "000000", n0: "000000" });
    expect(measured.n4.open).toBe(0);
    expect(same).toBe(true);
  });

  it("a window that runs past the end of the night meets the guards as they are on that turn", () => {
    const { engine, measured, same } = agree(wrapCase, ["n0"], 3);
    expect(engine).toEqual({ n0: "01" });
    expect(measured.n0).toEqual({ open: 1, first: 1, replays: true });
    expect(same).toBe(true);
    // Given the time to wait out G1, every turn is open.
    expect(agree(wrapCase, ["n0"], 12)).toMatchObject({ engine: { n0: "11" }, same: true });
  });

  it("this generator's seed 182, an undercount like the review's seed 1184: the engine gets out from turn 0 on", () => {
    const drawn = randomLevel(182)!;
    const way = drawn.entries[0];
    const { engine, measured, same } = agree(drawn.level, drawn.entries, 24);
    expect(engine[way]).toMatch(/^1/);
    expect(measured[way].open).toBe(ones(engine[way]));
    expect(same).toBe(true);
  });

  // Seeded random small floors, in groups that each stay well inside the default timeout.
  for (let from = 1; from < 1201; from += 200) {
    it(`random floors, seeds ${from}–${from + 199}`, () => {
      const wrong: string[] = [];
      let cases = 0;
      for (let seed = from; seed < from + 200; seed++) {
        const drawn = randomLevel(seed);
        if (!drawn) continue;
        const { engine, measured, same } = agree(drawn.level, drawn.entries, 24);
        cases += Object.values(engine).reduce((n, bits) => n + bits.length, 0);
        if (!same) wrong.push(`seed ${seed}: engine ${JSON.stringify(engine)}, measure ${JSON.stringify(measured)}`);
      }
      expect(cases).toBeGreaterThan(400);
      expect(wrong).toEqual([]);
    });
  }
});
