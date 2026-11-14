// The browser's side of the batch debrief's fix (issue 127): the Chief's summary
// carries zone ids, never a node; the request carries only that summary and
// the building; and the recorded fix, played again on F1, lowers the count.
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { ChiefFix, FixSummary, LevelManifest, type Strategy } from "@/domain";
import { summariseBatch } from "@/engine";
import { placeLevel } from "@/level/placer";
import cached from "../../../data/levels/F1.json";
import fixRecording from "../../../fixtures/llm/fix-F1.json";
import recording from "../../../fixtures/llm/strategies-F1.json";
import { askFix, fixSummaryOf, playFix, toEngineFix } from "./chief-fix";
import { chiefZones } from "@/components/run/chief-request";
import { playBatch } from "./crew-batch";

const manifest = LevelManifest.parse(structuredClone(cached));
const floor = FIXTURE_FLOORS.F1;
const strategies = recording.strategies as Strategy[];
const recordedFix = ChiefFix.parse(fixRecording.fix);
const batch = playBatch(manifest, floor, { strategies, dropped: [] });
const placed = placeLevel(manifest, floor, batch.seeds[0]);

describe("fixSummaryOf", () => {
  it("gives the Chief the way out by zone, and no node of the floor", () => {
    const summary = fixSummaryOf(summariseBatch(batch), placed);
    expect(FixSummary.parse(summary)).toEqual(summary);
    expect(summary).toMatchObject({ total: 50, escaped: 17 });
    expect(summary.topRoute).toEqual({
      zones: ["dock-N", "freight-lobby", "dock-corridor", "objective", "dock-corridor", "freight-lobby", "dock-N"],
      count: 14,
    });
    const text = JSON.stringify(summary);
    for (const node of floor.nodes) expect(text, node.id).not.toContain(`"${node.id}"`);
  });
});

describe("askFix", () => {
  it("posts only the building and the summary, and parses the answer", async () => {
    const summary = fixSummaryOf(summariseBatch(batch), placed);
    let sent: unknown;
    let url = "";
    const fetch = (async (to: string, init: RequestInit) => {
      url = to;
      sent = JSON.parse(init.body as string);
      return Response.json({ fix: recordedFix, recorded: true, source: "recorded", reason: "fake mode" });
    }) as unknown as typeof globalThis.fetch;
    const answer = await askFix({ buildingId: "F1", summary }, { fetch });
    expect(url).toBe("/api/chief/fix");
    expect(sent).toEqual({ buildingId: "F1", summary });
    expect(answer).toEqual({ fix: recordedFix, recorded: true, source: "recorded", reason: "fake mode" });
  });

  it("throws the server's message", async () => {
    const summary = fixSummaryOf(summariseBatch(batch), placed);
    const fetch = (async () => Response.json({ error: "no cached level" }, { status: 404 })) as unknown as typeof globalThis.fetch;
    await expect(askFix({ buildingId: "F9", summary }, { fetch })).rejects.toThrow("no cached level");
  });
});

describe("playFix on F1", () => {
  it("the recorded fix lowers the success count, the same every time", () => {
    const rerun = playFix(manifest, floor, batch, recordedFix);
    expect(rerun.dropped).toBeNull();
    expect(rerun.before.escaped).toBe(17);
    expect(rerun.after.escaped).toBe(0);
    expect(rerun.after.strip).toHaveLength(50);
    expect(JSON.stringify(playFix(manifest, floor, batch, recordedFix))).toBe(JSON.stringify(rerun));
  });

  it("maps the Chief's zone ids to the engine's", () => {
    const zones = chiefZones(placed);
    const lock = toEngineFix({ change: { kind: "lock-door", elementId: "objective" }, rationale: "x" }, zones);
    expect(lock.change.elementId).toBe(zones.toEngine.get("objective"));
    expect(toEngineFix(recordedFix, zones).change.to).toBe(zones.toEngine.get("dock-corridor"));
  });
});
