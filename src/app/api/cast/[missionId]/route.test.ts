import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readCachedCasting } from "@/agents/casting/cache";
import { CastingResult } from "@/domain";
import expected from "../../../../../fixtures/inventory-finalists.json";
import { GET } from "./route";

const get = (missionId: string) =>
  GET(new Request(`http://localhost/api/cast/${missionId}`), { params: Promise.resolve({ missionId }) });

beforeAll(() => {
  vi.stubEnv("HEIST_MODE", "fake");
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/cast/[missionId]", () => {
  it.each(Object.entries(expected))("serves %s's cached shortlist and trace", async (id, finalists) => {
    const response = await get(id);
    expect(response.status).toBe(200);
    const result = CastingResult.parse(await response.json());
    expect(result.missionId).toBe(id);
    expect(result.finalists.map((c) => c.id)).toEqual(finalists);
    expect(result.trace.events.some((e) => e.kind === "subagent" && e.agent === "location-scout")).toBe(true);
  });

  it("answers 404 for a mission with no cached shortlist", async () => {
    const response = await get("no-such-mission");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "no cached shortlist for this mission; run npm run cast" });
  });

  it("answers 400, with a fixed message, for an id that is not a plain name", async () => {
    for (const id of ["../package", "..%2Fpackage", "a b", ""]) {
      const response = await get(id);
      expect(response.status, id).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid mission id" });
    }
  });
});

describe("readCachedCasting", () => {
  const root = mkdtempSync(path.join(tmpdir(), "casting-"));
  const [live, fake] = [path.join(root, "live"), path.join(root, "fake")];
  mkdirSync(live);
  mkdirSync(fake);
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const committed = JSON.parse(readFileSync(path.join(process.cwd(), "data", "casting", "romaine-1974.json"), "utf8"));

  it("reads the first directory that has the mission, and is null when none does", async () => {
    writeFileSync(path.join(fake, "romaine-1974.json"), JSON.stringify(committed));
    expect((await readCachedCasting("romaine-1974", [live, fake]))?.missionId).toBe("romaine-1974");
    expect(await readCachedCasting("sunset-1986", [live, fake])).toBeNull();
    writeFileSync(path.join(live, "romaine-1974.json"), JSON.stringify({ ...committed, funnel: committed.funnel.slice(0, 2) }));
    expect((await readCachedCasting("romaine-1974", [live, fake]))?.funnel).toHaveLength(2);
  });

  it("refuses a file that fails its schema or holds another mission", async () => {
    writeFileSync(path.join(fake, "X1.json"), JSON.stringify({ missionId: "X1" }));
    await expect(readCachedCasting("X1", [fake])).rejects.toThrow();
    writeFileSync(path.join(fake, "X2.json"), JSON.stringify(committed));
    await expect(readCachedCasting("X2", [fake])).rejects.toThrow(/holds mission romaine-1974/);
  });
});
