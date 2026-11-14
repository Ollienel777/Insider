import { ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { TRACE_TEXT_MAX, TraceRecorder, traceText } from "./trace";

/** A clock the test moves by hand. */
function clock() {
  let t = 1_000;
  return { now: () => t, tick: (ms: number) => (t += ms) };
}

describe("TraceRecorder", () => {
  it("times events from the run's start and orders them by when they started", () => {
    const c = clock();
    const recorder = new TraceRecorder({ now: c.now });
    c.tick(5);
    const task = recorder.start("subagent", "data-analyst", "Derive F1's security");
    c.tick(3);
    const tool = recorder.start("tool", "data-analyst", "get_building");
    c.tick(2);
    tool(true);
    c.tick(10);
    task(true);
    recorder.todos("level-builder", [
      { content: "Write the manifest", status: "completed" },
      { content: "", status: "pending" },
      { content: "Odd status", status: "blocked" },
    ]);
    const failed = recorder.start("tool", "level-builder", "write_manifest");
    c.tick(1);
    failed(false);

    expect(recorder.toTrace("F1", { model: "scripted" })).toEqual({
      buildingId: "F1",
      model: "scripted",
      events: [
        { atMs: 5, kind: "subagent", agent: "data-analyst", label: "Derive F1's security", status: "completed", durationMs: 15 },
        { atMs: 8, kind: "tool", agent: "data-analyst", label: "get_building", status: "completed", durationMs: 2 },
        { atMs: 20, kind: "todo", agent: "level-builder", label: "Write the manifest", status: "completed" },
        { atMs: 20, kind: "todo", agent: "level-builder", label: "Odd status", status: "pending" },
        { atMs: 20, kind: "tool", agent: "level-builder", label: "write_manifest", status: "failed", durationMs: 1 },
      ],
    });
  });

  it("leaves an unfinished event in progress", () => {
    const recorder = new TraceRecorder({ now: () => 0 });
    recorder.start("tool", "game-master", "list_missions");
    expect(recorder.toTrace("F1").events[0]).toMatchObject({ status: "in_progress" });
    expect(recorder.toTrace("F1").events[0].durationMs).toBeUndefined();
  });

  it("keeps what a call was given and what it returned, and leaves both off when there was nothing", () => {
    const recorder = new TraceRecorder({ now: () => 0 });
    recorder.start("tool", "data-analyst", "get_building", '{"buildingId":"F1"}')(true, '{"id":"F1"}');
    recorder.start("subagent", "general-purpose", "Look around", "Look around")(false, "Error: it failed");
    recorder.start("tool", "level-builder", "write_manifest", "")(true);
    const [tool, task, bare] = recorder.toTrace("F1").events;
    expect(tool).toMatchObject({ input: '{"buildingId":"F1"}', output: '{"id":"F1"}' });
    expect(task).toMatchObject({ agent: "general-purpose", status: "failed", output: "Error: it failed" });
    expect(bare).not.toHaveProperty("input");
    expect(bare).not.toHaveProperty("output");
  });
});

describe("TraceRecorder on live data (SPEC §4.5)", () => {
  it("keeps no input or output when recordPayloads is false, and still times and labels each call", () => {
    const recorder = new TraceRecorder({ now: () => 0, recordPayloads: false });
    recorder.start("tool", "data-analyst", "get_building", '{"buildingId":"B9"}')(true, '{"name":"A kit record"}');
    recorder.start("subagent", "data-analyst", "Read B9", "Read B9")(false, "Error: it failed", "thrown");
    recorder.todos("level-builder", [
      { content: "Read Tower B9, built 1961", status: "completed" },
      { content: "", status: "pending" },
      { content: "Stage on floor 40", status: "in_progress" },
    ]);
    const events = recorder.toTrace("B9").events;
    expect(events.map((e) => [e.label, e.status])).toEqual([
      ["get_building", "completed"],
      ["Read B9", "failed"],
      ["Step 1 of 2", "completed"],
      ["Step 2 of 2", "in_progress"],
    ]);
    for (const event of events) {
      expect(event).not.toHaveProperty("input");
      expect(event).not.toHaveProperty("output");
    }
  });
});

describe("the recorder's middleware on live data", () => {
  it("labels a task with its subagent's name only, never the model's brief", async () => {
    const recorder = new TraceRecorder({ now: () => 0, recordPayloads: false });
    const middleware = recorder.middleware("level-builder") as unknown as {
      wrapToolCall: (request: unknown, handler: () => Promise<unknown>) => Promise<unknown>;
    };
    const brief = (subagent_type: string) => ({ toolCall: { name: "task", args: { subagent_type, description: "Tower B9, built 1961" }, id: "t" } });
    await middleware.wrapToolCall(brief("data-analyst"), () => Promise.resolve("Tower B9 is analog"));
    await middleware.wrapToolCall(brief("made-up"), () => Promise.reject(new Error("Tower B9 refused")));
    const trace = recorder.toTrace("B9");
    expect(trace.events.map((e) => e.label)).toEqual(["Run data-analyst", "Run a subagent"]);
    expect(JSON.stringify(trace)).not.toMatch(/Tower|1961/);
  });
});

describe("the recorder's middleware on a failed task (R1-M1)", () => {
  /** Runs one `task` call through the middleware, answered by `handler`. */
  async function task(handler: () => Promise<unknown>) {
    const recorder = new TraceRecorder({ now: () => 0 });
    const middleware = recorder.middleware("level-builder") as unknown as {
      wrapToolCall: (request: unknown, handler: () => Promise<unknown>) => Promise<unknown>;
    };
    const toolCall = { name: "task", args: { subagent_type: "game-master", description: "Pick it" }, id: "t1" };
    const result = await middleware.wrapToolCall({ toolCall }, handler);
    return { event: recorder.toTrace("F1").events[0], result };
  }

  it("records a task that throws as the subagent's run failing", async () => {
    const { event, result } = await task(() => Promise.reject(new Error("model gave up")));
    expect(event).toMatchObject({ kind: "subagent", agent: "game-master", status: "failed", failure: "thrown" });
    expect(event.output).toBe("Error: the game-master subagent's run failed: model gave up");
    expect(ToolMessage.isInstance(result) && result.status).toBe("error");
  });

  it("records a task that returns an error result as a returned error, not a failed run", async () => {
    const error = new ToolMessage({ content: "Error: refused", tool_call_id: "t1", name: "task", status: "error" });
    const { event } = await task(() => Promise.resolve(error));
    expect(event).toMatchObject({ kind: "subagent", status: "failed", failure: "returned", output: "Error: refused" });
  });
});

describe("traceText", () => {
  it("keeps text up to TRACE_TEXT_MAX characters whole, and cuts longer text saying how much it dropped", () => {
    expect(traceText("short")).toBe("short");
    expect(traceText("")).toBeUndefined();
    const long = "x".repeat(TRACE_TEXT_MAX + 25);
    expect(traceText(long)).toBe(`${"x".repeat(TRACE_TEXT_MAX)}… [25 more characters not recorded]`);
  });
});
