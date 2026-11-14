// The Drill screen's parts on F1 (Halvorsen Tower) and its fixture floor:
// the playback's speed and positions, the board's marks, the panel's
// figures, the narrator request, and the screen's first paint.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FIXTURE_BUILDINGS } from "@/adapters/costar/fake";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import type { Building, FloorGraph } from "@/domain";
import { drillFacts, simulateDrill, SF_PER_PERSON, type DrillFloorChoice } from "@/drill";
import { DrillBoard } from "./drill-board";
import { bottleneckLine, DrillPanel, strandedLines } from "./drill-panel";
import { DRILL_DISCLAIMER, DrillScreen, runDrill } from "./drill-screen";
import { askNarrator, DrillNarrativePanel, keepsWhole, narrativeRequest, type NarrativeAnswer } from "./narrative";
import { clearedBy, PLAYBACK_BUDGET_S, planNumberedAs, playbackMs, positionAt, seconds, speedFor } from "./playback";

const F1 = FIXTURE_BUILDINGS.find((b) => b.id === "F1")!;
const FLOOR = FIXTURE_FLOORS.F1;
const drill = (floor: DrillFloorChoice) => {
  const run = runDrill(F1, FLOOR, floor);
  if (!run.ok) throw new Error(run.message);
  return run;
};
const staged = drill("staged");
const busiest = drill("busiest");

const board = (report = staged.report, simS = 0) =>
  renderToStaticMarkup(<DrillBoard floor={FLOOR} report={report} simS={simS} />);
const panel = (run = staged, phase: "playing" | "done" = "done", simS = run.report.timeToClearS) =>
  renderToStaticMarkup(
    <DrillPanel report={run.report} baselineS={run.baseline.timeToClearS} simS={simS} phase={phase} narrative={null} />,
  );
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("the playback", () => {
  it("plays both floors in under 10 seconds, at a whole-number speed", () => {
    for (const { report } of [staged, busiest]) {
      const speed = speedFor(report.timeToClearS);
      expect(Number.isInteger(speed)).toBe(true);
      expect(playbackMs(report.timeToClearS, speed)).toBeLessThanOrEqual(PLAYBACK_BUDGET_S * 1000);
      expect(PLAYBACK_BUDGET_S).toBeLessThan(10);
    }
    expect(speedFor(54)).toBe(7);
    expect(speedFor(111)).toBe(14);
    expect(speedFor(0)).toBe(1);
  });

  it("moves each occupant along their track, and takes them off the board once in a stair", () => {
    const o = staged.report.occupants[0];
    expect(positionAt(o, 0)).toEqual(o.track[0]);
    const mid = positionAt(o, 2.5)!;
    expect(mid.x).toBeCloseTo((o.track[2].x + o.track[3].x) / 2);
    expect(mid.y).toBeCloseTo((o.track[2].y + o.track[3].y) / 2);
    expect(positionAt(o, o.clearedAtS!)).toBeNull();
    expect(clearedBy(staged.report, 0)).toBe(0);
    expect(clearedBy(staged.report, staged.report.timeToClearS)).toBe(6);
  });

  it("says when the board's suite numbers are another floor's", () => {
    const labels = FLOOR.rooms.map((r) => r.label);
    expect(planNumberedAs(labels, 22)).toBeNull();
    expect(planNumberedAs(labels, 21)).toBe(22);
    expect(planNumberedAs(["Records Room", "West Stair (Stair B)"], 21)).toBeNull();
  });
});

