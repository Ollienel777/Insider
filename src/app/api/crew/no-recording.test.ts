// The crew route on a kit building (issue 140): its level is in server memory
// and it has no recorded replies, so with the model on fixtures the route
// answers 503 and marks it `code: "no-recording"`, the one 503 the Plan screen
// answers with a plan worked out on the board.
import { afterEach, describe, expect, it } from "vitest";
import { clearKitLevels, levelKey, store } from "@/agents/builder/live-levels";
import { readCachedLevel } from "@/agents/builder/cache";
import { FORCE_COOKIE } from "@/lib/mode";
import { POST } from "./route";

afterEach(() => clearKitLevels());

describe("POST /api/crew on a kit building with no recording", () => {
  it("answers 503 with code no-recording, which the Plan screen's fallback reads", async () => {
    const level = (await readCachedLevel("F1", "romaine-1974"))!;
    store.set(levelKey("900001", "romaine-1974"), {
      status: "built",
      level: { manifest: { ...level.manifest, buildingId: "900001" }, trace: { ...level.trace, buildingId: "900001" } },
    });
    const response = await POST(
      new Request("http://localhost/api/crew", {
        method: "POST",
        // The model forced to fixtures: the crew answers from recordings, and this building has none.
        headers: { cookie: `${FORCE_COOKIE}=llm` },
        body: JSON.stringify({ buildingId: "900001", order: "Go in quietly", missionId: "romaine-1974" }),
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "no-recording" });
  });
});
