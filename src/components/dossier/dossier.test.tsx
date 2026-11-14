import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FIXTURE_BUILDINGS } from "@/adapters/costar/fake";
import { BuildTrace, LevelManifest, type BuildTraceEvent } from "@/domain";
import { dataToLevelRows, suiteRange } from "./data-to-level";
import { DISCLAIMER, DossierScreen } from "./dossier-screen";
import { StepDetail, TraceList } from "./trace-list";
import { dossierFacts } from "./facts";
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

describe("the Recorded replay header", () => {
  it("says it is a recorded replay, when, and whose model turns: a script's, no LLM (R1-M5)", () => {
    expect(recordedRunHeader(trace)).toMatch(
      /^Recorded replay · [A-Z][a-z]{2} \d{1,2}, \d{4}, \d\d:\d\d UTC · model turns: scripted \(builder-F1\), no LLM ran$/,
    );
    expect(formatRecordedAt("2026-11-13T11:39:34.402Z")).toBe("Nov 13, 2026, 11:39 UTC");
  });

  it("says so when the trace did not record either", () => {
    expect(recordedRunHeader({})).toBe("Recorded replay · time not recorded · model turns: not recorded");
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
