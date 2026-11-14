import { describe, expect, it } from "vitest";
import { TraceRecorder } from "./trace";

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
});
