import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getCoStar, resetCoStar } from "@/adapters/costar";
import { fictionalListing, fictionalProperty, writeFictionalKit } from "@/adapters/costar/test-kit";
import { readCachedCasting } from "@/agents/casting/cache";
import { CastingResult } from "@/domain";
import { FORCE_COOKIE } from "@/lib/mode";
import expected from "../../../../../fixtures/inventory-finalists.json";
import { GET } from "./route";

// A path under a regular file fails with ENOTDIR on Linux and macOS but
// ENOENT on Windows, so the unreadable state dir is simulated: any read
// below `unreadable` rejects with the ENOTDIR error POSIX gives.
const unreadable = vi.hoisted(() => ({ dir: undefined as string | undefined }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  const readFile = ((file: Parameters<typeof fs.readFile>[0], ...rest: unknown[]) => {
    const { dir } = unreadable;
    if (dir && typeof file === "string" && file.startsWith(dir)) {
      return Promise.reject(Object.assign(new Error(`ENOTDIR: not a directory, open '${file}'`), { code: "ENOTDIR" }));
    }
    return (fs.readFile as (...args: unknown[]) => Promise<unknown>)(file, ...rest);
  }) as typeof fs.readFile;
  return { ...fs, default: { ...fs, readFile }, readFile };
});

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

describe("GET /api/cast/[missionId] with CoStar live", () => {
  const root = mkdtempSync(path.join(tmpdir(), "cast-live-"));
  const committed = JSON.parse(readFileSync(path.join(process.cwd(), "data", "casting", "romaine-1974.json"), "utf8"));
  let errors: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    vi.stubEnv("COSTAR_MODE", "live");
    // Live CoStar needs only the kit directory; the route never reads the
    // kit, so a path that does not exist is enough.
    vi.stubEnv("COSTAR_KIT_DIR", path.join(root, "no-kit"));
    resetCoStar();
    errors = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterAll(() => {
    vi.stubEnv("COSTAR_MODE", "fake");
    resetCoStar();
    rmSync(root, { recursive: true, force: true });
  });

  const served = async () => {
    const response = await get("romaine-1974");
    expect(response.status).toBe(200);
    return CastingResult.parse(await response.json());
  };

  it("really is live CoStar", () => {
    expect(getCoStar().mode).toBe("live");
  });

  it("serves the state dir's shortlist first", async () => {
    const state = path.join(root, "hit");
    mkdirSync(path.join(state, "casting"), { recursive: true });
    const live = { ...committed, funnel: committed.funnel.slice(0, 2) };
    writeFileSync(path.join(state, "casting", "romaine-1974.json"), JSON.stringify(live));
    vi.stubEnv("HEIST_STATE_DIR", state);
    expect((await served()).funnel).toHaveLength(2);
  });

  it("falls back to data/casting/ when the state dir has no shortlist", async () => {
    vi.stubEnv("HEIST_STATE_DIR", path.join(root, "empty"));
    expect(await served()).toEqual(CastingResult.parse(committed));
  });

  it("falls back to data/casting/ when the state dir cannot be read, and logs it", async () => {
    const notADir = path.join(root, "a-file");
    writeFileSync(notADir, "");
    vi.stubEnv("HEIST_STATE_DIR", notADir);
    errors.mockClear();
    unreadable.dir = notADir + path.sep;
    try {
      expect(await served()).toEqual(CastingResult.parse(committed));
    } finally {
      unreadable.dir = undefined;
    }
    expect(errors).toHaveBeenCalledWith(expect.stringMatching(/live shortlist cannot be read \(ENOTDIR\)/));
  });

  it("answers 500 for a state-dir shortlist that is there but fails its schema", async () => {
    const state = path.join(root, "bad");
    mkdirSync(path.join(state, "casting"), { recursive: true });
    writeFileSync(path.join(state, "casting", "romaine-1974.json"), JSON.stringify({ missionId: "romaine-1974" }));
    vi.stubEnv("HEIST_STATE_DIR", state);
    const response = await get("romaine-1974");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "the cached shortlist for this mission is invalid" });
  });
});

// #103, on the fictional test kit (src/adapters/costar/test-kit.ts) only.
describe("GET /api/cast/[missionId] with a showcase building", () => {
  const root = mkdtempSync(path.join(tmpdir(), "cast-showcase-"));
  const kit = writeFictionalKit({
    properties: [fictionalProperty(900001, { contacts: [{ name: "Brokerly Person" }] })],
    listings: [fictionalListing(700001, 900001, [{}], { listingContacts: [{ name: "Agently Person" }] })],
    scans: [[900001, "mpTestAAAA001"]],
  });

  beforeAll(() => {
    vi.stubEnv("COSTAR_KIT_DIR", kit);
    vi.stubEnv("HEIST_STATE_DIR", path.join(root, "state"));
    vi.stubEnv("SHOWCASE_LEVELS", "900001:romaine-1974");
  });
  afterAll(() => {
    vi.stubEnv("COSTAR_MODE", "fake");
    vi.stubEnv("SHOWCASE_LEVELS", "");
    resetCoStar();
    rmSync(root, { recursive: true, force: true });
    rmSync(kit, { recursive: true, force: true });
  });
  const mode = (costar: "live" | "fake") => {
    vi.stubEnv("COSTAR_MODE", costar);
    resetCoStar();
  };

  it("returns the mission's showcase building beside its shortlist, live", async () => {
    mode("live");
    const response = await get("romaine-1974");
    expect(response.status).toBe(200);
    const text = await response.text();
    const body = JSON.parse(text);
    expect(body.showcase).toMatchObject({ id: "900001", name: "Testwood Tower 900001", buildingClass: "B" });
    expect(body.showcase.reasons.find((r: { need: string }) => r.need === "built 1974 or earlier")).toEqual({
      need: "built 1974 or earlier",
      value: "built 1981",
      status: "miss",
    });
    // The shortlist is unchanged: the committed one, F1 first.
    const rest = { ...body };
    delete rest.showcase;
    expect(CastingResult.parse(rest).finalists.map((c) => c.id)).toEqual(expected["romaine-1974"]);
    expect(text).not.toMatch(/Brokerly|Agently/);
  });

  it("returns the shortlist alone for a mission with no showcase building", async () => {
    mode("live");
    const body = await (await get("sunset-1986")).json();
    expect(body).not.toHaveProperty("showcase");
  });

  it("returns the shortlist alone in fake mode and with CoStar forced to fixtures", async () => {
    mode("fake");
    expect(await (await get("romaine-1974")).json()).not.toHaveProperty("showcase");
    mode("live");
    const forced = await GET(new Request("http://localhost/api/cast/romaine-1974", { headers: { cookie: `${FORCE_COOKIE}=costar` } }), {
      params: Promise.resolve({ missionId: "romaine-1974" }),
    });
    expect(await forced.json()).not.toHaveProperty("showcase");
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
