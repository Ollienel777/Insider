import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LEVELS_DIR, readCachedLevel, writeCachedLevel } from "@/agents/builder/cache";
import { defaultMissionId } from "@/agents/builder/missions";
import { BuildTrace, LevelManifest } from "@/domain";
import { GET } from "./route";

const get = (id: string, query = "") =>
  GET(new Request(`http://localhost/api/levels/${id}${query}`), { params: Promise.resolve({ id }) });

describe("GET /api/levels/[id]?m=", () => {
  it("returns F1's cached manifest and trace for romaine-1974", async () => {
    const response = await get("F1", "?m=romaine-1974");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { manifest: unknown; trace: unknown };
    const manifest = LevelManifest.parse(body.manifest);
    const trace = BuildTrace.parse(body.trace);
    expect(manifest.buildingId).toBe("F1");
    expect(manifest.missionId).toBe("romaine-1974");
    expect(manifest.mission.id).toBe("romaine-1974");
    expect(trace.buildingId).toBe("F1");
    expect(trace.events.filter((e) => e.kind === "subagent")).toHaveLength(2);
  });

  it("with no m, serves the building's own mission (F1 → romaine-1974)", async () => {
    expect(defaultMissionId("F1")).toBe("romaine-1974");
    const response = await get("F1");
    expect(response.status).toBe(200);
    expect(((await response.json()) as { manifest: LevelManifest }).manifest.missionId).toBe("romaine-1974");
  });

  it("answers 404 for a pair with no cached level, and for an id that is not a plain name", async () => {
    for (const [id, query] of [
      ["F9", ""],
      ["F1", "?m=sunset-1986"],
      ["F1", "?m=..%2Fpackage"],
      ["..%2Fpackage", ""],
      ["../package", "?m=romaine-1974"],
    ]) {
      const response = await get(id, query);
      expect(response.status, `${id}${query}`).toBe(404);
    }
  });
  it("never tells a kit building to run build:levels", async () => {
    const response = await get("900001", "?m=romaine-1974");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'no level for building "900001": only fixture buildings have levels' });
    expect(await (await get("F1", "?m=sunset-1986")).json()).toEqual({
      error: 'no cached level for building "F1" and mission "sunset-1986"; run npm run build:levels',
    });
  });
});

describe("readCachedLevel, keyed by building and mission", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "levels-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("reads and writes <building>.<mission>.json and its .trace.json", async () => {
    const level = (await readCachedLevel("F1", "romaine-1974"))!;
    expect(await writeCachedLevel(level, dir)).toEqual([
      path.join(dir, "F1.romaine-1974.json"),
      path.join(dir, "F1.romaine-1974.trace.json"),
    ]);
    expect(await readCachedLevel("F1", "romaine-1974", dir)).toEqual(level);
    expect(await readCachedLevel("F1", "sunset-1986", dir)).toBeNull();
  });

  it("reads a level whose briefing breaks the rules, but never writes one", async () => {
    const level = (await readCachedLevel("F1", "romaine-1974"))!;
    const long = { ...level, manifest: { ...level.manifest, mission: { ...level.manifest.mission, briefing: "In by the dock." } } };
    await expect(writeCachedLevel(long, dir)).rejects.toThrow("not writing F1.romaine-1974: the briefing must say its security is game fiction");
    writeFileSync(path.join(dir, "F1.romaine-1974.json"), JSON.stringify(long.manifest));
    expect((await readCachedLevel("F1", "romaine-1974", dir))?.manifest.mission.briefing).toBe("In by the dock.");
  });

  it("never writes a level for a building that is not a fixture: a kit building's level is kit-derived (#2)", async () => {
    const level = (await readCachedLevel("F1", "romaine-1974"))!;
    // A fictional kit id, not a CoStar record.
    const kit = { ...level, manifest: { ...level.manifest, buildingId: "900001" } };
    await expect(writeCachedLevel(kit, dir)).rejects.toThrow("not writing 900001: only fixture buildings get a cached level");
    expect(existsSync(path.join(dir, "900001.romaine-1974.json"))).toBe(false);
  });

  it("refuses a file that holds another pair", async () => {
    copyFileSync(path.join(LEVELS_DIR, "F1.romaine-1974.json"), path.join(dir, "F1.night-desk.json"));
    copyFileSync(path.join(LEVELS_DIR, "F1.romaine-1974.trace.json"), path.join(dir, "F1.night-desk.trace.json"));
    await expect(readCachedLevel("F1", "night-desk", dir)).rejects.toThrow("holds F1.romaine-1974");
  });

  it("refuses a manifest that fails its schema", async () => {
    writeFileSync(path.join(dir, "X1.m.json"), JSON.stringify({ buildingId: "X1" }));
    writeFileSync(path.join(dir, "X1.m.trace.json"), JSON.stringify({ buildingId: "X1", events: [] }));
    await expect(readCachedLevel("X1", "m", dir)).rejects.toThrow();
  });

  it("is null when either file is missing", async () => {
    writeFileSync(path.join(dir, "X2.m.json"), "{}");
    expect(await readCachedLevel("X2", "m", dir)).toBeNull();
  });
});
