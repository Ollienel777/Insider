import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FIXTURE_BUILDINGS } from "@/adapters/costar/fake";
import { BuildTrace, LevelManifest, type BuildTraceEvent } from "@/domain";
import { findMission } from "@/agents/builder/missions";
import { castFinalist, castingResult } from "@/lib/cast-because";
import { castBecauseRow, dataToLevelRows, suiteRange } from "./data-to-level";
import { DISCLAIMER, DossierScreen } from "./dossier-screen";
import { DossierUnavailable } from "./dossier-unavailable";
import { StepDetail, TraceList } from "./trace-list";
import { dossierFacts } from "./facts";
import { ProvenanceRow } from "./provenance-row";
import { Reveal } from "./reveal";
import {
  formatRecordedAt,
  recordedRunHeader,
  REPLAY_START_MS,
  replaySchedule,
  traceBanner,
  traceView,
} from "./replay";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file: string): unknown => JSON.parse(readFileSync(path.join(root, "data", "levels", file), "utf8"));
const manifest = LevelManifest.parse(read("F1.romaine-1974.json"));
const trace = BuildTrace.parse(read("F1.romaine-1974.trace.json"));
const building = FIXTURE_BUILDINGS.find((b) => b.id === "F1")!;
const romaine = findMission("romaine-1974")!;
const finalist = (await castFinalist(romaine, "F1"))!;
const cast = { candidate: finalist.candidate, mission: romaine, derived: finalist.source === "derived" };
/** The Casting Director's cached shortlist for the mission, read straight from disk (#24). */
const shortlist = JSON.parse(readFileSync(path.join(root, "data", "casting", "romaine-1974.json"), "utf8")) as {
  finalists: { id: string; reason: string }[];
};
const agentReason = shortlist.finalists.find((c) => c.id === "F1")!.reason;
/** A directory with no shortlist in it, so the derived path runs whatever `data/casting/` holds. */
const NO_SHORTLIST = path.join(root, "data", "casting", "none-cached-here");
const rows = dataToLevelRows(manifest, cast);

const screen = (startComplete: boolean) =>
  renderToStaticMarkup(
    <DossierScreen
      buildingId="F1"
      name={building.name}
      place="Bunker Hill, Los Angeles"
      facts={dossierFacts(building)}
      rows={rows}
      mission={manifest.mission}
      trace={trace}
      startComplete={startComplete}
    />,
  );

/** All text, tags dropped, hidden or not. */
const textOf = (html: string) =>
  html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

const VOID = new Set(["area", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/**
 * The text a viewer can see: nothing inside an element with the `invisible`
 * class (`visibility: hidden`), which is how Reveal holds content back.
 */
function visibleText(html: string): string {
  const stack: boolean[] = [];
  let hidden = 0;
  let out = "";
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+)/g)) {
    const [, close, tag, attrs, selfClose, text] = m;
    if (text !== undefined) {
      if (hidden === 0) out += ` ${text}`;
    } else if (close) {
      if (stack.pop()) hidden--;
    } else if (!selfClose && !VOID.has(tag.toLowerCase())) {
      const hides = /\bclass="[^"]*\binvisible\b/.test(attrs);
      stack.push(hides);
      if (hides) hidden++;
    }
  }
  return textOf(out);
}

/** Each `<tr data-testid="provenance-row">`, its own markup only. */
const provenanceRows = (html: string) => [...html.matchAll(/<tr data-testid="provenance-row"[\s\S]*?<\/tr>/g)].map((m) => m[0]);

/**
 * One element's own markup, found by its `data-testid`: from its opening tag
 * to the tag that closes it, counting nested tags of the same name.
 */
function byTestId(html: string, id: string): string {
  const open = new RegExp(`<([a-zA-Z][\\w-]*)[^>]*\\bdata-testid="${id}"[^>]*>`).exec(html);
  if (!open) throw new Error(`no element with data-testid="${id}"`);
  const tag = open[1];
  const re = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, "g");
  re.lastIndex = open.index + open[0].length;
  let depth = 1;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[1]) depth--;
    else if (!m[2]) depth++;
    if (depth === 0) return html.slice(open.index, m.index + m[0].length);
  }
  throw new Error(`data-testid="${id}" is never closed`);
}