describe("the drill board", () => {
  it("strikes through the blocked stair and names it from the report, on either floor", () => {
    for (const { report } of [staged, busiest]) {
      const html = board(report);
      const blocked = report.scenario.blockedStair!;
      expect(html).toContain(`data-testid="blocked-stair" data-node="${blocked.nodeId}"`);
      expect(text(html)).toContain(blocked.label.toUpperCase());
      expect(html.match(/data-testid="blocked-stair"/g)).toHaveLength(1);
      expect(html.match(/data-testid="open-stair"/g)).toHaveLength(report.openStairs.length);
    }
    // The two floors block different stairs, so a fixed name would be wrong on one of them.
    expect(staged.report.scenario.blockedStair!.label).not.toBe(busiest.report.scenario.blockedStair!.label);
  });

  it("draws every occupant at the start, and none once the floor is clear", () => {
    expect(board(busiest.report, 0).match(/data-testid="occupant"/g)).toHaveLength(99);
    expect(board(busiest.report, busiest.report.timeToClearS)).not.toContain('data-testid="occupant"');
    expect(text(board(busiest.report, busiest.report.timeToClearS))).toContain("99/99 IN");
  });

  it("draws occupants who are cut off where they stand, in danger red, and counts only the walkers as walking", () => {
    const building: Building = { ...F1, id: "T1", typicalFloorSf: 4 * SF_PER_PERSON, availableSpace: [] };
    const floor: FloorGraph = {
      rooms: [
        { id: "a", label: "Suite 501", rect: { x: 0, y: 0, w: 10, h: 10 } },
        { id: "b", label: "Suite 502", rect: { x: 10, y: 0, w: 10, h: 10 } },
        { id: "st", label: "Stair A", rect: { x: 20, y: 0, w: 5, h: 10 } },
      ],
      nodes: [
        { id: "a1", x: 5, y: 5, roomId: "a", tags: [] },
        { id: "b1", x: 15, y: 5, roomId: "b", tags: [] },
        { id: "x", x: 22, y: 5, roomId: "st", tags: ["stair"] },
      ],
      edges: [{ a: "a1", b: "x", door: { id: "d-a", lockable: false } }],
      sightlines: {},
      source: "fixture",
    };
    const report = simulateDrill(building, floor, { floor: 5 });
    expect(report.stranded).toHaveLength(2);
    for (const simS of [0, report.timeToClearS]) {
      const html = renderToStaticMarkup(<DrillBoard floor={floor} report={report} simS={simS} />);
      expect(html.match(/data-testid="cut-off-occupant"/g)).toHaveLength(2);
      expect(html).toMatch(/data-testid="cut-off-occupant"[^>]*style="fill:var\(--danger\)/);
      expect(html).toContain("Floor plan: 2 occupants walking to the stairs, 2 cut off where they stand");
    }
    expect(board()).not.toContain("cut-off-occupant");
    expect(board()).toContain('Floor plan: 6 occupants walking to the open stairs, West Stair (Stair B) blocked"');
  });

  it("marks each warden post and the bottleneck, in tokens only", () => {
    const html = board();
    expect(html.match(/data-testid="warden-mark"/g)).toHaveLength(staged.report.wardenPosts.length);
    expect(html).toContain(`data-testid="bottleneck-mark" data-node="${staged.report.bottleneck!.nodeId}"`);
    expect(html).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    expect(html).toContain("var(--danger)");
  });
});

describe("the drill panel", () => {
  it("shows the time to clear in 3xl once played, and the baseline beside it", () => {
    const html = panel();
    expect(html).toMatch(/data-testid="drill-time" data-phase="done"[^>]*class="[^"]*text-3xl/);
    expect(text(html)).toContain("Time to clear");
    expect(text(html)).toContain("54 s");
    expect(text(html)).toContain("8 s longer than with every stair open (46 s)");
  });

  it("counts up while playing, with how many are in a stair", () => {
    const html = panel(staged, "playing", 20.4);
    expect(html).toContain('data-phase="playing"');
    expect(text(html)).toContain("Clearing");
    expect(text(html)).toContain("20 s");
    expect(text(html)).toContain(`${clearedBy(staged.report, 20.4)} of 6 in a stair`);
  });

  it("names the blocked stair and prints the report's own sentences", () => {
    for (const run of [staged, busiest]) {
      const t = text(panel(run));
      expect(t).toContain(`${run.report.scenario.blockedStair!.label} blocked`);
      expect(t).toContain(run.report.scenario.rule);
      expect(t).toContain(run.report.headcount.rule);
      expect(t).toContain(run.report.bottleneck!.label);
      for (const zone of run.report.zones) expect(t).toContain(zone.label);
      for (const post of run.report.wardenPosts) expect(t).toContain(`door ${post.doorId}`);
    }
    expect(text(panel(busiest))).toContain("East Stair (Stair A) is the stair most occupants would use (57 of 99)");
    // The bottleneck's figures are the whole room's, over all of its nodes. The queue is people waiting to get into
    // or along the room, never "in" it, and the sum of everyone's waits is person-seconds, never seconds. The most one
    // person waited is their waits added together over every stop (R5-C1), so it is never "the longest wait".
    expect(text(panel(busiest))).toContain(
      "98 people waited to get into or along it, up to 53 at once, 2,461 person-seconds in all. " +
        "The most any one person waited, every stop added together, was 80 s. 99 of 99 pass through it.",
    );
    expect(text(panel(staged))).toContain(
      "3 people waited to get into or along it, up to 2 at once, 3 person-seconds in all. " +
        "The most any one person waited, every stop added together, was 2 s. 6 of 6 pass through it.",
    );
    for (const run of [staged, busiest]) {
      const t = text(panel(run));
      expect(t).not.toMatch(/\b(?:queued?|wait(?:ed|ing)?)\b[^.]*\bin (?:it|the room)\b/);
      expect(t).not.toMatch(/[\d,]+ s of waiting/);
      expect(t).not.toMatch(/longest/i);
    }
    // Waits are to the whole second, so a wait under half a second reads "under 1", never "0".
    const brief = { ...staged.report.bottleneck!, waiters: 1, peakQueue: 1, personSeconds: 0, mostWaitedS: 0 };
    expect(bottleneckLine(brief, 6)).toBe(
      "1 person waited to get into or along it, up to 1 at once, under 1 person-second in all. " +
        "The most any one person waited, every stop added together, was under 1 s. 6 of 6 pass through it.",
    );
  });

  it("posts a warden at every door a room leaves by, with who leaves by it (R5-M2)", () => {
    // Floor 21: Suites 2202–2205 leaves by two doors, 21 by each; Open Office 2210 by two, 21 and 5.
    const rows = (run: typeof staged) =>
      [...panel(run).matchAll(/<li[^>]*data-testid="warden-post"[^>]*>(.*?)<\/li>/g)].map((m) => text(m[1]).replace(/\s+/g, " ").trim());
    expect(rows(busiest)).toEqual([
      "W1 Open Office 2210 door d-2210-south 21 of 26 people",
      "W2 Open Office 2210 door d-2210-north 5 of 26 people",
      "W3 Suites 2202–2205 door d-2202 21 of 42 people",
      "W4 Suites 2202–2205 door d-2205 21 of 42 people",
      "W5 Suites 2206–2209 door d-2206 31 people",
    ]);
    expect(text(panel(busiest))).toContain("Each count is the people who leave by that door.");
    // Floor 22: each room leaves by one door, so each row is the whole room and needs no note.
    expect(rows(staged)).toEqual(["W1 Server Closet door d-server-closet 3 people", "W2 Records Room door d-records-room 3 people"]);
    expect(text(panel(staged))).not.toContain("Each count is");
    // Every post's people, room by room, add up to the room's occupants: nobody's way out goes unwatched.
    for (const run of [staged, busiest]) {
      for (const zone of run.report.zones) {
        const posts = run.report.wardenPosts.filter((p) => p.roomId === zone.roomId);
        expect(posts.reduce((n, p) => n + p.people, 0), zone.label).toBe(zone.occupants);
      }
    }
  });

  it("ticks each zone as its last occupant reaches a stair", () => {
    const at = 45; // the Records Room is clear at 42 s, the Server Closet at 54 s
    const html = panel(staged, "playing", at);
    expect(html.match(/data-cleared="true"/g)).toHaveLength(1);
    expect(panel().match(/data-cleared="true"/g)).toHaveLength(2);
  });

  it("never shows a time to clear when anyone is cut off", () => {
    const building: Building = { ...F1, id: "T1", typicalFloorSf: 4 * SF_PER_PERSON, availableSpace: [] };
    const floor: FloorGraph = {
      rooms: [
        { id: "a", label: "Suite 501", rect: { x: 0, y: 0, w: 10, h: 10 } },
        { id: "b", label: "Suite 502", rect: { x: 10, y: 0, w: 10, h: 10 } },
        { id: "st", label: "Stair A", rect: { x: 20, y: 0, w: 5, h: 10 } },
      ],
      nodes: [
        { id: "a1", x: 5, y: 5, roomId: "a", tags: [] },
        { id: "b1", x: 15, y: 5, roomId: "b", tags: [] },
        { id: "x", x: 22, y: 5, roomId: "st", tags: ["stair"] },
      ],
      edges: [{ a: "a1", b: "x", door: { id: "d-a", lockable: false } }],
      sightlines: {},
      source: "fixture",
    };
    const report = simulateDrill(building, floor, { floor: 5 });
    expect(report.allClear).toBe(false);
    const t = text(
      renderToStaticMarkup(<DrillPanel report={report} baselineS={report.timeToClearS} simS={report.timeToClearS} phase="done" narrative={null} />),
    );
    expect(t).toContain("Floor not clear");
    expect(t).toContain("2 cut off");
    expect(t).not.toContain("Time to clear");
    expect(strandedLines(report)).toEqual(["2 in Suite 502: no open stair is reachable from their room"]);
  });
});

