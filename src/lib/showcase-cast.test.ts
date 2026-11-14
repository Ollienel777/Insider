// "Cast it" onto a mission's showcase building (#103), on the fictional test
// kit only (src/adapters/costar/test-kit.ts): every record is invented.
import { rmSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetCoStar } from "@/adapters/costar";
import { toKitProperty } from "@/adapters/costar/mapping";
import { fictionalListing, fictionalProperty, smallFictionalKit, writeFictionalKit } from "@/adapters/costar/test-kit";
import { findMission } from "@/agents/builder/missions";
import { clearKitLevels, levelKey, store } from "@/agents/builder/live-levels";
import type { AvailableSpace, Building } from "@/domain";
import { castReasons, showcaseCast } from "./showcase-cast";

const romaine = findMission("romaine-1974")!;
const nightDesk = findMission("night-desk")!;

/** A fictional kit property as the live adapter maps it. */
function kitBuilding(overrides: Record<string, unknown> = {}, spaces: AvailableSpace[] = [], scans: string[] = ["mpTestAAAA001"]): Building {
  const mapped = toKitProperty(fictionalProperty(900001, overrides), { spaces: () => spaces, scans: () => scans });
  if (typeof mapped === "string") throw new Error(`not staged: ${mapped}`);
  return mapped.building;
}

describe("castReasons", () => {
  it("cites each field against the mission's needs, and says where one misses", () => {
    // Testwood Tower: built 1981, Class B, its largest floor 5,120 SF.
    const building = kitBuilding({}, [
      { floor: 6, suite: "600", sf: 2410 },
      { floor: 7, suite: "701", sf: 5120 },
    ]);
    expect(castReasons(building, "office", romaine)).toEqual([
      { need: "in LA", value: "in Los Angeles", status: "match" },
      { need: "built 1974 or earlier", value: "built 1981", status: "miss" },
      { need: "office", value: "office", status: "match" },
      { need: "Class A or B", value: "Class B", status: "match" },
      { need: "a floor with 10,000 SF or more on the market", value: "floor 7: 5,120 SF on the market", status: "miss" },
      { need: "a Matterport scan", value: "a Matterport scan", status: "match" },
      { need: "a dock or service entry on the aerial", value: "no aerial on record", status: "unknown" },
    ]);
  });

  it("says so when a mission that needs Class A is cast onto a Class B building", () => {
    const reasons = castReasons(kitBuilding({ buildingClass: 2 }), "office", nightDesk);
    expect(reasons.find((r) => r.need === "Class A")).toEqual({ need: "Class A", value: "Class B", status: "miss" });
  });

  it("fits every need the record can answer for a building that matches", () => {
    const building = kitBuilding(
      { buildingClass: 1, constructionEvents: [{ eventType: 2, year: 1968, month: null }] },
      [
        { floor: 12, suite: "1200", sf: 6000 },
        { floor: 12, suite: "1210", sf: 6200 },
      ],
    );
    const reasons = castReasons(building, "office", romaine);
    expect(reasons.filter((r) => r.status !== "match").map((r) => r.need)).toEqual(["a dock or service entry on the aerial"]);
    expect(reasons.find((r) => r.need.startsWith("a floor"))?.value).toBe("floor 12: 12,200 SF on the market");
  });

  it("reads an unknown property type, no space and no scan honestly", () => {
    const reasons = castReasons(kitBuilding({}, [], []), null, romaine);
    expect(reasons.find((r) => r.need === "office")).toMatchObject({ value: "property type not on record", status: "unknown" });
    expect(reasons.find((r) => r.need.startsWith("a floor"))).toMatchObject({ value: "nothing on the market", status: "miss" });
    expect(reasons.find((r) => r.need === "a Matterport scan")).toMatchObject({ value: "no Matterport scan", status: "miss" });
  });
});

