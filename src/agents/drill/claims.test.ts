// Every figure and claim in a recorded narrative, checked against the facts
// the simulation gives for its floor. A recording that matches its facts
// (narrator.test.ts) can still say something they do not support: that a room
// must be turned toward a stair it already uses, or that one node's queue is a
// whole room's. These tests read each sentence and fail on any number they
// cannot tie to a fact of what the sentence names, and on any claim the facts
// contradict. A queue is booked to the room people wait to get into or along
// (src/drill/simulate.ts, `Bottleneck`), so a sentence may not put the queue
// "in" the room, and a sum of everyone's waits is person-seconds, never seconds.
// The most one person waited is their waits added together, so it is never
// "the longest wait". A warden post is one door of a room, and reaches only
// the people who leave by it.
//
// On top of those rules, a ledger ties every number in each recording to the
// simulation field it states: a number the ledger does not name, or that no
// longer equals its field, fails.
import { describe, expect, it } from "vitest";
import { FIXTURE_BUILDINGS } from "@/adapters/costar/fake";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import type { DrillReport as DrillNarrative } from "@/domain";
import { drillFacts, simulateDrill, type DrillFacts, type DrillFloorChoice } from "@/drill";
import { loadDrillRecording } from "./index";

const F1 = FIXTURE_BUILDINGS.find((b) => b.id === "F1")!;
const FLOOR = FIXTURE_FLOORS.F1;

function factsFor(floor: DrillFloorChoice): DrillFacts {
  const report = simulateDrill(F1, FLOOR, { floor });
  const baseline = simulateDrill(F1, FLOOR, { floor, blockedStair: null });
  return drillFacts(report, baseline, FLOOR);
}