/** Each CoStar fact's value cell. */
const factCells = (html: string) => [...html.matchAll(/<dd[^>]*>[\s\S]*?<\/dd>/g)].map((m) => m[0]);

describe("the Data → Level table for F1", () => {
  const row = (id: string) => rows.find((r) => r.id === id);

  it("opens with the cast-because row: the mission, and why F1 was cast for it (beat 4, #119)", () => {
    expect(rows.map((r) => r.id)).toEqual(["cast", "era", "guards", "staging", "crowded", "dock"]);
    expect(rows[0]).toEqual({
      id: "cast",
      layer: "costar",
      field: "casting",
      value: "romaine-1974",
      rule: "Cast for The Romaine Street Papers",
      result: `Cast because: ${agentReason}`,
    });
    expect(agentReason).not.toMatch(/^built 1974/);
    expect(dataToLevelRows(manifest).map((r) => r.id)).not.toContain("cast");
  });

  it("reads F1's finalist, reason included, from the Casting Director's cached shortlist (#24)", async () => {
    const cached = await castingResult("romaine-1974");
    expect(cached).not.toBeNull();
    expect(finalist.source).toBe("shortlist");
    expect(finalist.candidate).toEqual(cached!.finalists.find((c) => c.id === "F1"));
    expect(finalist.candidate).toMatchObject({ id: "F1", vacantFloor: { floor: 22 }, reason: agentReason });
  });

  it("derives the reason from the fixture inventory when no shortlist is cached", async () => {
    expect(await castingResult("romaine-1974", NO_SHORTLIST)).toBeNull();
    const derived = (await castFinalist(romaine, "F1", NO_SHORTLIST))!;
    expect(derived.source).toBe("derived");
    expect(derived.candidate).toMatchObject({ id: "F1", vacantFloor: { floor: 22 } });
    expect(derived.candidate.fit.map((f) => f.criterion)).toEqual(romaine.casting.map((f) => f.label));
    expect(castBecauseRow({ candidate: derived.candidate, mission: romaine, derived: true })).toMatchObject({
      rule: "Cast for The Romaine Street Papers (derived from its casting filters)",
      result: "Cast because: built 1974, Class A, floor 22 on the market, dock on the aerial",
    });
    // A shortlist's finalist reads straight through, its reason the agent's own.
    expect(castBecauseRow({ candidate: { id: "F1", reason: "the agent's words" }, mission: romaine, derived: false })).toMatchObject({
      rule: "Cast for The Romaine Street Papers",
      result: "Cast because: the agent's words",
    });
  });

  it("has a row for year built 1974 with its result", () => {
    expect(row("era")).toEqual({
      id: "era",
      layer: "costar",
      field: "yearBuilt",
      value: "1974",
      rule: "Before 1980",
      result: "Analog era: key locks, sweeping CCTV",
    });
  });

  it("has a row for class A: 4 guards on tight rounds", () => {
    expect(row("guards")).toMatchObject({ field: "buildingClass", value: "A", result: "4 guards, tight rounds" });
  });

  it("has a row for floor 22's available suites, staged as quiet zones", () => {
    expect(row("staging")).toMatchObject({
      layer: "costar",
      field: "availableSpace",
      value: "floor 22",
      rule: "Most free space: 23,341 sf in 9 suites",
      result: "Staged on 22; suites 2202–2210 are quiet zones",
    });
  });

  it("has a row for the dock entry, showing the recorded field and value, not the entry's id", () => {
    const dock = manifest.entries.find((e) => e.kind === "dock")!;
    const recorded = manifest.provenance.find((p) => p.elementRole === `entry:${dock.id}`)!;
    expect(row("dock")).toMatchObject({ layer: recorded.layer, field: recorded.field, value: String(recorded.value) });
    expect(row("dock")).toMatchObject({ field: "entries.kind", value: "dock", result: "Always offered as a way in and out" });
  });

  it("derives the dock row's result from its recorded rule, not a fixed phrase", () => {
    const reworded = LevelManifest.parse({
      ...manifest,
      provenance: manifest.provenance.map((p) =>
        p.elementRole === "entry:dock-N"
          ? { ...p, rule: 'The aerial tags "Loading dock" (dock): a loading dock is the crew\'s way out only' }
          : p,
      ),
    });
    expect(dataToLevelRows(reworded).find((r) => r.id === "dock")?.result).toBe("The crew's way out only");
  });

  it("shows the dock row's value as rendered on the screen, equal to the record", () => {
    const recorded = manifest.provenance.find((p) => p.elementRole === "entry:dock-N")!;
    const html = screen(true);
    const dockRow = /<tr[^>]*data-rule="dock"[\s\S]*?<\/tr>/.exec(html)![0];
    const cells = [...dockRow.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => textOf(m[1]).trim());
    expect(cells[1]).toBe(recorded.field);
    expect(cells[2]).toBe(String(recorded.value));
  });

  it("reads each row from the manifest's provenance, not a fixed list", () => {
    const later = LevelManifest.parse({
      ...manifest,
      securityProfile: { ...manifest.securityProfile, guardCount: 2, era: "card", lockKind: "magstripe", cameraKind: "ptz" },
      provenance: manifest.provenance.map((p) =>
        p.elementRole === "profile:era" ? { ...p, value: 1989, rule: "Built 1989 (1980–1999) → Card and coax era" } : p,
      ),
    });
    const changed = dataToLevelRows(later);
    expect(changed.find((r) => r.id === "era")).toMatchObject({
      value: "1989",
      rule: "1980–1999",
      result: "Card and coax era: magstripe readers, PTZ cameras",
    });
    expect(changed.find((r) => r.id === "guards")?.result).toBe("2 guards, tight rounds");
    const noDock = dataToLevelRows({ ...manifest, entries: manifest.entries.filter((e) => e.kind !== "dock") });
    expect(noDock.map((r) => r.id)).not.toContain("dock");
  });

  it("writes suite runs as a range and anything else as a list", () => {
    expect(suiteRange(["2204", "2202", "2203"])).toBe("2202–2204");
    expect(suiteRange(["810", "1504"])).toBe("810, 1504");
    expect(suiteRange(["2202"])).toBe("2202");
  });
});