describe("showcaseCast", () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetCoStar();
    clearKitLevels();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function live(showcase: string, dir = smallFictionalKit()) {
    dirs.push(dir);
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubEnv("HEIST_MODE", "");
    vi.stubEnv("COSTAR_MODE", "live");
    vi.stubEnv("COSTAR_KIT_DIR", dir);
    vi.stubEnv("SHOWCASE_LEVELS", showcase);
    resetCoStar();
  }

  /** The model live, as the build route needs it; a placeholder key, never a real one. */
  function modelLive() {
    vi.stubEnv("LLM_MODE", "live");
    vi.stubEnv("LLM_PROVIDER", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-placeholder");
  }

  it("casts a mission onto its showcase building, with its kit record's reasons", async () => {
    live("900001:romaine-1974");
    modelLive();
    const cast = await showcaseCast(romaine);
    expect(cast).toMatchObject({ id: "900001", name: "Testwood Tower 900001", city: "LA", yearBuilt: 1981, buildingClass: "B", level: "none" });
    // The property type comes from the kit record, which `Building` does not carry.
    expect(cast?.reasons.find((r) => r.need === "office")).toEqual({ need: "office", value: "office", status: "match" });
    expect(cast?.reasons.find((r) => r.need === "built 1974 or earlier")?.status).toBe("miss");
  });

  it("never carries a broker's or an agent's name", async () => {
    const dir = writeFictionalKit({
      properties: [fictionalProperty(900001, { contacts: [{ name: "Brokerly Person", phone: "555-0100" }] })],
      listings: [fictionalListing(700001, 900001, [{}], { listingContacts: [{ name: "Agently Person" }] })],
      scans: [[900001, "mpTestAAAA001"]],
    });
    live("900001:romaine-1974", dir);
    const json = JSON.stringify(await showcaseCast(romaine));
    expect(json).toContain("900001");
    expect(json).not.toMatch(/Brokerly|Agently|555-0100|contact/i);
  });

  it("says the level is ready once it is built in memory, whatever the model", async () => {
    live("900001:romaine-1974");
    store.set(levelKey("900001", "romaine-1974"), { status: "built", level: {} as never });
    expect((await showcaseCast(romaine))?.level).toBe("built");
    expect((await showcaseCast(romaine, { modelForced: true }))?.level).toBe("built");
  });

  it("says the level is building while a build runs, whatever the model", async () => {
    live("900001:romaine-1974");
    store.set(levelKey("900001", "romaine-1974"), { status: "building", promise: new Promise(() => {}) });
    expect((await showcaseCast(romaine))?.level).toBe("building");
    expect((await showcaseCast(romaine, { modelForced: true }))?.level).toBe("building");
  });

  it("says the last build failed, with the model live", async () => {
    live("900001:romaine-1974");
    modelLive();
    store.set(levelKey("900001", "romaine-1974"), { status: "failed", error: "the model timed out", at: 0 });
    const cast = await showcaseCast(romaine);
    expect(cast?.level).toBe("failed");
    // The card says the Dossier has why; the error itself stays on the server.
    expect(JSON.stringify(cast)).not.toContain("timed out");
  });

  it("says no build can run while the model is on fixtures, configured or forced", async () => {
    live("900001:romaine-1974");
    vi.stubEnv("LLM_MODE", "fake");
    expect((await showcaseCast(romaine))?.level).toBe("model-fixtures");
    // Asked live but missing its key: still fixtures.
    vi.stubEnv("LLM_MODE", "live");
    vi.stubEnv("LLM_PROVIDER", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect((await showcaseCast(romaine))?.level).toBe("model-fixtures");
    modelLive();
    expect((await showcaseCast(romaine, { modelForced: true }))?.level).toBe("model-forced");
    // A failed build reads the same: the Dossier can't retry it either.
    store.set(levelKey("900001", "romaine-1974"), { status: "failed", error: "x", at: 0 });
    expect((await showcaseCast(romaine, { modelForced: true }))?.level).toBe("model-forced");
  });

  it("is null, with a warning naming the pair's position, when the list pairs the building with another city's mission", async () => {
    live("900002:romaine-1974,900001:paper-trail-2001");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await showcaseCast(findMission("paper-trail-2001")!)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/pair 2 names paper-trail-2001, which is not staged/);
    expect(warn.mock.calls[0][0]).not.toContain("900001");
  });

  it("is null for a mission with no showcase building, or a listed building the kit lacks", async () => {
    live("900001:romaine-1974,123456:night-desk");
    expect(await showcaseCast(findMission("sunset-1986")!)).toBeNull();
    expect(await showcaseCast(nightDesk)).toBeNull();
  });

  it("is null with CoStar forced to fixtures, and in fake mode", async () => {
    live("900001:romaine-1974");
    expect(await showcaseCast(romaine, { forced: true })).toBeNull();
    vi.stubEnv("COSTAR_MODE", "fake");
    resetCoStar();
    expect(await showcaseCast(romaine)).toBeNull();
  });
});