/** Spelled-out amounts, which would slip past the number check. */
const NUMBER_WORDS =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|fifty|hundred|single|dozen|half|double|twice|both|nobody|no one|none)\b/i;
const QUEUE_WORDS = /\b(queue|queues|queued|queueing|wait|waits|waited|waiting|choke|bottleneck|deep|crowd|crowds|crowded)\b/i;
const QUEUE_VERB = "(?:queue|queues|queued|queueing|wait|waits|waited|waiting|stand|stands|standing|crowd|crowds|crowded)";
const NUMBER = /\d{1,3}(?:,\d{3})+(?!\d)|\d+(?:\.\d+)?/g;
const num = (text: string) => Number(text.replace(/,/g, ""));
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What in `narrative` the facts do not support; empty when every figure and claim holds. */
function unsupportedClaims(facts: DrillFacts, narrative: DrillNarrative): string[] {
  const problems: string[] = [];
  const sentences = [...narrative.scenario.split(/(?<=\.)\s+/), ...narrative.recommendations];
  const { zones, bottleneck, blockedStair, openStairs } = facts;
  const leaving = facts.headcount - facts.stranded;
  const floorWide = [facts.floor, facts.headcount, facts.timeToClearS, facts.baselineS, facts.timeToClearS - facts.baselineS];
  if (facts.stranded > 0) floorWide.push(facts.stranded, leaving);
  const labels = [...zones.map((z) => z.label), ...facts.wardenPosts.map((p) => p.label), ...openStairs];
  if (bottleneck) labels.push(bottleneck.label);
  if (blockedStair) labels.push(blockedStair);
  // Longest first, so "Suites 2202–2205" is masked whole before any shorter label inside it.
  labels.sort((a, b) => b.length - a.length);
  const last = Math.max(...zones.map((z) => z.clearedAtS ?? 0));

  for (const s of sentences) {
    const fail = (why: string) => problems.push(`${why}: "${s}"`);
    const named = zones.filter((z) => s.includes(z.label));
    const namesBottleneck = bottleneck !== null && s.includes(bottleneck.label);

    if (NUMBER_WORDS.test(s)) fail(`spells out an amount (${s.match(NUMBER_WORDS)![0]})`);
    if (!facts.allClear && /\bclears?\b/i.test(s)) fail("says the floor clears, but someone is cut off");

    // Every number must be a fact of the floor or of something the sentence names.
    const allowed = new Set(floorWide);
    for (const z of named) {
      allowed.add(z.occupants).add(z.rerouted);
      if (z.clearedAtS !== null) allowed.add(z.clearedAtS);
    }
    if (namesBottleneck) {
      allowed.add(bottleneck.peakQueue).add(bottleneck.waiters).add(bottleneck.mostWaitedS).add(bottleneck.personSeconds);
      allowed.add(bottleneck.throughput);
    }
    if (blockedStair && s.includes(blockedStair)) allowed.add(facts.wouldUse);
    // A door the sentence names brings the count of people who leave by it.
    const doorsNamed = facts.wardenPosts.filter((p) => p.doorId !== null && new RegExp(`${escape(p.doorId)}(?![\\w-])`).test(s));
    for (const p of doorsNamed) allowed.add(p.people);
    let bare = s;
    for (const label of labels) bare = bare.split(label).join("#");
    bare = bare.replace(/\bd-[a-z0-9-]+/g, "#");
    for (const m of bare.matchAll(NUMBER)) {
      if (!allowed.has(num(m[0]))) fail(`states ${m[0]}, which is no fact of the floor or of what it names`);
    }

    // Door ids: each is the warden post of a room the sentence names.
    for (const door of s.match(/\bd-[a-z0-9-]+/g) ?? []) {
      const post = facts.wardenPosts.find((p) => p.doorId === door);
      if (!post) fail(`names ${door}, which is no warden post's door`);
      else if (!s.includes(post.label)) fail(`names ${door} without its room, ${post.label}`);
    }
    // A warden "at the room's door" reaches the whole room only when the whole room leaves by that door.
    for (const m of s.matchAll(/at (?:the )?(.+?) door \((d-[a-z0-9-]+)\)/g)) {
      const post = facts.wardenPosts.find((p) => p.doorId === m[2]);
      const zone = zones.find((z) => z.label === m[1]);
      if (post && zone && post.people !== zone.occupants) {
        fail(`posts a warden at ${m[2]} for ${zone.label}, but only ${post.people} of its ${zone.occupants} leave by it`);
      }
    }
    // "21 leave by d-2210-south", "5 by d-2210-north": the people who leave by that door.
    for (const m of s.matchAll(/(\d[\d,]*) (?:people )?(?:leave )?by (d-[a-z0-9-]+)/g)) {
      const post = facts.wardenPosts.find((p) => p.doorId === m[2]);
      if (post && num(m[1]) !== post.people) fail(`says ${m[1]} leave by ${m[2]}, but ${post.people} do`);
    }
    // A room's count: "its N people" is the room's occupants, or, when the sentence turns it, the people to turn.
    const turning = /\bturns?\b/i.test(s) && !/no turning/i.test(s);
    for (const m of s.matchAll(/its (\d[\d,]*) (?:people|occupants)/g)) {
      if (named.length !== 1) fail(`says its ${m[1]} people without naming exactly one room`);
      else if (!turning && num(m[1]) !== named[0].occupants) fail(`says ${named[0].label} has ${m[1]} people, but it has ${named[0].occupants}`);
    }
    // A turning sentence that names doors of the room names every door its people leave by.
    if (turning && named.length === 1 && s.match(/\bd-[a-z0-9-]+/)) {
      for (const p of facts.wardenPosts.filter((x) => x.label === named[0].label)) {
        if (p.doorId && !s.includes(p.doorId)) fail(`turns ${named[0].label} at some of its doors, but ${p.people} leave by ${p.doorId}`);
      }
    }

    // Queues: only the bottleneck room queues, with the whole room's figures, each stated as what it is.
    if (QUEUE_WORDS.test(s)) {
      if (!bottleneck) fail("speaks of a queue, but nobody queued");
      else if (!namesBottleneck) fail(`speaks of a queue without naming the bottleneck, ${bottleneck.label}`);
      else {
        const { label, peakQueue, waiters, mostWaitedS, personSeconds, throughput } = bottleneck;
        const room = `(?:it|the room|(?:the )?${escape(label)})`;
        // Where: people wait to get into or along the room (at its doorway, or for the way ahead), not "in" it.
        const queueIn = new RegExp(`\\b${QUEUE_VERB}\\b[^.;:]*?\\b(?:in|inside|within) ${room}(?![\\w-])`, "i");
        // "In the Dock Corridor, up to 2 people queue", but not "a warden in the Main Corridor to keep its queue moving".
        const inQueue = new RegExp(
          `\\b(?:in|inside|within) (?:the )?${escape(label)},?\\s+(?:(?:up to|all|some|the) )?(?:[\\d,]+ )?(?:people |of them )?(?:at once )?${QUEUE_VERB}\\b`,
          "i",
        );
        if (queueIn.test(s) || inQueue.test(s)) {
          fail(`puts the queue in ${label}, but it counts people waiting to get into or along it, many of them outside it`);
        }
        // Units: everyone's waits added up are person-seconds, never seconds on the clock.
        if (/\d[\d,]*\s*(?:s|secs?|seconds?|minutes?|mins?)\b(?!-)\s+(?:of\s+)?(?:waiting|queueing|queuing|wait|queue)\b/i.test(s)) {
          fail("states a sum of waits as seconds, which reads as time on the clock; it is person-seconds");
        }
        for (const m of s.matchAll(/(\d[\d,]*) person-seconds/g)) {
          if (num(m[1]) !== personSeconds) fail(`says ${m[1]} person-seconds, but the room's total is ${personSeconds}`);
        }
        // The most one person waited is their waits added together over every stop: never one wait.
        if (/\b(?:longest|single|unbroken|straight|continuous(?:ly)?)\b/i.test(s)) {
          fail("speaks of the longest or one unbroken wait, but the facts give one person's waits added together");
        }
        for (const m of s.matchAll(/(\d[\d,]*) s\b(?!-)/g)) {
          if (num(m[1]) !== mostWaitedS) fail(`says ${m[1]} s of waiting, but the most one person waited is ${mostWaitedS} s`);
          else if (!/\bin all\b/.test(s.slice(m.index!, m.index! + m[0].length + 12))) {
            fail(`gives ${m[1]} s without "in all", so it reads as one wait`);
          }
        }
        // Counts, clause by clause: one "at once" is the peak; any other count of who waits is the waiters.
        let masked = s;
        for (const l of labels) masked = masked.split(l).join("#");
        for (const clause of masked.split(/[,;:]|\band\b/)) {
          if (/person-seconds|pass(?:es)? through|in all/.test(clause)) continue;
          const counts = [...clause.matchAll(NUMBER)].map((m) => num(m[0]));
          if (/at once|at a time|at the peak|up to/i.test(clause)) {
            for (const n of counts) if (n !== peakQueue) fail(`says ${n} queue at once, but the room's peak is ${peakQueue}`);
          } else if (new RegExp(`\\b${QUEUE_VERB}\\b`, "i").test(clause)) {
            for (const n of counts) if (n !== waiters) fail(`says ${n} wait for ${label}, but ${waiters} do`);
          }
        }
        // A sentence about the queue states only the room's figures, never a floor-wide one.
        for (const m of bare.matchAll(NUMBER)) {
          if (![peakQueue, waiters, mostWaitedS, personSeconds, throughput].includes(num(m[0]))) {
            fail(`states ${m[0]} in a sentence about the queue, which is none of ${label}'s figures`);
          }
        }
      }
    }
    for (const m of s.matchAll(/(all )?(\d[\d,]*) (?:of the \d+ )?(?:people )?pass(?:es)? through/g)) {
      if (!namesBottleneck) fail("says who passes through without naming the bottleneck");
      else if (num(m[2]) !== bottleneck.throughput) fail(`says ${m[2]} pass through, but ${bottleneck.throughput} do`);
      if (m[1] && num(m[2]) !== facts.headcount) fail(`says all ${m[2]}, but ${facts.headcount} are on the floor`);
    }

    // Turning: only a room whose people would have used the blocked stair, from it, toward an open one.
    if (/\bturns?\b/i.test(s) && !/no turning/i.test(s)) {
      if (named.length !== 1) fail("turns people without naming exactly one room");
      else {
        const z = named[0];
        if (z.rerouted === 0) fail(`turns ${z.label}, but none of its people would use ${blockedStair ?? "a blocked stair"}`);
        for (const m of s.matchAll(/its (\d[\d,]*) people/g)) {
          if (num(m[1]) !== z.rerouted) fail(`turns ${m[1]} of ${z.label}, but ${z.rerouted} would use the blocked stair`);
        }
      }
      const from = s.match(/from (.+?) to (.+?)(?=[:;,.]|$)/);
      if (!from) fail("turns people without saying from which stair to which");
      else {
        if (from[1] !== blockedStair) fail(`turns people from ${from[1]}, which is not the blocked stair`);
        if (!openStairs.includes(from[2])) fail(`turns people to ${from[2]}, which is not an open stair`);
      }
    }
    if (/no turning|already use/i.test(s)) {
      for (const z of named) if (z.rerouted > 0) fail(`says ${z.label} needs no turning, but ${z.rerouted} would use the blocked stair`);
    }

    // Per-room counts and times.
    for (const z of zones) {
      const label = escape(z.label);
      for (const m of s.matchAll(new RegExp(`(\\d[\\d,]*) in (?:the )?${label}`, "g"))) {
        if (num(m[1]) !== z.occupants) fail(`puts ${m[1]} in ${z.label}, but ${z.occupants} are there`);
      }
      for (const m of s.matchAll(new RegExp(`(?:the (\\d[\\d,]*)|all) from (?:the )?${label}`, "g"))) {
        const want = m[1] === undefined ? facts.wouldUse : num(m[1]);
        if (z.rerouted !== want) fail(`says ${m[0]} would use the blocked stair, but ${z.rerouted} of ${z.label} would`);
      }
    }
    if (/in a stair by (\d+) s/.test(s)) {
      const t = num(s.match(/in a stair by (\d+) s/)![1]);
      if (named.length !== 1 || named[0].clearedAtS !== t) fail(`says in a stair by ${t} s, which is no named room's time`);
    }
    if (/\blast into a stair\b/.test(s)) {
      if (named.length !== 1 || named[0].clearedAtS !== last) fail("names as last a room that is not the last out");
      const at = s.match(/at (\d+) s/);
      if (!at || num(at[1]) !== facts.timeToClearS) fail(`gives the last time as ${at?.[1]}, not ${facts.timeToClearS}`);
    }
    const inStair = s.match(/in a stair in (\d+) s, (\d+) s longer/);
    if (inStair && (num(inStair[1]) !== facts.timeToClearS || num(inStair[2]) !== facts.timeToClearS - facts.baselineS)) {
      fail("misstates the time to clear or its cost");
    }
    const wouldUse = s.match(/(\d+) of them would use/);
    if (wouldUse && (num(wouldUse[1]) !== facts.wouldUse || !blockedStair || !s.includes(blockedStair))) {
      fail(`says ${wouldUse[1]} would use the blocked stair, but ${facts.wouldUse} would`);
    }
    for (const m of s.matchAll(/all (\d[\d,]*) (?:people )?leave by (.+?)(?=[:;,.]|$)/g)) {
      if (num(m[1]) !== leaving) fail(`says all ${m[1]} leave, but ${leaving} can`);
      if (!openStairs.includes(m[2]) || openStairs.length !== 1) fail(`says all leave by ${m[2]}, which is not the one open stair`);
    }
    if (blockedStair && /\bblocks?\b/.test(s)) {
      const stair = s.match(/blocks (.+?)(?=[:;,.]|$)/)?.[1];
      if (stair !== undefined && stair !== blockedStair) fail(`says the drill blocks ${stair}, not ${blockedStair}`);
    }
  }

  // Every room that must be turned has a recommendation that turns it.
  for (const z of zones.filter((x) => x.rerouted > 0)) {
    if (!narrative.recommendations.some((r) => /\bturns?\b/i.test(r) && r.includes(z.label))) {
      problems.push(`no recommendation turns ${z.label}, whose ${z.rerouted} would use the blocked stair`);
    }
  }
  return problems;
}

