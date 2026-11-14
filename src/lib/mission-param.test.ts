// A building screen's mission from `?m=` (#119): kept when it names a
// mission, a 404 when it names none, and with no `m` the building's own
// mission, by a redirect that puts it in the address.
import { describe, expect, it } from "vitest";
import { missionParam } from "./mission-param";

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

  it("leaves a building that no mission casts first without one", async () => {
    expect(await missionParam("L01", "scout", params({}))).toBeNull();
  });
});
