import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FIXTURE_BUILDINGS } from "@/adapters/costar/fake";
import { BuildTrace, LevelManifest, type BuildTraceEvent } from "@/domain";
import { dataToLevelRows, suiteRange } from "./data-to-level";
import { DISCLAIMER, DossierScreen } from "./dossier-screen";
import { dossierFacts } from "./facts";
import { ProvenanceRow } from "./provenance-row";
import { Reveal } from "./reveal";
import {
  formatRecordedAt,
  recordedRunHeader,
  REPLAY_START_MS,
  replaySchedule,
  traceView,
} from "./replay";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file: string): unknown => JSON.parse(readFileSync(path.join(root, "data", "levels", file), "utf8"));
const manifest = LevelManifest.parse(read("F1.json"));
const trace = BuildTrace.parse(read("F1.trace.json"));
const building = FIXTURE_BUILDINGS.find((b) => b.id === "F1")!;
const rows = dataToLevelRows(manifest);

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

/** Each CoStar fact's value cell. */
const factCells = (html: string) => [...html.matchAll(/<dd[^>]*>[\s\S]*?<\/dd>/g)].map((m) => m[0]);

describe("the Data → Level table for F1", () => {
  const row = (id: string) => rows.find((r) => r.id === id);

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
      "1:list_missions",
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

describe("the Recorded run header", () => {
  it("says it is a recorded run, when, and on what: a script, no LLM", () => {
    expect(recordedRunHeader(trace)).toMatch(
      /^Recorded run · [A-Z][a-z]{2} \d{1,2}, \d{4}, \d\d:\d\d UTC · ScriptedChatModel \(script builder-F1, no LLM\)$/,
    );
    expect(formatRecordedAt("2026-11-13T11:39:34.402Z")).toBe("Nov 13, 2026, 11:39 UTC");
  });

  it("says so when the trace did not record either", () => {
    expect(recordedRunHeader({})).toBe("Recorded run · time not recorded · model not recorded");
  });
});

describe("DossierScreen", () => {
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
    const before = visibleText(screen(false));
    const after = visibleText(screen(true));
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
    for (const expected of ["1974", "Analog era: key locks, sweeping CCTV", "4 guards, tight rounds", "Staged on 22"]) {
      expect(text).toContain(expected);
    }
    expect(text).toContain("The Romaine Street Papers");
    expect(text).toContain("June 5, 1974");
    expect(text).toContain("Inspired by The Summa Corporation burglary");
    expect(html).toContain('href="https://www.cia.gov/stories/story/the-exposing-of-project-azorian"');
    expect(text).toContain(DISCLAIMER);
    expect(DISCLAIMER).toBe("Security shown is game fiction derived from building class and era.");
    expect(html).toMatch(/<a[^>]*href="\/b\/F1\/plan"[^>]*>Brief the crew<\/a>/);
  });

  it("heads the trace with the Recorded run line and says nothing here calls a model", () => {
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