/**
 * Every number in each recording, sentence by sentence (the scenario's sentences, then the recommendations), as
 * the phrase that states it with `{field}` where the number stands. A field is a fact of the floor:
 * `headcount`, `zone[Server Closet].occupants`, `post[d-2202].people`, `bottleneck.peakQueue`, or a difference
 * of two, `timeToClearS-baselineS`.
 */
const LEDGER: Record<string, string[][]> = {
  "floor-22-staged": [
    ["{headcount} people on floor {floor}", "{zone[Server Closet].occupants} in the Server Closet", "{zone[Records Room].occupants} in the Records Room"],
    ["which {wouldUse} of them would use", "all {headcount-stranded} leave by"],
    ["in a stair in {timeToClearS} s, {timeToClearS-baselineS} s longer"],
    ["{bottleneck.waiters} people wait to get into or along", "up to {bottleneck.peakQueue} at once", "the most any of them waits is {bottleneck.mostWaitedS} s in all"],
    ["turn its {zone[Server Closet].rerouted} people", "last into a stair, at {zone[Server Closet].clearedAtS} s"],
    ["keep its {zone[Records Room].occupants} people moving", "in a stair by {zone[Records Room].clearedAtS} s"],
    ["all {bottleneck.throughput} people pass through it", "up to {bottleneck.peakQueue} at once wait"],
  ],
  "floor-21-busiest": [
    [
      "{headcount} people on floor {floor}",
      "{zone[Suites 2202–2205].occupants} in Suites 2202–2205",
      "{zone[Suites 2206–2209].occupants} in Suites 2206–2209",
      "{zone[Open Office 2210].occupants} in Open Office 2210",
    ],
    [
      "which {wouldUse} of them would use",
      "the {zone[Suites 2206–2209].rerouted} from Suites 2206–2209",
      "the {zone[Open Office 2210].rerouted} from Open Office 2210",
      "all {headcount-stranded} leave by",
    ],
    ["in a stair in {timeToClearS} s, {timeToClearS-baselineS} s longer"],
    [
      "all {bottleneck.throughput} pass through it",
      "{bottleneck.waiters} of them wait",
      "up to {bottleneck.peakQueue} at once",
      "the most any of them waits is {bottleneck.mostWaitedS} s in all",
    ],
    ["turn its {zone[Suites 2206–2209].rerouted} people", "last into a stair, at {zone[Suites 2206–2209].clearedAtS} s"],
    ["turn its {zone[Open Office 2210].rerouted} people", "{post[d-2210-south].people} leave by d-2210-south", "{post[d-2210-north].people} by d-2210-north"],
    ["up to {bottleneck.peakQueue} people at once", "the most any of them waits is {bottleneck.mostWaitedS} s in all"],
  ],
};