describe("the narrator request and panel", () => {
  const facts = drillFacts(staged.report, staged.baseline, FLOOR);

  it("sends the facts and nothing of the floor", () => {
    const body = JSON.parse(String(narrativeRequest(facts).body));
    expect(Object.keys(body)).toEqual(["facts"]);
    const sent = JSON.stringify(body);
    for (const n of FLOOR.nodes) expect(sent).not.toMatch(new RegExp(`"${n.id}"`));
    expect(sent).not.toContain('"x"');
  });

  it("reads 200 as a narrative, 404 as none recorded, and anything else as an error", async () => {
    const answer: NarrativeAnswer = {
      narrative: { scenario: "Floor 22.", recommendations: ["One.", "Two.", "Three."] },
      recorded: true,
      reason: "fake mode",
      recording: "floor-22-staged",
    };
    const reply = (status: number, body: unknown) => (async () => Response.json(body, { status })) as unknown as typeof fetch;
    expect(await askNarrator(facts, reply(200, answer))).toEqual({ status: "ready", answer });
    expect(await askNarrator(facts, reply(404, { error: "no recorded narrative" }))).toEqual({ status: "none", message: "no recorded narrative" });
    expect((await askNarrator(facts, reply(500, { error: "boom" }))).status).toBe("error");
    const offline = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await askNarrator(facts, offline)).toEqual({ status: "error", message: "offline" });
  });

  it("shows the recorded chip, and holds a skeleton until the playback is done", () => {
    const answer: NarrativeAnswer = {
      narrative: { scenario: "Floor 22 holds 6 people.", recommendations: ["One.", "Two.", "Three."] },
      recorded: true,
      reason: "fake mode",
    };
    const waiting = renderToStaticMarkup(
      <DrillNarrativePanel load={{ status: "ready", answer }} start={false} onRetry={() => {}} />,
    );
    expect(waiting).toContain('data-testid="recorded-chip"');
    expect(waiting).toContain('data-testid="narrative-skeleton"');
    // While the playback runs, the words' full height is already held under the skeleton, so nothing below moves
    // when they replace it.
    expect(waiting).toContain('data-testid="narrative-reserve"');
    expect(text(waiting)).toContain("Floor 22 holds 6 people.");
    const started = renderToStaticMarkup(<DrillNarrativePanel load={{ status: "ready", answer }} start onRetry={() => {}} />);
    expect(started).toContain('data-testid="narrative-text"');
    // Every word keeps its place before it streams in, so nothing shifts.
    expect(text(started)).toContain("Floor 22 holds 6 people.");
    // A live answer carries no Recorded chip (R5-N2).
    const live = renderToStaticMarkup(
      <DrillNarrativePanel load={{ status: "ready", answer: { ...answer, recorded: false, reason: undefined } }} start onRetry={() => {}} />,
    );
    expect(live).toContain('data-testid="narrative-text"');
    expect(live).not.toContain("recorded-chip");
  });

  it("keeps door ids and hyphenated numbers whole, with or without a digit", () => {
    // The board's own labels use an en dash ("Suites 2206–2209"); an ASCII hyphen is kept whole too.
    for (const word of ["(d-server-closet):", "(d-records-room)", "(d-2210-south)", "2206–2209", "2206–2209,", "2202-2205"]) {
      expect(keepsWhole(word), word).toBe(true);
    }
    for (const word of ["Stair", "well-lit", "(Stair"]) expect(keepsWhole(word), word).toBe(false);
  });

  it("says so when nothing was recorded, offers a retry on an error, and stays off for a live scan", () => {
    expect(text(renderToStaticMarkup(<DrillNarrativePanel load={{ status: "none", message: "x" }} start onRetry={() => {}} />))).toContain(
      "No narrative was recorded for this drill",
    );
    expect(renderToStaticMarkup(<DrillNarrativePanel load={{ status: "error", message: "x" }} start onRetry={() => {}} />)).toContain(">Retry<");
    const live = renderToStaticMarkup(<DrillNarrativePanel load={{ status: "loading" }} start onRetry={() => {}} liveScan />);
    expect(live).toContain('data-status="off"');
    expect(live).not.toContain("recorded-chip");
  });
});

describe("the drill screen", () => {
  it("first paints the skeleton, the disclaimer and the disabled primary action", () => {
    const html = renderToStaticMarkup(<DrillScreen building={F1} heistMode="fake" />);
    expect(html).toContain('data-testid="drill-skeleton"');
    expect(html).toContain('data-testid="drill-panel-skeleton"');
    expect(text(html)).toContain(DRILL_DISCLAIMER.replace(/'/g, "'"));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="print-drill-plan"|<button[^>]*data-testid="print-drill-plan"[^>]*disabled=""/);
    expect(text(html)).toContain("Print drill plan");
    expect(html).toContain('role="tooltip"');
  });

  it("uses DESIGN.md's disclaimer word for word", () => {
    expect(DRILL_DISCLAIMER).toBe(
      "A planning aid, not a life-safety calculation. Headcount is estimated from CoStar's occupied area.",
    );
  });

  it("reports a floor the building does not have instead of throwing", () => {
    const run = runDrill(F1, FLOOR, 99);
    expect(run.ok).toBe(false);
    expect(run.ok ? "" : run.message).toMatch(/floor 99/);
    expect(seconds(1108)).toBe("1,108 s");
  });
});
