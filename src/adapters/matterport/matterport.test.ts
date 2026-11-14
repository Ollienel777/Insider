import { afterEach, describe, expect, it, vi } from "vitest";
import { FloorGraph } from "@/domain";
import raw from "../../../fixtures/floors/F1.json";
import { FIXTURE_BUILDINGS } from "../costar/fake";
import { checkFloor } from "../../../scripts/check-floor.mjs";
import { F1_DEMO, FIXTURE_FLOORS, createFakeMatterport } from "./fake";
import { insideViewFor, matterportEnv, modelOverride, scanModelId, selectMatterport, withFixtureFloor } from "./index";

const f1 = FloorGraph.parse(raw);
const node = (id: string) => f1.nodes.find((n) => n.id === id);
const room = (id: string) => f1.rooms.find((r) => r.id === id);

/** Fewest moves from `from` to each reachable node. */
function distances(graph: FloorGraph, from: string): Map<string, number> {
  const adjacent = new Map(graph.nodes.map((n) => [n.id, [] as string[]]));
  for (const { a, b } of graph.edges) {
    adjacent.get(a)!.push(b);
    adjacent.get(b)!.push(a);
  }
  const dist = new Map([[from, 0]]);
  const queue = [from];
  while (queue.length > 0) {
    const at = queue.shift()!;
    for (const next of adjacent.get(at)!) {
      if (!dist.has(next)) {
        dist.set(next, dist.get(at)! + 1);
        queue.push(next);
      }
    }
  }
  return dist;
}

const SQ_FT_PER_M2 = 10.7639;

