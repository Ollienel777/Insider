// The browser's side of the batch (#126): the request carries only the ids,
// and the server's drops and the board's are reported together.
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { LevelManifest, type Strategy } from "@/domain";
import cached from "../../../data/levels/F1.json";
import recording from "../../../fixtures/llm/strategies-F1.json";
import { askStrategies, playBatch } from "./crew-batch";

const manifest = LevelManifest.parse(structuredClone(cached));
const strategies = recording.strategies as Strategy[];

describe("askStrategies", () => {
  it("posts only the building and setup ids, and parses the answer", async () => {
    let sent: unknown;
    const fetch = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string);
      return Response.json({ strategies, dropped: [{ strategyId: "x", reason: "no" }], recorded: true, reason: "fake mode" });
    }) as unknown as typeof globalThis.fetch;
    const answer = await askStrategies({ buildingId: "F1", setupId: "s1" }, { fetch });
    expect(sent).toEqual({ buildingId: "F1", setupId: "s1" });
    expect(answer).toMatchObject({ recorded: true, reason: "fake mode", dropped: [{ strategyId: "x", reason: "no" }] });
    expect(answer.strategies).toHaveLength(5);
  });

  it("throws the server's message", async () => {
    const fetch = (async () => Response.json({ error: "no cached level" }, { status: 404 })) as unknown as typeof globalThis.fetch;
    await expect(askStrategies({ buildingId: "F9" }, { fetch })).rejects.toThrow("no cached level");
  });
});

describe("playBatch", () => {
  it("plays the batch on the floor, the server's drops before the board's", () => {
    const garage = { ...strategies[0], id: "garage", entryId: "garage-E" };
    const result = playBatch(
      manifest,
      FIXTURE_FLOORS.F1,
      { strategies: [...strategies, garage], dropped: [{ strategyId: "sewer", reason: "not an entry" }] },
      [1, 2],
    );
    expect(result.runs).toHaveLength(10);
    expect(result.dropped.map((d) => d.strategyId)).toEqual(["sewer", "garage"]);
  });
});