describe("the replay", () => {
  const schedule = replaySchedule(trace, rows.length);

  it("plays in about six seconds, in recorded order", () => {
    expect(schedule.end).toBeGreaterThanOrEqual(5000);
    expect(schedule.end).toBeLessThanOrEqual(7000);
    expect(schedule.events).toEqual([...schedule.events].sort((a, b) => a - b));
    expect(schedule.events[0]).toBe(REPLAY_START_MS);
  });

  it("fills the facts, then the table row by row, then the briefing, as their tools return", () => {
    const toolAt = (label: string) => schedule.events[trace.events.findIndex((e) => e.label === label)];
    expect(schedule.facts).toBeGreaterThan(toolAt("get_building"));
    expect(schedule.rows[0]).toBeGreaterThan(toolAt("derive_security_profile"));
    expect(schedule.rows).toEqual([...schedule.rows].sort((a, b) => a - b));
    expect(new Set(schedule.rows).size).toBe(rows.length);
    expect(schedule.facts).toBeLessThan(schedule.rows[0]);
    expect(schedule.rows[rows.length - 1]).toBeLessThan(schedule.briefing);
    expect(schedule.briefing).toBeGreaterThan(toolAt("write_manifest"));
  });

  it("ticks each todo in place rather than listing it again", () => {
    const start = traceView(trace, (i) => i < 3);
    expect(start.todos.map((t) => t.status)).toEqual(["in_progress", "pending", "pending"]);
    const end = traceView(trace, () => true);
    expect(end.todos).toHaveLength(3);
    expect(end.todos.every((t) => t.status === "completed")).toBe(true);
    const none = traceView(trace, () => false);
    expect(none.todos.map((t) => t.status)).toEqual([null, null, null]);
  });

  it("indents each subagent's tool calls under its task and keeps the builder's own at the top", () => {
    const { steps } = traceView(trace, () => true);
    expect(steps.map((s) => `${s.depth}:${s.kind === "subagent" ? `task ${s.agent}` : s.label}`)).toEqual([
      "0:task data-analyst",
      "1:get_building",
      "1:get_available_space",
      "1:get_aerial_entries",
      "1:derive_security_profile",
      "0:task game-master",
      "1:get_mission",
      "0:write_manifest",
    ]);
    expect(steps.every((s) => s.shown && s.status === "completed")).toBe(true);
  });

  it("shows a subagent task running while its own tool calls play", () => {
    const task = trace.events.findIndex((e) => e.kind === "subagent");
    const mid = traceView(trace, (i) => i <= task + 2);
    expect(mid.steps.find((s) => s.index === task)?.status).toBe("in_progress");
    expect(mid.steps.filter((s) => !s.shown).length).toBeGreaterThan(0);
  });
});