describe("fixtures/floors/F1.json (Halvorsen Tower, floor 22)", () => {
  it("validates against FloorGraph and is marked as a fixture", () => {
    const result = FloorGraph.safeParse(raw);
    expect(result.error?.issues ?? []).toEqual([]);
    expect(f1.source).toBe("fixture");
  });

  it("has 24–32 nodes over 8–12 rooms, every room used", () => {
    expect(f1.nodes.length).toBeGreaterThanOrEqual(24);
    expect(f1.nodes.length).toBeLessThanOrEqual(32);
    expect(f1.rooms.length).toBeGreaterThanOrEqual(8);
    expect(f1.rooms.length).toBeLessThanOrEqual(12);
    const used = new Set(f1.nodes.map((n) => n.roomId));
    expect(f1.rooms.filter((r) => !used.has(r.id)).map((r) => r.id)).toEqual([]);
  });

  it("is connected, every sightline targets a real node, and every cross-room edge has a door", () => {
    expect(checkFloor(f1)).toEqual([]);
    expect(distances(f1, F1_DEMO.dockEntry).size).toBe(f1.nodes.length);
  });

  it("has only symmetric sightlines (no one-way sightline is documented, so none is allowed)", () => {
    for (const [from, seen] of Object.entries(f1.sightlines)) {
      for (const to of seen) expect(f1.sightlines[to], `${from} → ${to}`).toContain(from);
    }
    expect(Object.keys(f1.sightlines).sort()).toEqual(f1.nodes.map((n) => n.id).sort());
  });

  it("sees within each room: same-room nodes see each other", () => {
    for (const a of f1.nodes) {
      for (const b of f1.nodes) {
        if (a.id !== b.id && a.roomId === b.roomId) expect(f1.sightlines[a.id], `${a.id} → ${b.id}`).toContain(b.id);
      }
    }
  });

  it("keeps every node inside its room, and no two rooms overlap", () => {
    for (const n of f1.nodes) {
      const { x, y, w, h } = room(n.roomId)!.rect;
      expect(n.x > x && n.x < x + w && n.y > y && n.y < y + h, `${n.id} in ${n.roomId}`).toBe(true);
    }
    for (const [i, a] of f1.rooms.entries()) {
      for (const b of f1.rooms.slice(i + 1)) {
        const overlap =
          a.rect.x < b.rect.x + b.rect.w &&
          b.rect.x < a.rect.x + a.rect.w &&
          a.rect.y < b.rect.y + b.rect.h &&
          b.rect.y < a.rect.y + a.rect.h;
        expect(overlap, `${a.id} and ${b.id}`).toBe(false);
      }
    }
  });

  it("is a floor plate the size of F1's typical floor (metres, within 10%)", () => {
    const right = Math.max(...f1.rooms.map((r) => r.rect.x + r.rect.w));
    const bottom = Math.max(...f1.rooms.map((r) => r.rect.y + r.rect.h));
    const plateSf = right * bottom * SQ_FT_PER_M2;
    const typical = FIXTURE_BUILDINGS.find((b) => b.id === "F1")!.typicalFloorSf;
    expect(Math.abs(plateSf / typical - 1)).toBeLessThan(0.1);
  });

  it("has realistic floor labels, not placeholders, and the rooms the ticket names", () => {
    const labels = f1.rooms.map((r) => r.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) expect(label).not.toMatch(/^(room|space|area|zone)\s*\d*$/i);
    for (const wanted of [
      "Freight Lift Lobby",
      "Dock Corridor",
      "Records Room",
      "Server Closet",
      "Open Office 2210",
      "Elevator Lobby",
      "East Stair (Stair A)",
      "West Stair (Stair B)",
    ]) {
      expect(labels).toContain(wanted);
    }
    // Suites 2202–2209 are covered by the suite rooms, named by suite number.
    expect(labels.filter((l) => /^Suites 22\d\d–22\d\d$/.test(l))).toEqual(["Suites 2202–2205", "Suites 2206–2209"]);
  });

  it("has two stairs and one entry per Vexcel entry that reaches floor 22: the dock by the freight lift, the roof by the east stair", () => {
    const stairs = f1.nodes.filter((n) => n.tags.includes("stair"));
    expect(stairs.map((n) => room(n.roomId)!.label).sort()).toEqual(["East Stair (Stair A)", "West Stair (Stair B)"]);

    const entries = f1.nodes.filter((n) => n.tags.includes("entry")).map((n) => n.id);
    expect(entries.sort()).toEqual([F1_DEMO.dockEntry, F1_DEMO.roofEntry].sort());

    const dock = node(F1_DEMO.dockEntry)!;
    expect(dock.tags).toContain("lift");
    expect(room(dock.roomId)!.label).toBe("Freight Lift Lobby");
    const roof = node(F1_DEMO.roofEntry)!;
    expect(roof.tags).toContain("stair");
    expect(room(roof.roomId)!.label).toBe("East Stair (Stair A)");
  });

  it("has the objective in the records room, behind the one lockable records door", () => {
    expect(room(node(F1_DEMO.objective)!.roomId)!.label).toBe("Records Room");
    const into = f1.edges.filter((e) => {
      const rooms = [node(e.a)!.roomId, node(e.b)!.roomId];
      return rooms.includes("records-room") && rooms.some((r) => r !== "records-room");
    });
    expect(into.map((e) => e.door)).toEqual([{ id: F1_DEMO.recordsDoor, lockable: true }]);
    expect(distances(f1, F1_DEMO.dockEntry).has(F1_DEMO.objective)).toBe(true);
  });

  // R1-M7 (spec review): beat 5 has 30 seconds, so C2's cover must be 2–3
  // moves from the dock entry, with the wait spot next to it in view at the
  // start.
  describe("beat 5 fits its 30 seconds (R1-M7)", () => {
    const fromDock = distances(f1, F1_DEMO.dockEntry);
    const cover = [...F1_DEMO.c2Cover];

    it("C2's cover is the dock corridor short of the records door, which is picked from the rest of it", () => {
      expect(cover.map((id) => room(node(id)!.roomId)!.label)).toEqual(cover.map(() => "Dock Corridor"));
      const corridor = f1.nodes.filter((n) => n.roomId === "dock-corridor").map((n) => n.id);
      const pickFrom = f1.edges.find((e) => e.door?.id === F1_DEMO.recordsDoor)!.a;
      expect(corridor.filter((id) => !cover.includes(id))).toEqual([pickFrom]);
    });

    it("its nearest node is reached in 2–3 moves from the dock entry", () => {
      const nearest = Math.min(...cover.map((id) => fromDock.get(id)!));
      expect(nearest).toBeGreaterThanOrEqual(2);
      expect(nearest).toBeLessThanOrEqual(3);
    });

    it("the freight lift wait spot neighbours both the entry and the cover, outside the cover", () => {
      const wait = F1_DEMO.freightLiftWait;
      expect(cover).not.toContain(wait);
      expect(room(node(wait)!.roomId)!.label).toBe("Freight Lift Lobby");
      const neighbours = (id: string) =>
        f1.edges.flatMap((e) => (e.a === id ? [e.b] : e.b === id ? [e.a] : []));
      expect(neighbours(F1_DEMO.dockEntry)).toContain(wait);
      expect(neighbours(wait).some((id) => cover.includes(id))).toBe(true);
    });

    it("from the dock entry, at the start, the wait spot and a covered node are both in view", () => {
      const seen = f1.sightlines[F1_DEMO.dockEntry];
      expect(seen).toContain(F1_DEMO.freightLiftWait);
      expect(seen.some((id) => cover.includes(id))).toBe(true);
    });

    it("the records room is reached only through C2's cover", () => {
      // Remove the cover from the board: the objective must become unreachable.
      const without: FloorGraph = {
        ...f1,
        edges: f1.edges.filter((e) => !cover.includes(e.a) && !cover.includes(e.b)),
      };
      expect(distances(without, F1_DEMO.dockEntry).has(F1_DEMO.objective)).toBe(false);
    });
  });
});

