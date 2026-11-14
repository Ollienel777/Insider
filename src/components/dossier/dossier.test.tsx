import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FIXTURE_BUILDINGS } from "@/adapters/costar/fake";
import { BuildTrace, LevelManifest, type BuildTraceEvent } from "@/domain";
import { dataToLevelRows, suiteRange } from "./data-to-level";
import { DISCLAIMER, DossierScreen } from "./dossier-screen";
import { dossierFacts } from "./facts";
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

/** Visible text: tags dropped, and nothing inside a `visibility: hidden` wrapper. */
const textOf = (html: string) =>
  html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

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

  it("has a row for the dock entry, from the aerial", () => {
    expect(row("dock")).toMatchObject({ layer: "vexcel", value: "dock-N", result: "Entry and exit" });
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
