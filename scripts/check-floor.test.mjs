import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkFloor } from "./check-floor.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "check-floor.mjs");
const floor = (id) => JSON.parse(readFileSync(path.join(here, "..", "fixtures", "floors", `${id}.json`), "utf8"));
const f1 = floor("F1");

// A three-node floor: hall (two nodes) and an office behind a door.
const small = () => ({
  nodes: [
    { id: "h1", roomId: "hall" },
    { id: "h2", roomId: "hall" },
    { id: "o1", roomId: "office" },
  ],
  edges: [
    { a: "h1", b: "h2" },
    { a: "h2", b: "o1", door: { id: "d1", lockable: false } },
  ],
  sightlines: { h1: ["h2"], h2: ["h1"] },
});

describe("checkFloor", () => {
  it("passes the F1 fixture and a small valid floor", () => {
    expect(checkFloor(f1)).toEqual([]);
    expect(checkFloor(small())).toEqual([]);
  });

  it.each(["F2", "F3"])("passes the %s fixture (#39)", (id) => {
    expect(checkFloor(floor(id))).toEqual([]);
  });

  it("reports a floor that is not connected", () => {
    const g = small();
    g.edges.pop();
    expect(checkFloor(g)).toEqual(["not connected: o1 cannot be reached from h1"]);
  });

  it("reports a sightline to or from a node that does not exist", () => {
    const g = small();
    g.sightlines.h1.push("ghost");
    g.sightlines.nowhere = ["h1"];
    expect(checkFloor(g)).toEqual([
      "sightline h1 → ghost targets an unknown node",
      "sightline from unknown node nowhere",
      "sightline nowhere → h1 is one-way and not listed as such",
    ]);
  });

  it("reports a one-way sightline unless it is listed as one-way", () => {
    const g = small();
    g.sightlines.h2 = [];
    expect(checkFloor(g)).toEqual(["sightline h1 → h2 is one-way and not listed as such"]);
    expect(checkFloor(g, { oneWay: ["h1>h2"] })).toEqual([]);
  });

  it("reports an edge that crosses rooms without a door, and an edge to an unknown node", () => {
    const g = small();
    delete g.edges[1].door;
    g.edges.push({ a: "h1", b: "ghost" });
    expect(checkFloor(g)).toEqual([
      "edge h2–o1 crosses from hall to office without a door",
      "edge h1–ghost ends at an unknown node",
    ]);
  });

  it("exits 0 on the fixtures and 1, naming the problem, on a broken file", () => {
    const ok = spawnSync(process.execPath, [script], { encoding: "utf8" });
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toMatch(/F1\.json: ok/);
    expect(ok.stdout).toMatch(/F2\.json: ok/);
    expect(ok.stdout).toMatch(/F3\.json: ok/);

    const dir = mkdtempSync(path.join(os.tmpdir(), "check-floor-"));
    try {
      const g = small();
      g.edges.pop();
      const file = path.join(dir, "broken.json");
      writeFileSync(file, JSON.stringify(g));
      const bad = spawnSync(process.execPath, [script, file], { encoding: "utf8" });
      expect(bad.status).toBe(1);
      expect(bad.stderr).toMatch(/not connected: o1/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