describe("the fake adapter", () => {
  const matterport = createFakeMatterport();

  it("loads F1's floor, and null for a building with no fixture floor", async () => {
    expect(await matterport.loadFloor({ id: "F1" })).toEqual(FIXTURE_FLOORS.F1);
    expect(await matterport.loadFloor({ id: "F9" })).toBeNull();
    expect(await matterport.loadFloor({ id: "toString" })).toBeNull();
  });

  it("hands out copies, so a caller cannot change the fixture", async () => {
    const floor = (await matterport.loadFloor({ id: "F1" }))!;
    floor.nodes.length = 0;
    floor.sightlines[F1_DEMO.dockEntry].pop();
    const again = (await matterport.loadFloor({ id: "F1" }))!;
    expect(again.nodes).toHaveLength(f1.nodes.length);
    expect(again.sightlines[F1_DEMO.dockEntry]).toEqual(f1.sightlines[F1_DEMO.dockEntry]);
  });

  it("names only ids that exist on F1 in F1_DEMO", () => {
    const ids = new Set(f1.nodes.map((n) => n.id));
    for (const id of [F1_DEMO.dockEntry, F1_DEMO.roofEntry, F1_DEMO.freightLiftWait, F1_DEMO.objective, ...F1_DEMO.c2Cover]) {
      expect(ids.has(id), id).toBe(true);
    }
  });
});

describe("selectMatterport (the mode switch)", () => {
  const KEY = { NEXT_PUBLIC_MATTERPORT_SDK_KEY: "test-key" };

  it("is fake with an empty environment", () => {
    expect(selectMatterport({})).toMatchObject({ mode: "fake", reason: "Matterport: fixtures (fake mode)" });
  });

  it("is fake when NEXT_PUBLIC_MATTERPORT_MODE is fake, even with a key and HEIST_MODE=live", () => {
    expect(selectMatterport({ ...KEY, HEIST_MODE: "live", NEXT_PUBLIC_MATTERPORT_MODE: "fake" }).mode).toBe("fake");
  });

  it("falls back to fake when live is asked for without a key, and says why", async () => {
    const s = selectMatterport({ NEXT_PUBLIC_MATTERPORT_MODE: "live", NEXT_PUBLIC_MATTERPORT_SDK_KEY: "" });
    expect(s.mode).toBe("fake");
    expect(s.reason).toBe("Matterport: fixtures (live mode, but NEXT_PUBLIC_MATTERPORT_SDK_KEY not set)");
    expect((await s.adapter.loadFloor({ id: "F1" }))?.source).toBe("fixture");
  });

  it("is live with a key and NEXT_PUBLIC_MATTERPORT_MODE=live, or HEIST_MODE=live alone", () => {
    expect(selectMatterport({ ...KEY, NEXT_PUBLIC_MATTERPORT_MODE: "live" })).toMatchObject({
      mode: "live",
      reason: "Matterport: live",
    });
    expect(selectMatterport({ ...KEY, HEIST_MODE: "live" }).mode).toBe("live");
  });
});