/** The value of one ledger field in `facts`; throws on a field the facts do not have, so a typo cannot pass. */
function fieldOf(facts: DrillFacts, field: string): number {
  if (field.includes("-") && !field.includes("[")) {
    const [a, b] = field.split("-");
    return fieldOf(facts, a) - fieldOf(facts, b);
  }
  const room = field.match(/^zone\[(.+)\]\.(occupants|rerouted|clearedAtS)$/);
  if (room) {
    const z = facts.zones.find((x) => x.label === room[1]);
    if (!z || z[room[2] as "occupants"] === null) throw new Error(`no ${field}`);
    return z[room[2] as "occupants"];
  }
  const post = field.match(/^post\[(.+)\]\.people$/);
  if (post) {
    const p = facts.wardenPosts.find((x) => x.doorId === post[1]);
    if (!p) throw new Error(`no ${field}`);
    return p.people;
  }
  const b = field.match(/^bottleneck\.(peakQueue|waiters|mostWaitedS|personSeconds|throughput)$/);
  if (b) {
    if (!facts.bottleneck) throw new Error(`no ${field}`);
    return facts.bottleneck[b[1] as "peakQueue"];
  }
  const top = facts[field as keyof DrillFacts];
  if (typeof top !== "number") throw new Error(`no field ${field}`);
  return top;
}

