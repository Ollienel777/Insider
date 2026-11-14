// A building screen's mission from `?m=` (#119): kept when it names a
// mission, a 404 when it names none, and with no `m` the building's own
// mission, by a redirect that puts it in the address.
import { describe, expect, it } from "vitest";
import { missionParam, optionalMissionParam } from "./mission-param";

const params = (query: Record<string, string | string[] | undefined>) => Promise.resolve(query);
/** What next/navigation's redirect() and notFound() throw, as a string to match. */
const thrown = (promise: Promise<unknown>) =>
  promise.then(
    () => "resolved",
    (error: { digest?: string }) => String(error.digest),
  );

describe("missionParam", () => {
  it("keeps the mission the address names", async () => {
    expect(await missionParam("F1", "run", params({ m: "romaine-1974" }))).toBe("romaine-1974");
    // Another mission on the same building is still that mission: its level may simply not exist yet.
    expect(await missionParam("F1", "run", params({ m: "night-desk" }))).toBe("night-desk");
  });

  it("with no m, redirects to the same screen with the building's own mission (F1 → romaine-1974)", async () => {
    expect(await thrown(missionParam("F1", "dossier", params({})))).toMatch(/^NEXT_REDIRECT;replace;\/b\/F1\/dossier\?m=romaine-1974;/);
    expect(await thrown(missionParam("F4", "scout", params({ m: "" })))).toMatch(/\/b\/F4\/scout\?m=paper-trail-2001;/);
  });

  it("is a 404 for an m that names no mission", async () => {
    expect(await thrown(missionParam("F1", "run", params({ m: "no-such-mission" })))).toMatch(/NOT_FOUND|404/);
  });

  it("is a 404 for a building with no own mission (L01, a live id) and no m; with one, it keeps it", async () => {
    expect(await thrown(missionParam("L01", "scout", params({})))).toMatch(/NOT_FOUND|404/);
    expect(await missionParam("L01", "scout", params({ m: "romaine-1974" }))).toBe("romaine-1974");
  });

  it("reads the first of a repeated m", async () => {
    expect(await missionParam("F1", "run", params({ m: ["romaine-1974", "night-desk"] }))).toBe("romaine-1974");
    expect(await thrown(missionParam("F1", "run", params({ m: ["bogus", "romaine-1974"] })))).toMatch(/NOT_FOUND|404/);
  });

  it("tolerant (Drill, which reads no level), keeps an m that names no mission instead of a 404", async () => {
    expect(await missionParam("F1", "drill", params({ m: "typo" }), { tolerant: true })).toBe("typo");
    expect(await thrown(missionParam("F1", "drill", params({}), { tolerant: true }))).toMatch(/\/b\/F1\/drill\?m=romaine-1974;/);
  });
});

describe("optionalMissionParam (Scout and the Dossier's facts)", () => {
  it("is null, not a 404, for a building with no own mission and no m (a kit pin from the map)", async () => {
    expect(await optionalMissionParam("900001", "scout", params({}))).toBeNull();
    expect(await optionalMissionParam("900001", "dossier", params({ m: "" }))).toBeNull();
  });

  it("otherwise behaves as missionParam", async () => {
    expect(await optionalMissionParam("900001", "dossier", params({ m: "romaine-1974" }))).toBe("romaine-1974");
    expect(await thrown(optionalMissionParam("F1", "scout", params({})))).toMatch(/\/b\/F1\/scout\?m=romaine-1974;/);
    expect(await thrown(optionalMissionParam("900001", "scout", params({ m: "no-such-mission" })))).toMatch(/NOT_FOUND|404/);
  });
});
