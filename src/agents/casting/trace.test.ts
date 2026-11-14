import { describe, expect, it } from "vitest";
import { CastingTraceRecorder, TRACE_TEXT_MAX, traceText } from "./trace";

/** A clock the test moves by hand. */
function clock() {
  let t = 1_000;
  return { now: () => t, tick: (ms: number) => (t += ms) };
}

function recorded() {
  const c = clock();
  const recorder = new CastingTraceRecorder({ now: c.now });
  c.tick(5);
  const task = recorder.start("subagent", "location-scout", "Apply romaine-1974's filters", "Apply romaine-1974's filters");
  c.tick(3);
  const tool = recorder.start("tool", "location-scout", "search_inventory", { missionId: "romaine-1974", filter: "city" });
  c.tick(2);
  tool(true, '{"left":32}');
  c.tick(10);
  task(true, "Funnel: 61 -> 32");
  recorder.todos("casting-director", [
    { content: "Pick three finalists", status: "completed" },
    { content: "", status: "pending" },
    { content: "Odd status", status: "blocked" },
  ]);
  return recorder;
}

describe("CastingTraceRecorder", () => {
  it("times events from the run's start, in start order, with each one's input and output", () => {
    expect(recorded().toTrace({ model: "scripted", liveData: false })).toEqual({
      model: "scripted",
      liveData: false,
      events: [
        {
          atMs: 5,
          kind: "subagent",
          agent: "location-scout",
          label: "Apply romaine-1974's filters",
          status: "completed",
          durationMs: 15,
          input: "Apply romaine-1974's filters",
          output: "Funnel: 61 -> 32",
        },
        {
          atMs: 8,
          kind: "tool",
          agent: "location-scout",
          label: "search_inventory",
          status: "completed",
          durationMs: 2,
          input: '{"missionId":"romaine-1974","filter":"city"}',
          output: '{"left":32}',
        },
        { atMs: 20, kind: "todo", agent: "casting-director", label: "Pick three finalists", status: "completed" },
        { atMs: 20, kind: "todo", agent: "casting-director", label: "Odd status", status: "pending" },
      ],
    });
  });

  it("on live data, keeps no input, output or model-written label", () => {
    const trace = recorded().toTrace({ liveData: true });
    expect(trace.events.map(({ label, input, output }) => ({ label, input, output }))).toEqual([
      { label: "task location-scout", input: undefined, output: undefined },
      { label: "search_inventory", input: undefined, output: undefined },
      { label: "Todo 1", input: undefined, output: undefined },
      { label: "Todo 2", input: undefined, output: undefined },
    ]);
    expect(trace.liveData).toBe(true);
  });

  it("cuts long text and marks the cut", () => {
    const long = "x".repeat(TRACE_TEXT_MAX + 7);
    expect(traceText(long)).toBe(`${"x".repeat(TRACE_TEXT_MAX)}… [7 more characters not recorded]`);
    expect(traceText({ a: 1 })).toBe('{"a":1}');
  });
});