describe("the dev-only model override (issue 28)", () => {
  const VAR = "NEXT_PUBLIC_MATTERPORT_MODEL_OVERRIDE";

  it("points every building at a bare model id, outside production", () => {
    expect(modelOverride({ [VAR]: " mOdel1 ", NODE_ENV: "development" })).toEqual({ all: "mOdel1", byBuilding: {} });
    expect(scanModelId({ id: "F1" }, { [VAR]: "mOdel1" })).toBe("mOdel1");
    expect(scanModelId({ id: "F2", matterportModelId: "own" }, { [VAR]: "mOdel1" })).toBe("mOdel1");
  });

  it("points named buildings only, with buildingId=modelId pairs", () => {
    const env = { [VAR]: "F1=aaa, F3 = bbb,broken" };
    expect(modelOverride(env).byBuilding).toEqual({ F1: "aaa", F3: "bbb" });
    expect(scanModelId({ id: "F1" }, env)).toBe("aaa");
    expect(scanModelId({ id: "F2" }, env)).toBeUndefined();
    expect(scanModelId({ id: "F2", matterportModelId: "own" }, env)).toBe("own");
  });

  it("is ignored in a production build, and when unset", () => {
    expect(scanModelId({ id: "F1" }, { [VAR]: "mOdel1", NODE_ENV: "production" })).toBeUndefined();
    expect(scanModelId({ id: "F1", matterportModelId: "own" }, {})).toBe("own");
  });

  it("is what the live adapter connects to", async () => {
    // The live adapter connects through a hidden iframe; with no document it rejects, so this
    // checks the model id reached it by the error, without a network.
    const s = selectMatterport({ NEXT_PUBLIC_MATTERPORT_MODE: "live", NEXT_PUBLIC_MATTERPORT_SDK_KEY: "k", [VAR]: "mOdel1" });
    expect(s.mode).toBe("live");
    await expect(s.adapter.loadFloor({ id: "F1" })).rejects.toThrow("runs only in the browser");
  });
});

describe("the fixture fallback names a timeout as one (issue 28)", () => {
  it("says Matterport didn't answer in time when the live load timed out", async () => {
    const timeout = Object.assign(new Error("the Showcase connection did not arrive within 20000 ms"), { name: "TimeoutError" });
    const messages: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = withFixtureFloor({ loadFloor: async () => Promise.reject(timeout) }, createFakeMatterport(), (f) =>
      messages.push(f.message),
    );
    expect((await adapter.loadFloor({ id: "F1", matterportModelId: "m" }))?.source).toBe("fixture");
    expect(messages).toEqual(["Matterport didn't answer in time, so the board uses the fixture floor."]);
    warn.mockRestore();
  });
});

describe("insideViewFor (the Run screen's Inside view)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("offers no Inside view in fake mode, so the demo path shows no panel", () => {
    vi.stubEnv("NEXT_PUBLIC_MATTERPORT_MODE", "fake");
    expect(insideViewFor({ id: "F1", matterportModelId: "m" })).toBeNull();
  });

  it("offers an opener in live mode with a key, for a building with a scan or an override", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_MATTERPORT_MODE", "live");
    vi.stubEnv("NEXT_PUBLIC_MATTERPORT_SDK_KEY", "test-key");
    vi.stubEnv("NEXT_PUBLIC_MATTERPORT_MODEL_OVERRIDE", "F1=mOdel1");
    vi.stubEnv("NODE_ENV", "development");
    // A fresh module, so the page's adapter is chosen from this environment.
    const fresh = await import("./index");
    expect(fresh.getMatterport().mode).toBe("live");
    expect(fresh.insideViewFor({ id: "48213", matterportModelId: "own" })).toBeTypeOf("function");
    expect(fresh.insideViewFor({ id: "F1" })).toBeTypeOf("function");
    expect(fresh.insideViewFor({ id: "F2" })).toBeNull();
  });
});

describe("matterportEnv (what the browser bundle reads)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("drops the model override in a production build, so the bundle never holds it", () => {
    vi.stubEnv("NEXT_PUBLIC_MATTERPORT_MODEL_OVERRIDE", "F1=mOdel1");
    vi.stubEnv("NODE_ENV", "production");
    expect(matterportEnv().NEXT_PUBLIC_MATTERPORT_MODEL_OVERRIDE).toBeUndefined();
    vi.stubEnv("NODE_ENV", "development");
    expect(matterportEnv().NEXT_PUBLIC_MATTERPORT_MODEL_OVERRIDE).toBe("F1=mOdel1");
  });
});
