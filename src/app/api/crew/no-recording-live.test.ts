// The crew route on a kit building when the live model fails (issue 140): the
// 503 carries the reason and the model's fallback, whose toast says the board
// stands in, since this building has no recording to.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScriptedChatModel } from "@/adapters/llm";
import { clearKitLevels, levelKey, store } from "@/agents/builder/live-levels";
import { readCachedLevel } from "@/agents/builder/cache";
import { getStatus, noteResponse, resetStatus } from "@/lib/demo-status";

// A live model that fails every call: what LLM_MODE=live with a dead model looks like to the route.
vi.mock("@/adapters/llm/select", async (original) => ({
  ...(await original<typeof import("@/adapters/llm/select")>()),
  getChatModelSelection: () => ({
    model: new ScriptedChatModel({ script: { id: "empty", agents: [{ agent: "other", systemIncludes: "nobody", turns: [{ content: "" }] }] } }),
    mode: "live",
    provider: "anthropic",
    reason: "test",
  }),
}));

const { POST } = await import("./route");

afterEach(() => {
  clearKitLevels();
  resetStatus();
});

describe("POST /api/crew on a kit building when the live model fails", () => {
  it("answers 503 no-recording with the reason, and a toast that says the board stands in", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const level = (await readCachedLevel("F1", "romaine-1974"))!;
    store.set(levelKey("900002", "romaine-1974"), {
      status: "built",
      level: { manifest: { ...level.manifest, buildingId: "900002" }, trace: { ...level.trace, buildingId: "900002" } },
    });
    const response = await POST(
      new Request("http://localhost/api/crew", {
        method: "POST",
        body: JSON.stringify({ buildingId: "900002", order: "Go in quietly", missionId: "romaine-1974" }),
      }),
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as { code: string; reason: string; fallback: { service: string; message: string } };
    expect(body).toMatchObject({ code: "no-recording", reason: "error" });
    expect(body.fallback).toMatchObject({ service: "llm", message: "The model didn't answer, so the plan is worked out from the board." });
    expect(body.fallback.message).not.toContain("recorded");
    // The browser toasts exactly that line.
    noteResponse(body);
    expect(getStatus().toasts.map((t) => t.message)).toEqual([body.fallback.message]);
    warn.mockRestore();
  });
});
