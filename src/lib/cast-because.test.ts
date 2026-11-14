// Why a building was cast (beat 4, issue 119): the Casting Director's
// shortlist when one is cached and lists the building; otherwise, and when
// the shortlist is unreadable, a reason derived from the mission's filters.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { findMission } from "@/agents/builder/missions";
import { type CastingResult, Inventory } from "@/domain";
import raw from "../../fixtures/inventory.json";
import { castFinalist, deriveCandidate } from "./cast-because";

const romaine = findMission("romaine-1974")!;
const inventory = Inventory.parse(raw);
const derived = (id: string) => deriveCandidate(inventory.find((p) => p.id === id)!, romaine)!;
const shortlist = (ids: string[]): CastingResult => ({
  missionId: "romaine-1974",
  funnel: [
    { label: "the inventory", count: inventory.length },
    { label: "in LA", count: 3 },
  ],
  finalists: ids.map((id) => ({ ...derived(id), reason: `the agent's reason for ${id}` })),
  trace: { events: [{ atMs: 0, kind: "todo", agent: "casting-director", label: "Read the mission", status: "completed" }] },
  source: "fixture",
});

const dir = mkdtempSync(path.join(tmpdir(), "casting-"));
const write = (content: string) => writeFileSync(path.join(dir, "romaine-1974.json"), content);
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());

describe("castFinalist", () => {
  it("with no shortlist cached, derives the reason from the mission's filters", async () => {
    expect(await castFinalist(romaine, "F1", dir)).toEqual({ candidate: derived("F1"), source: "derived" });
    expect(derived("F1").reason).toBe("built 1974, Class A, floor 22 on the market, dock on the aerial");
  });

  it("reads the shortlist's finalist, its reason the agent's own", async () => {
    write(JSON.stringify(shortlist(["F1", "L01", "L02"])));
    const found = await castFinalist(romaine, "F1", dir);
    expect(found?.source).toBe("shortlist");
    expect(found?.candidate.reason).toBe("the agent's reason for F1");
  });

  it("falls back to the derived reason when the shortlist does not list the building", async () => {
    write(JSON.stringify(shortlist(["L01", "L02", "L03"])));
    expect(await castFinalist(romaine, "F1", dir)).toEqual({ candidate: derived("F1"), source: "derived" });
  });

  it("falls back to the derived reason, and logs it on the server, when the shortlist is unreadable", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const bad of ["{not json", JSON.stringify({ missionId: "romaine-1974" })]) {
      write(bad);
      expect(await castFinalist(romaine, "F1", dir)).toEqual({ candidate: derived("F1"), source: "derived" });
    }
    expect(log).toHaveBeenCalledTimes(2);
    expect(String(log.mock.calls[0][0])).toMatch(/shortlist for romaine-1974 is unreadable/);
  });

  it("is null for a building the inventory does not hold", async () => {
    rmSync(path.join(dir, "romaine-1974.json"), { force: true });
    expect(await castFinalist(romaine, "X9", dir)).toBeNull();
  });
});
