// The crew route on a kit building (issue 140): its level is in server memory
// and it has no recorded replies, so with the model on fixtures the route
// answers 503 and marks it `code: "no-recording"`, the one 503 the Plan screen
// answers with a plan worked out on the board.
import { afterEach, describe, expect, it } from "vitest";
import { ScriptedChatModel } from "@/adapters/llm";
import { briefCrew, NoRecordingError } from "@/agents/crew";
import { clearKitLevels, levelKey, store } from "@/agents/builder/live-levels";
import { readCachedLevel } from "@/agents/builder/cache";
import { FORCE_COOKIE } from "@/lib/mode";
import { POST } from "./route";

afterEach(() => clearKitLevels());

/** A kit building's stand-in: F1's level stored in memory under a kit id, as the Level Builder leaves one. */
async function storeKitLevel(): Promise<void> {
  const level = (await readCachedLevel("F1", "romaine-1974"))!;
  store.set(levelKey("900001", "romaine-1974"), {
    status: "built",
    level: { manifest: { ...level.manifest, buildingId: "900001" }, trace: { ...level.trace, buildingId: "900001" } },
  });
}

describe("POST /api/crew on a kit building with no recording", () => {
  it("answers 503 with code no-recording, which the Plan screen's fallback reads", async () => {
    await storeKitLevel();
    const response = await POST(
      new Request("http://localhost/api/crew", {
        method: "POST",
        // The model forced to fixtures: the crew answers from recordings, and this building has none.
        headers: { cookie: `${FORCE_COOKIE}=llm` },
        body: JSON.stringify({ buildingId: "900001", order: "Go in quietly", missionId: "romaine-1974" }),
      }),
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ code: "no-recording", reason: "fake mode" });
    // With the model off nothing fell back, so there is no toast to raise.
    expect(body.fallback).toBeUndefined();
  });

  it("says why a live call left no reply: the error carries the reason the recording was asked for", async () => {
    await storeKitLevel();
    const model = new ScriptedChatModel({ script: { id: "empty", agents: [{ agent: "other", systemIncludes: "nobody", turns: [{ content: "" }] }] } });
    const brief = briefCrew("900001", "Go in quietly", {
      missionId: "romaine-1974",
      selection: { model, mode: "live", provider: "anthropic", reason: "test" },
    });
    await expect(brief).rejects.toBeInstanceOf(NoRecordingError);
    await expect(brief).rejects.toMatchObject({ reason: "error" });
  });

  it("marks a 404 for a level the server no longer holds, so the Plan screen can still work one out (issue 142)", async () => {
    // Nothing stored: a restarted server, or another instance, has lost the kit level.
    const response = await POST(
      new Request("http://localhost/api/crew", {
        method: "POST",
        headers: { cookie: `${FORCE_COOKIE}=llm` },
        body: JSON.stringify({ buildingId: "900001", order: "Go in quietly", missionId: "romaine-1974" }),
      }),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "no-level" });
  });
});