describe("the Recorded replay header", () => {
  it("says it is a recorded replay, when, and whose model turns: a script's, no LLM (R1-M5)", () => {
    expect(recordedRunHeader(trace)).toMatch(
      /^Recorded replay · [A-Z][a-z]{2} \d{1,2}, \d{4}, \d\d:\d\d UTC · model turns: scripted \(builder-F1-romaine-1974\), no LLM ran$/,
    );
    expect(formatRecordedAt("2026-11-13T11:39:34.402Z")).toBe("Nov 13, 2026, 11:39 UTC");
  });

  it("says so when the trace did not record either", () => {
    expect(recordedRunHeader({})).toBe("Recorded replay · time not recorded · model turns: not recorded");
  });
});

describe("DossierScreen", () => {
  it("labels a kit building's real record under its name, and a fixture building not at all (#95)", () => {
    expect(screen(true)).not.toContain('data-testid="record-label"');
    const kit = renderToStaticMarkup(
      <DossierScreen
        buildingId="900101"
        name="Testwood Exchange"
        place="Testville, Los Angeles"
        facts={dossierFacts(building)}
        rows={rows}
        mission={manifest.mission}
        trace={trace}
        recordLabel="Real CoStar record"
        startComplete
      />,
    );
    expect(kit).toMatch(/data-testid="record-label"[^>]*>Real CoStar record</);
  });

  it("starts with every block under a skeleton, so nothing is read before it plays", () => {
    const html = screen(false);
    expect(html).toContain('data-testid="skip"');
    expect(html).toMatch(/data-testid="briefing" data-shown="false"/);
    expect(html).toMatch(/data-testid="costar-facts" data-shown="false"/);
    expect(html.match(/data-testid="provenance-row"[^>]*data-shown="false"/g)).toHaveLength(rows.length);
    expect(html.match(/data-testid="trace-step"[^>]*data-shown="false"/g)?.length).toBe(8);
    expect(html.match(/data-testid="skeleton"/g)!.length).toBeGreaterThan(rows.length * 4);
    // Every block is laid out already, under its skeleton: the table has all its rows.
    expect(html.match(/data-testid="provenance-row"/g)).toHaveLength(rows.length);
  });

  it("shows no record, row or briefing content before its reveal", () => {
    // The dossier column only: the reveal holds back the record, the table and
    // the briefing there. The Level Builder panel beside it is visible from
    // the start, and its replay header names the script (…-romaine-1974),
    // which would otherwise match the year built.
    const before = visibleText(byTestId(screen(false), "dossier"));
    const after = visibleText(byTestId(screen(true), "dossier"));
    const content = [
      ...dossierFacts(building).map((f) => f.value),
      ...rows.flatMap((r) => [r.field, r.value, r.rule, r.result]),
      manifest.mission.title,
      manifest.mission.briefing,
      DISCLAIMER,
    ].filter((piece) => piece.length >= 3); // "A" (the class) is found in any sentence
    expect(content.length).toBeGreaterThan(rows.length * 3);
    for (const piece of content) {
      expect(after, `missing once revealed: ${piece}`).toContain(piece);
      expect(before, `seen before its reveal: ${piece}`).not.toContain(piece);
    }
    // The frame around the content is there from the start.
    expect(before).toContain(building.name);
    expect(before).toContain("Data → Level");
  });

  it("holds back every fact and every row, short values included, until its own reveal", () => {
    const facts = dossierFacts(building);
    const factsBefore = factCells(screen(false));
    const factsAfter = factCells(screen(true));
    expect(factsBefore).toHaveLength(facts.length);
    facts.forEach((fact, i) => {
      expect(factsBefore[i], fact.label).toContain('data-shown="false"');
      expect(factsBefore[i], fact.label).toContain('data-testid="skeleton"');
      expect(visibleText(factsBefore[i]).trim(), fact.label).toBe("");
      expect(visibleText(factsAfter[i]).trim(), fact.label).toBe(fact.value);
    });

    const rowsBefore = provenanceRows(screen(false));
    const rowsAfter = provenanceRows(screen(true));
    expect(rowsBefore).toHaveLength(rows.length);
    rows.forEach((row, i) => {
      expect(rowsBefore[i], row.id).toMatch(/^<tr data-testid="provenance-row"[^>]*data-shown="false"/);
      expect(rowsBefore[i], row.id).toContain('data-testid="skeleton"');
      expect(visibleText(rowsBefore[i]).trim(), row.id).toBe("");
      for (const piece of [row.field, row.value, row.rule, row.result]) {
        expect(visibleText(rowsAfter[i]), row.id).toContain(piece);
      }
    });
  });

  it("complete, shows the facts, the table and the briefing with its source and disclaimer", () => {
    const html = screen(true);
    const text = textOf(html);
    expect(html).not.toContain('data-testid="skeleton"');
    expect(html).toContain('data-testid="replay"');
    for (const expected of [`Cast because: ${agentReason}`, "1974", "Analog era: key locks, sweeping CCTV", "4 guards, tight rounds", "Staged on 22"]) {
      expect(text).toContain(expected);
    }
    expect(text).toContain("The Romaine Street Papers");
    expect(text).toContain("June 5, 1974");
    expect(text).toContain("Inspired by The Summa Corporation burglary");
    expect(html).toContain('href="https://www.cia.gov/stories/story/the-exposing-of-project-azorian"');
    expect(text).toContain(DISCLAIMER);
    expect(DISCLAIMER).toBe("Security shown is game fiction derived from building class and era.");
    expect(html).toMatch(/<a[^>]*href="\/b\/F1\/plan\?m=romaine-1974"[^>]*>Brief the crew<\/a>/);
  });

  it("heads the trace with the Recorded replay line and says nothing here calls a model", () => {
    const text = textOf(screen(true));
    expect(text).toContain(recordedRunHeader(trace));
    expect(text).toContain("Nothing on this screen calls a model.");
  });

  it("names no tenant: the facts are physical fields only", () => {
    expect(dossierFacts(building).map((f) => f.label)).toEqual(["Built", "Class", "Stories", "Floor", "Available"]);
    const text = textOf(screen(true));
    expect(text).not.toMatch(/tenant|leased to|occupied by/i);
  });
});