/** The numbers in `narrative` that its ledger does not tie to a field, or that no longer equal their field. */
function unledgered(facts: DrillFacts, narrative: DrillNarrative, ledger: string[][]): string[] {
  const problems: string[] = [];
  const sentences = [...narrative.scenario.split(/(?<=\.)\s+/), ...narrative.recommendations];
  if (sentences.length !== ledger.length) problems.push(`has ${sentences.length} sentences, but the ledger has ${ledger.length}`);
  const labels = [...facts.zones.map((z) => z.label), ...facts.openStairs, facts.bottleneck?.label ?? "", facts.blockedStair ?? ""]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  sentences.forEach((s, i) => {
    let rest = s;
    for (const phrase of ledger[i] ?? []) {
      const said = phrase.replace(/\{([^}]+)\}/g, (_, field: string) => fieldOf(facts, field).toLocaleString("en-US"));
      if (!rest.includes(said)) problems.push(`sentence ${i + 1} does not say "${said}" (${phrase}): "${s}"`);
      else rest = rest.replace(said, "#");
    }
    for (const label of labels) rest = rest.split(label).join("#");
    rest = rest.replace(/\bd-[a-z0-9-]+/g, "#");
    for (const m of rest.matchAll(NUMBER)) problems.push(`sentence ${i + 1} states ${m[0]}, which the ledger ties to no field: "${s}"`);
  });
  return problems;
}

