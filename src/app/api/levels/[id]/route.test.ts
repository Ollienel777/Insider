import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readCachedLevel } from "@/agents/builder/cache";
import { BuildTrace, LevelManifest } from "@/domain";
import { GET } from "./route";

const get = (id: string) => GET(new Request(`http://localhost/api/levels/${id}`), { params: Promise.resolve({ id }) });

describe("GET /api/levels/[id]", () => {
  it("returns F1's cached manifest and trace", async () => {
    const response = await get("F1");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { manifest: unknown; trace: unknown };
    const manifest = LevelManifest.parse(body.manifest);
    const trace = BuildTrace.parse(body.trace);
    expect(manifest.buildingId).toBe("F1");
    expect(manifest.mission.id).toBe("romaine-1974");
    expect(trace.buildingId).toBe("F1");
    expect(trace.events.filter((e) => e.kind === "subagent")).toHaveLength(2);
  });

  it("answers 404 for a building with no cached level, and for an id that is not a plain name", async () => {
    for (const id of ["F9", "..%2Fpackage", "../package"]) {
      const response = await get(id);
      expect(response.status, id).toBe(404);
    }
  });
});

describe("readCachedLevel", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "levels-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("refuses a manifest that fails its schema", async () => {
    writeFileSync(path.join(dir, "X1.json"), JSON.stringify({ buildingId: "X1" }));
    writeFileSync(path.join(dir, "X1.trace.json"), JSON.stringify({ buildingId: "X1", events: [] }));
    await expect(readCachedLevel("X1", dir)).rejects.toThrow();
  });

  it("is null when either file is missing", async () => {
    writeFileSync(path.join(dir, "X2.json"), "{}");
    expect(await readCachedLevel("X2", dir)).toBeNull();
  });
});