describe("Reveal", () => {
  it("hides its content under a skeleton until shown, then shows it with no skeleton", () => {
    const hidden = renderToStaticMarkup(<Reveal shown={false}>secret line</Reveal>);
    expect(textOf(hidden)).toContain("secret line");
    expect(visibleText(hidden)).not.toContain("secret line");
    expect(hidden).toContain('data-testid="skeleton"');
    const shown = renderToStaticMarkup(<Reveal shown>secret line</Reveal>);
    expect(visibleText(shown)).toContain("secret line");
    expect(shown).not.toContain('data-testid="skeleton"');
  });

  it("fills a table row by row: only the rows already reached are readable", () => {
    const html = renderToStaticMarkup(
      <table>
        <tbody>
          {rows.map((row, i) => (
            <ProvenanceRow key={row.id} row={row} shown={i < 2} />
          ))}
        </tbody>
      </table>,
    );
    const trs = provenanceRows(html);
    expect(trs).toHaveLength(rows.length);
    rows.forEach((row, i) => {
      const text = visibleText(trs[i]);
      if (i < 2) {
        for (const piece of [row.field, row.value, row.rule, row.result]) expect(text, row.id).toContain(piece);
      } else {
        expect(text.trim(), row.id).toBe("");
      }
    });
  });
});