describe("every figure and claim in the recorded narratives", () => {
  it("holds of the simulation's facts for its floor, on floor 22 and floor 21", async () => {
    const recording = (await loadDrillRecording("F1"))!;
    const byFloor = { 22: factsFor("staged"), 21: factsFor("busiest") } as Record<number, DrillFacts>;
    expect(recording.narratives.map((n) => n.facts.floor).sort()).toEqual([21, 22]);
    for (const { id, facts, narrative } of recording.narratives) {
      // The recording's own facts are the simulation's (narrator.test.ts), so check against the simulation's.
      expect(facts, id).toEqual(byFloor[facts.floor]);
      expect(unsupportedClaims(byFloor[facts.floor], narrative), id).toEqual([]);
    }
  });

  it("ties every number in each recording to the simulation field it states", async () => {
    const recording = (await loadDrillRecording("F1"))!;
    const byFloor = { 22: factsFor("staged"), 21: factsFor("busiest") } as Record<number, DrillFacts>;
    expect(recording.narratives.map((n) => n.id).sort()).toEqual(Object.keys(LEDGER).sort());
    for (const { id, facts, narrative } of recording.narratives) {
      expect(unledgered(byFloor[facts.floor], narrative, LEDGER[id]), id).toEqual([]);
    }
  });

  it("reports the whole bottleneck room's figures, not one node's", () => {
    // Floor 21's Main Corridor: every one of the 99 walks it, and its nodes together hold far more than any one does.
    const busiest = factsFor("busiest");
    // 98 of them wait to get into or along it, 2,461 person-seconds in all (about 25 s each); the most any one
    // person waited, every stop added together, is 80 s. The longest unbroken wait is shorter: this is a total.
    expect(busiest.bottleneck).toEqual({
      label: "Main Corridor",
      peakQueue: 53,
      waiters: 98,
      mostWaitedS: 80,
      personSeconds: 2461,
      throughput: 99,
    });
    // Floor 22's Dock Corridor: 3 people wait to get into or along it (up to 2 of them at once).
    expect(factsFor("staged").bottleneck).toEqual({
      label: "Dock Corridor",
      peakQueue: 2,
      waiters: 3,
      mostWaitedS: 2,
      personSeconds: 3,
      throughput: 6,
    });
  });

  it("tells which rooms would have used the blocked stair", () => {
    expect(factsFor("staged").zones.map((z) => [z.label, z.rerouted])).toEqual([
      ["Server Closet", 3],
      ["Records Room", 0],
    ]);
    expect(factsFor("busiest").zones.map((z) => [z.label, z.rerouted])).toEqual([
      ["Open Office 2210", 26],
      ["Suites 2202–2205", 0],
      ["Suites 2206–2209", 31],
    ]);
  });

  describe("fails a recording that drifts from the simulation", () => {
    const staged = factsFor("staged");
    const busiest = factsFor("busiest");
    const ok = (facts: DrillFacts) => {
      const n = { 22: "floor-22-staged", 21: "floor-21-busiest" }[facts.floor]!;
      return loadDrillRecording("F1").then((r) => r!.narratives.find((x) => x.id === n)!.narrative);
    };
    const withRec = (n: DrillNarrative, i: number, text: string): DrillNarrative => ({
      ...n,
      recommendations: n.recommendations.map((r, k) => (k === i ? text : r)),
    });

    it("turning a room that already uses the open stair (round 1's floor 22)", async () => {
      const n = withRec(
        await ok(staged),
        1,
        "Post a warden at the Records Room door (d-records-room) to turn its 3 people toward East Stair (Stair A) while West Stair (Stair B) is out.",
      );
      const problems = unsupportedClaims(staged, n);
      expect(problems.join("\n")).toMatch(/turns Records Room, but none of its people/);
    });

    it("leaving out a room that must be turned", async () => {
      const n = withRec(await ok(busiest), 1, "Post a warden at the Open Office 2210 door (d-2210-south) to keep its 26 people moving.");
      expect(unsupportedClaims(busiest, n).join("\n")).toMatch(/no recommendation turns Open Office 2210/);
    });

    it("one node's queue stated as the room's (round 1's figures)", async () => {
      const deep = { ...(await ok(staged)) };
      deep.scenario = deep.scenario.replace("up to 2 at once", "never more than one person deep");
      expect(unsupportedClaims(staged, deep).join("\n")).toMatch(/spells out an amount/);

      const twenty = withRec(await ok(busiest), 2, "Post a warden in the Main Corridor to keep its queue moving: up to 20 people at once wait to get into or along it.");
      expect(unsupportedClaims(busiest, twenty).join("\n")).toMatch(/says 20 queue at once, but the room's peak is 53/);

      const waited = withRec(await ok(busiest), 2, "Post a warden in the Main Corridor: its queue adds up to 1,108 person-seconds.");
      expect(unsupportedClaims(busiest, waited).join("\n")).toMatch(/1,108 person-seconds, but the room's total is 2461/);
    });

    // Each sentence a past round shipped, or a mutation a review tried, swapped into a recording that is otherwise true.
    const STAGED_QUEUE = "3 people wait to get into or along the Dock Corridor, up to 2 at once; the most any of them waits is 2 s in all, every stop added together.";
    const BUSIEST_QUEUE =
      "The Main Corridor is the choke point: all 99 pass through it, and 98 of them wait to get into or along it, up to 53 at once; the most any of them waits is 80 s in all, every stop added together.";
    const withScenario = (n: DrillNarrative, from: string, to: string): DrillNarrative => {
      expect(n.scenario).toContain(from);
      return { ...n, scenario: n.scenario.replace(from, to) };
    };
    const wrong: [string, () => Promise<[DrillFacts, DrillNarrative]>, RegExp[]][] = [
      [
        "round 3, floor 22's scenario",
        async () => [staged, withScenario(await ok(staged), STAGED_QUEUE, "People queue in the Dock Corridor, up to 2 at once and 8 s of waiting in all.")],
        [/puts the queue in Dock Corridor/, /sum of waits as seconds/],
      ],
      [
        "round 3, floor 22's third recommendation",
        async () => [staged, withRec(await ok(staged), 2, "Keep the Dock Corridor clear during the drill: all 6 people pass through it, and up to 2 queue in it at once.")],
        [/puts the queue in Dock Corridor/],
      ],
      [
        "round 3, floor 21's scenario",
        async () => [
          busiest,
          withScenario(
            await ok(busiest),
            BUSIEST_QUEUE,
            "The Main Corridor is the choke point: all 99 pass through it, with up to 53 people queued in it at once and 2,668 s of waiting in all.",
          ),
        ],
        [/puts the queue in Main Corridor/, /sum of waits as seconds/],
      ],
      [
        "round 3, floor 21's third recommendation",
        async () => [busiest, withRec(await ok(busiest), 2, "Post a warden in the Main Corridor to keep its queue moving: up to 53 people wait in it at once.")],
        [/puts the queue in Main Corridor/],
      ],
      [
        "round 3's mutation: the headcount as the peak (R3-M2)",
        async () => [staged, withRec(await ok(staged), 2, "Keep the Dock Corridor clear during the drill: all 6 people queue in it at once.")],
        [/says 6 queue at once, but the room's peak is 2/, /puts the queue in Dock Corridor/],
      ],
      [
        "the headcount as the peak, without saying where",
        async () => [staged, withRec(await ok(staged), 2, "Keep the Dock Corridor clear during the drill: all 6 people wait to get into it at once.")],
        [/says 6 queue at once, but the room's peak is 2/],
      ],
      [
        "the headcount as the people who wait",
        async () => [staged, withScenario(await ok(staged), STAGED_QUEUE, "6 people wait to get into or along the Dock Corridor, up to 2 at once, the most any of them waits is 2 s in all.")],
        [/says 6 wait for Dock Corridor, but 3 do/],
      ],
      [
        "the total stated as minutes, or as the longest wait",
        async () => [
          busiest,
          withScenario(await ok(busiest), BUSIEST_QUEUE, "The Main Corridor is the choke point: the longest wait for it is 2,668 s, and 44 minutes of waiting in all."),
        ],
        [/speaks of the longest or one unbroken wait/, /says 2,668 s of waiting, but the most one person waited is 80 s/, /sum of waits as seconds/],
      ],
      [
        "round 1, one node's queue as the room's",
        async () => [busiest, withRec(await ok(busiest), 2, "Post a warden in the Main Corridor to keep its queue moving: up to 20 people wait in it at once.")],
        [/says 20 queue at once/, /puts the queue in Main Corridor/],
      ],
      [
        "round 5 (R5-C1), one person's waits added together stated as one wait",
        async () => [staged, withScenario(await ok(staged), STAGED_QUEUE, "3 people wait to get into or along the Dock Corridor, up to 2 at once, the longest for 2 s.")],
        [/speaks of the longest or one unbroken wait/, /gives 2 s without "in all"/],
      ],
      [
        "one person's total as the wrong figure",
        async () => [busiest, withRec(await ok(busiest), 2, "Post a warden in the Main Corridor to keep its queue moving: up to 53 people at once wait to get into or along it, the most any of them waits is 61 s in all.")],
        [/says 61 s of waiting, but the most one person waited is 80 s/],
      ],
      [
        "round 5's mutation (R5-M1): a room's count in a sentence that turns nobody",
        async () => [staged, withRec(await ok(staged), 1, "Post a warden at the Records Room door (d-records-room) to keep its 6 people moving: they need no turning, and are in a stair by 42 s.")],
        [/says Records Room has 6 people, but it has 3/],
      ],
      [
        "round 5 (R5-M2): a warden at one door for a room that leaves by two",
        async () => [busiest, withRec(await ok(busiest), 1, "Post a warden at the Open Office 2210 door (d-2210-south) to turn its 26 people from East Stair (Stair A) to West Stair (Stair B).")],
        [/posts a warden at d-2210-south for Open Office 2210, but only 21 of its 26 leave by it/, /but 5 leave by d-2210-north/],
      ],
      [
        "the people who leave by a door, miscounted",
        async () => [
          busiest,
          withRec(await ok(busiest), 1, "Post a warden inside Open Office 2210 to turn its 26 people from East Stair (Stair A) to West Stair (Stair B): once turned, 13 leave by d-2210-south and 13 by d-2210-north."),
        ],
        [/says 13 leave by d-2210-south, but 21 do/, /says 13 leave by d-2210-north, but 5 do/],
      ],
      [
        "round 1, a node's wait as the room's",
        async () => [busiest, withScenario(await ok(busiest), BUSIEST_QUEUE, "In the Main Corridor, 1,108 s of waiting in all.")],
        [/sum of waits as seconds/],
      ],
    ];
    it.each(wrong)("%s", async (_name, make, expected) => {
      const [facts, narrative] = await make();
      const problems = unsupportedClaims(facts, narrative).join("\n");
      for (const want of expected) expect(problems).toMatch(want);
    });

    it("a changed number, which the ledger ties to its field", async () => {
      const ledger = (n: DrillNarrative, facts: DrillFacts) => unledgered(facts, n, LEDGER[{ 22: "floor-22-staged", 21: "floor-21-busiest" }[facts.floor]!]);
      expect(ledger(await ok(staged), staged)).toEqual([]);
      expect(ledger(await ok(busiest), busiest)).toEqual([]);
      const peak = withScenario(await ok(busiest), "up to 53 at once", "up to 52 at once");
      expect(ledger(peak, busiest).join("\n")).toMatch(/does not say "up to 53 at once"/);
      const most = withScenario(await ok(staged), "waits is 2 s in all", "waits is 7 s in all");
      expect(ledger(most, staged).join("\n")).toMatch(/does not say "the most any of them waits is 2 s in all"/);
      const keep = withRec(await ok(staged), 1, (await ok(staged)).recommendations[1].replace("its 3 people", "its 6 people"));
      expect(ledger(keep, staged).join("\n")).toMatch(/does not say "keep its 3 people moving"/);
      const extra = withRec(await ok(staged), 2, `${(await ok(staged)).recommendations[2]} Allow 90 s.`);
      expect(ledger(extra, staged).join("\n")).toMatch(/states 90, which the ledger ties to no field/);
    });

    it("a figure tied to the wrong room, a stray number, or a door from another room", async () => {
      const wrongCount = { ...(await ok(busiest)) };
      wrongCount.scenario = wrongCount.scenario.replace("42 in Suites 2202–2205", "41 in Suites 2202–2205");
      expect(unsupportedClaims(busiest, wrongCount).join("\n")).toMatch(/41/);

      const wrongDoor = withRec(await ok(staged), 1, "Post a warden at the Records Room door (d-server-closet) to keep its 3 people moving.");
      expect(unsupportedClaims(staged, wrongDoor).join("\n")).toMatch(/d-server-closet without its room/);

      const wrongTime = withRec(await ok(staged), 1, "Post a warden at the Records Room door (d-records-room): they are in a stair by 54 s.");
      expect(unsupportedClaims(staged, wrongTime).join("\n")).toMatch(/in a stair by 54 s/);
    });
  });
});