// A trace from another run shape still lays out: no subagent, one tool.
it("replays a trace with no subagents", () => {
  const events: BuildTraceEvent[] = [
    { atMs: 0, kind: "todo", agent: "level-builder", label: "Write it", status: "in_progress" },
    { atMs: 5, kind: "tool", agent: "level-builder", label: "write_manifest", status: "completed", durationMs: 2 },
  ];
  const small = { buildingId: "F1", events };
  const view = traceView(small, () => true);
  expect(view.steps).toHaveLength(1);
  expect(view.steps[0].depth).toBe(0);
  expect(replaySchedule(small, 2).rows).toHaveLength(2);
});

describe("the trace's rows (#79)", () => {
  const html = screen(true);
  const stepOf = (label: string) => traceView(trace, () => true).steps.find((s) => s.label === label)!;

  it("are buttons, collapsed until opened, each naming the panel it opens", () => {
    const toggles = html.match(/<button[^>]*data-testid="trace-step-toggle"[^>]*>/g) ?? [];
    expect(toggles).toHaveLength(8);
    for (const toggle of toggles) {
      expect(toggle).toContain('type="button"');
      expect(toggle).toContain('aria-expanded="false"');
      expect(toggle).toMatch(/aria-controls="[^"]+"/);
    }
    expect(html).not.toContain('data-testid="trace-step-detail"');
  });

  it("name the subagent each task ran", () => {
    expect(html.match(/data-testid="trace-subagent">([^<]+)</g)?.map((m) => m.split(">")[1].slice(0, -1))).toEqual([
      "data-analyst",
      "game-master",
    ]);
  });

  it("open on a tool's recorded input and output, as text", () => {
    const text = textOf(renderToStaticMarkup(<StepDetail id="d" step={stepOf("get_building")} />));
    expect(text).toContain("Input");
    expect(text).toContain('"buildingId": "F1"');
    expect(text).toContain("Output");
    expect(text).toContain('"name": "Halvorsen Tower"');
  });

  it("open on a task's brief and its subagent's answer", () => {
    const task = traceView(trace, () => true).steps.find((s) => s.kind === "subagent")!;
    const text = textOf(renderToStaticMarkup(<StepDetail id="d" step={task} />));
    expect(text).toContain("Brief");
    expect(text).toContain("Answer Built 1974");
  });

  it("render recorded text as text, never as HTML", () => {
    const step = { ...stepOf("get_building"), output: "<img src=x onerror=alert(1)>" };
    const markup = renderToStaticMarkup(<StepDetail id="d" step={step} />);
    expect(markup).not.toContain("<img");
    expect(markup).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("tell a failed subagent run from a tool error (R1-M1)", () => {
    const failed: BuildTraceEvent[] = [
      { atMs: 0, kind: "subagent", agent: "general-purpose", label: "Look around", status: "failed", durationMs: 4, output: "Error: run failed" },
      { atMs: 1, kind: "tool", agent: "level-builder", label: "write_manifest", status: "failed", durationMs: 1, output: "Error: no profile" },
    ];
    const view = traceView({ buildingId: "F1", events: failed }, () => true);
    const list = textOf(renderToStaticMarkup(<TraceList view={view} header="h" control={null} banner="b" />));
    expect(list).toContain("task general-purpose subagent failed");
    expect(list).toContain("write_manifest tool error");
    expect(list.match(/subagent failed/g)).toHaveLength(1);
    expect(list.match(/tool error/g)).toHaveLength(1);
    const [task, tool] = view.steps.map((step) => textOf(renderToStaticMarkup(<StepDetail id="d" step={step} />)));
    expect(task).toContain("Subagent run failed Error: run failed");
    expect(tool).toContain("Tool error Error: no profile");
  });

  it("show deepagents' general-purpose subagent by name when it runs (R1-M2)", () => {
    const events: BuildTraceEvent[] = [
      { atMs: 0, kind: "subagent", agent: "general-purpose", label: "Look around", status: "completed", durationMs: 4 },
      { atMs: 1, kind: "tool", agent: "general-purpose", label: "write_manifest", status: "completed", durationMs: 1 },
    ];
    const view = traceView({ buildingId: "F1", events }, () => true);
    expect(view.steps.map((s) => s.depth)).toEqual([0, 1]);
    expect(textOf(renderToStaticMarkup(<TraceList view={view} header="h" control={null} banner="b" />))).toContain("task general-purpose");
  });

  it("open on a plain line instead of input and output when live data served the run (M1)", () => {
    const step = { ...stepOf("get_building"), withheld: true, input: undefined, output: undefined };
    const text = textOf(renderToStaticMarkup(<StepDetail id="d" step={step} />));
    expect(text.trim()).toBe("Not recorded: live data stays out of the trace.");
    expect(traceView({ ...trace, liveData: true }, () => true).steps.every((s) => s.withheld)).toBe(true);
    expect(traceView(trace, () => true).steps.some((s) => s.withheld)).toBe(false);
  });

  it("tell a task that returned an error from a subagent run that failed (S3)", () => {
    const events: BuildTraceEvent[] = [
      { atMs: 0, kind: "subagent", agent: "game-master", label: "Pick", status: "failed", failure: "returned", output: "Error: refused" },
    ];
    const view = traceView({ buildingId: "F1", events }, () => true);
    expect(textOf(renderToStaticMarkup(<TraceList view={view} header="h" control={null} banner="b" />))).toContain("task error");
    expect(textOf(renderToStaticMarkup(<StepDetail id="d" step={view.steps[0]} />))).toContain("Task returned an error Error: refused");
  });

  it("show a task naming a subagent the builder lacks as task (unknown), not a failed run (#72)", () => {
    const events: BuildTraceEvent[] = [
      { atMs: 0, kind: "subagent", agent: "level-builder", label: "Pick", status: "failed", failure: "unknown", output: 'Error: unknown subagent "made-up"' },
    ];
    const view = traceView({ buildingId: "F1", events }, () => true);
    const row = textOf(renderToStaticMarkup(<TraceList view={view} header="h" control={null} banner="b" />));
    expect(row).toContain("task (unknown)");
    expect(row).toContain("unknown subagent");
    expect(row).not.toMatch(/level-builder|subagent failed/);
    expect(textOf(renderToStaticMarkup(<StepDetail id="d" step={view.steps[0]} />))).toContain('No such subagent Error: unknown subagent "made-up"');
  });

  it("scroll recorded text in a labelled region, and set the cut marker apart from the record (S4)", () => {
    const step = { ...stepOf("get_building"), output: "abc… [12 more characters not recorded]" };
    const markup = renderToStaticMarkup(<StepDetail id="d" step={step} />);
    expect(markup).toMatch(/<pre[^>]*role="region"[^>]*aria-label="Output"/);
    expect(markup).toMatch(/abc<span data-testid="trace-cut" class="[^"]*text-text-3[^"]*">… \[12 more characters not recorded\]<\/span>/);
  });

  it("list the subagents the builder had, whether or not they ran (R1-M2)", () => {
    expect(trace.subagents).toEqual(["general-purpose", "data-analyst", "game-master"]);
    expect(textOf(html)).toContain("Available: general-purpose · data-analyst · game-master");
  });
});

describe("the trace banner (S1)", () => {
  it("says a scripted run on fixtures is one", () => {
    expect(traceBanner(trace)).toBe(
      "A replay of a run recorded on fixtures, with scripted model turns. Nothing on this screen calls a model.",
    );
    expect(textOf(screen(true))).toContain(traceBanner(trace));
  });

  it("names the live model, and live data, when they served the run", () => {
    expect(traceBanner({ model: "anthropic claude-opus-5-5", liveData: true })).toBe(
      "A replay of a run recorded on live data, with model turns from anthropic claude-opus-5-5. Nothing on this screen calls a model.",
    );
    expect(traceBanner({})).toBe("A replay of a run recorded on fixtures. Nothing on this screen calls a model.");
  });
});

describe("DossierUnavailable", () => {
  it("names the building and mission to build, in build:levels' own form", () => {
    const html = renderToStaticMarkup(<DossierUnavailable buildingId="F1" missionId="romaine-1974" name="X" reason="missing" />);
    expect(html).toContain("npm run build:levels -- F1:romaine-1974");
  });
});
