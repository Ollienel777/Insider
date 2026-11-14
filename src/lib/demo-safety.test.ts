// Demo safety, service by service (SPEC §2, §7; #26): with live mode asked
// for and its key missing, and with live mode on and the live call failing,
// the mode chip says the service is on fixtures and the beat still answers.
// No keys exist: every live path runs on stubs and on variables set here.
// Nothing here reaches the network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCoStar, resetCoStar } from "@/adapters/costar";
import { createFakeMatterport } from "@/adapters/matterport/fake";
import { getMatterport, matterportMode, noScanFallback, withFixtureFloor } from "@/adapters/matterport";
import { getVexcel, resetVexcel } from "@/adapters/vexcel";
import { GET as getAerialRoute } from "@/app/api/buildings/[id]/aerial/route";
import { GET as getBuildingsRoute } from "@/app/api/buildings/route";
import { POST as postCrew } from "@/app/api/crew/route";
import { fetchAerial } from "@/components/scout/scout-screen";
import { serverStatus } from "@/components/shell/app-shell";
import type { Aerial, Building } from "@/domain";
import { getStatus, initStatus, noteResponse, reportFallback, reportLive, resetStatus, setForced, statusChip } from "./demo-status";
import type { Fallback } from "./fallback";
import { configuredModes, FORCE_COOKIE, modeChip, serviceModes, type ServiceModes } from "./mode";

const LIVE_COSTAR = { COSTAR_MODE: "live", COSTAR_API_BASE: "https://costar.test/api", COSTAR_API_KEY: "test-key" };
const LIVE_VEXCEL = { VEXCEL_MODE: "live", VEXCEL_API_BASE: "https://vexcel.test/api", VEXCEL_API_KEY: "test-key" };

function stubEnv(env: Record<string, string>) {
  for (const name of ["HEIST_MODE", "LLM_MODE", "COSTAR_MODE", "VEXCEL_MODE", "NEXT_PUBLIC_MATTERPORT_MODE"]) vi.stubEnv(name, "");
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
}

/** A `fetch` that fails like a dead network, and counts its calls. */
function deadNetwork() {
  const fetch = vi.fn(async () => {
    throw new TypeError("fetch failed");
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** The chip the browser shows once it has the server's status and any fallbacks. */
function chipAfter(configured: ServiceModes, fallbacks: (Fallback | undefined)[] = []) {
  initStatus({ configured, forced: [] });
  for (const f of fallbacks) if (f) reportFallback(f);
  return statusChip(getStatus());
}

const buildings = (cookie?: string) =>
  getBuildingsRoute(new Request("http://localhost/api/buildings", cookie ? { headers: { cookie } } : undefined));
const aerial = (id: string) =>
  getAerialRoute(new Request(`http://localhost/api/buildings/${id}/aerial`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  resetCoStar();
  resetVexcel();
  resetStatus();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CoStar", () => {
  it("live without COSTAR_API_KEY: the chip says fixtures and the map still lists five buildings", async () => {
    stubEnv({ COSTAR_MODE: "live", COSTAR_API_BASE: LIVE_COSTAR.COSTAR_API_BASE });
    // The switch alone says live; what CoStar serves is fixtures (the #50 note).
    expect(serviceModes(process.env).costar).toBe("live");
    expect(configuredModes(process.env).costar).toBe("fake");
    expect(modeChip(configuredModes(process.env)).onFixtures).toContain("CoStar");

    const response = await buildings();
    const body = (await response.json()) as { mode: string; buildings: Building[] };
    expect(response.status).toBe(200);
    expect(body.mode).toBe("fake");
    expect(body.buildings).toHaveLength(5);
  });

  it("live with a failing call: the fixtures answer, the chip switches, one fallback names CoStar, and CoStar stays on fixtures", async () => {
    stubEnv(LIVE_COSTAR);
    const fetch = deadNetwork();
    expect(getCoStar().mode).toBe("live");

    const response = await buildings();
    const body = (await response.json()) as { mode: string; buildings: Building[]; fallback?: Fallback };
    expect(response.status).toBe(200);
    expect(body.mode).toBe("fake");
    expect(body.buildings.map((b) => b.id)).toEqual(["F1", "F2", "F3", "F4", "F5"]);
    expect(body.fallback).toMatchObject({ service: "costar", message: "CoStar didn't answer, so buildings use fixtures." });

    // The server's view (what AppShell renders with) and the browser's chip agree.
    expect(getCoStar()).toMatchObject({ mode: "fake", fallback: body.fallback });
    noteResponse(body);
    const chip = chipAfter({ ...configuredModes(process.env), costar: "live" });
    expect(chip.onFixtures).toContain("CoStar");
    expect(getStatus().toasts).toEqual([body.fallback]);

    // The breaker holds: the next request goes straight to the fixtures.
    const calls = fetch.mock.calls.length;
    const again = (await (await buildings()).json()) as { fallback?: Fallback };
    expect(fetch.mock.calls.length).toBe(calls);
    expect(again.fallback?.id).toBe(body.fallback!.id);
    noteResponse(again);
    expect(getStatus().toasts).toHaveLength(1);
  });

  it("a building screen still finds its building after a live failure", async () => {
    stubEnv(LIVE_COSTAR);
    deadNetwork();
    const building = await getCoStar().adapter.getBuilding("F1");
    expect(building).toMatchObject({ id: "F1", name: "Halvorsen Tower", source: "fixture" });
  });
});

describe("Vexcel", () => {
  it("live without VEXCEL_API_BASE: the chip says fixtures and Scout still gets the massing", async () => {
    stubEnv({ VEXCEL_MODE: "live", VEXCEL_API_KEY: "test-key" });
    expect(configuredModes(process.env).vexcel).toBe("fake");
    expect(modeChip(configuredModes(process.env)).onFixtures).toContain("Vexcel");

    const response = await aerial("F1");
    const body = (await response.json()) as { mode: string; aerial: Aerial };
    expect(response.status).toBe(200);
    expect(body.mode).toBe("fake");
    expect(body.aerial.source).toBe("fixture");
  });

  it("live with a failing call: the massing answers, the chip switches, and one fallback names Vexcel", async () => {
    stubEnv(LIVE_VEXCEL);
    const fetch = deadNetwork();
    expect(getVexcel().mode).toBe("live");

    const response = await aerial("F1");
    const body = (await response.json()) as { mode: string; aerial: Aerial; fallback?: Fallback };
    expect(fetch).toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(body.mode).toBe("fake");
    expect(body.aerial.source).toBe("fixture");
    expect(body.fallback).toMatchObject({ service: "vexcel", message: "Vexcel didn't answer, so the aerial is a fixture massing." });

    noteResponse(body);
    expect(chipAfter({ ...configuredModes(process.env), vexcel: "live" }).onFixtures).toContain("Vexcel");
    expect(getStatus().toasts.map((t) => t.service)).toEqual(["vexcel"]);
  });
});

describe("the model", () => {
  const order = (cookie?: string) =>
    postCrew(
      new Request("http://localhost/api/crew", {
        method: "POST",
        headers: { "content-type": "application/json", ...(cookie && { cookie }) },
        body: JSON.stringify({ buildingId: "F1", order: "Go in through the dock, wait for the 2 am round to pass, take the records room." }),
      }),
    );

  it("live without ANTHROPIC_API_KEY: the chip says fixtures and the crew still answers, recorded", async () => {
    stubEnv({ LLM_MODE: "live" });
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(configuredModes(process.env).llm).toBe("fake");
    expect(modeChip(configuredModes(process.env)).onFixtures).toContain("Model");

    const response = await order();
    const body = (await response.json()) as { recorded: boolean; reason?: string; fallback?: Fallback };
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ recorded: true, reason: "fake mode" });
    // Configured fakes are not fallbacks: no toast.
    expect(body.fallback).toBeUndefined();
  });

  it("live with a failing call: the recorded reply answers, with one fallback naming the model, and the chip switches", async () => {
    stubEnv({ LLM_MODE: "live", ANTHROPIC_API_KEY: "test-key", LLM_TIMEOUT_MS: "300" });
    const fetch = deadNetwork();
    expect(configuredModes(process.env).llm).toBe("live");

    const response = await order();
    const body = (await response.json()) as { recorded: boolean; reason?: string; plan: unknown; fallback?: Fallback };
    // The model was asked, on the stubbed network: nothing left the machine.
    expect(fetch).toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(body.recorded).toBe(true);
    expect(["timeout", "error"]).toContain(body.reason);
    expect(body.plan).toBeTruthy();
    expect(body.fallback?.service).toBe("llm");
    expect(body.fallback?.message).toMatch(/^The model didn't answer( in time)?, so a recorded reply stands in\.$/);

    noteResponse(body);
    expect(chipAfter(configuredModes(process.env)).onFixtures).toContain("Model");
    // The next live answer puts the chip back.
    noteResponse({ recorded: false });
    expect(statusChip(getStatus()).onFixtures).not.toContain("Model");
  }, 20_000);

  it("forced in the demo settings: the crew answers recorded without calling the model", async () => {
    stubEnv({ LLM_MODE: "live", ANTHROPIC_API_KEY: "test-key" });
    const fetch = deadNetwork();
    const body = (await (await order(`${FORCE_COOKIE}=llm`)).json()) as { recorded: boolean; reason?: string };
    expect(body).toMatchObject({ recorded: true, reason: "fake mode" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Matterport", () => {
  const F1 = { id: "F1", matterportModelId: "mp-test-f1" };

  it("HEIST_MODE=live with no SDK key: the browser serves fixtures and the chip says so (the #52 note)", () => {
    stubEnv({ HEIST_MODE: "live" });
    vi.stubEnv("NEXT_PUBLIC_MATTERPORT_SDK_KEY", "");
    // The switch alone says live; the browser's adapter, and so the chip, says fixtures.
    expect(serviceModes(process.env).matterport).toBe("live");
    expect(matterportMode("live")).toBe("fake");
    expect(configuredModes(process.env).matterport).toBe("fake");
    expect(chipAfter({ ...configuredModes(process.env), matterport: matterportMode("live") }).onFixtures).toContain(
      "Matterport",
    );
  });

  it("without a key the board still gets F1's fixture floor", async () => {
    stubEnv({ NEXT_PUBLIC_MATTERPORT_MODE: "live" });
    const floor = await getMatterport("live").adapter.loadFloor(F1);
    expect(floor?.source).toBe("fixture");
  });

  it("a failing live load gets the fixture floor, reports one fallback naming Matterport, and stays on fixtures", async () => {
    const live = { loadFloor: vi.fn(async () => Promise.reject(new Error("Matterport: Sweep.data did not arrive"))) };
    const fallbacks: Fallback[] = [];
    const adapter = withFixtureFloor(live, createFakeMatterport(), (f) => fallbacks.push(f));

    const floor = await adapter.loadFloor(F1);
    expect(floor?.source).toBe("fixture");
    expect(floor?.nodes.length).toBeGreaterThanOrEqual(24);
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0]).toMatchObject({ service: "matterport", message: "Matterport didn't answer, so the board uses the fixture floor." });

    expect(await adapter.loadFloor(F1)).not.toBeNull();
    expect(live.loadFloor).toHaveBeenCalledTimes(1);

    expect(chipAfter({ ...configuredModes({}), matterport: "live" }, fallbacks).onFixtures).toContain("Matterport");
  });

  it("a building with no matterportModelId gets the fixture floor, never no board", async () => {
    const live = { loadFloor: vi.fn(async () => null) };
    const fallbacks: Fallback[] = [];
    const adapter = withFixtureFloor(live, createFakeMatterport(), (f) => fallbacks.push(f));

    const floor = await adapter.loadFloor({ id: "F1" });
    expect(floor?.source).toBe("fixture");
    expect(live.loadFloor).not.toHaveBeenCalled();
    expect(fallbacks[0]?.message).toBe("This building has no Matterport scan, so the board uses the fixture floor.");
  });

  it("a live floor passes through untouched, with no fallback", async () => {
    const scanned = { ...(await createFakeMatterport().loadFloor(F1))!, source: "matterport" as const };
    const fallbacks: Fallback[] = [];
    const adapter = withFixtureFloor({ loadFloor: async () => scanned }, createFakeMatterport(), (f) => fallbacks.push(f));
    expect((await adapter.loadFloor(F1))?.source).toBe("matterport");
    expect(fallbacks).toEqual([]);
  });

  it("a building with no scan is toasted once a session, however often its board loads (R1-M2)", async () => {
    initStatus({ configured: { ...configuredModes({}), matterport: "live" }, forced: [] });
    const adapter = withFixtureFloor({ loadFloor: vi.fn(async () => null) }, createFakeMatterport(), reportFallback);
    // Plan, Run and Drill each load the board.
    for (let i = 0; i < 3; i++) await adapter.loadFloor({ id: "F1" });
    await withFixtureFloor({ loadFloor: async () => null }, createFakeMatterport(), reportFallback).loadFloor({ id: "F1" });
    expect(getStatus().toasts).toEqual([noScanFallback("F1")]);
    // Another building without a scan is its own toast.
    await adapter.loadFloor({ id: "F2" });
    expect(getStatus().toasts.map((t) => t.id)).toEqual(["matterport-no-scan-F1", "matterport-no-scan-F2"]);
  });

  it("a live load that brings back no floor, for a building that has a scan, is a failure, not 'no scan'", async () => {
    const live = { loadFloor: vi.fn(async () => null) };
    const fallbacks: Fallback[] = [];
    const adapter = withFixtureFloor(live, createFakeMatterport(), (f) => fallbacks.push(f));
    expect((await adapter.loadFloor(F1))?.source).toBe("fixture");
    expect(fallbacks.map((f) => f.message)).toEqual(["Matterport didn't answer, so the board uses the fixture floor."]);
    await adapter.loadFloor(F1);
    expect(live.loadFloor).toHaveBeenCalledTimes(1);
  });

  it("a live floor after a building with no scan puts the chip back to live", async () => {
    initStatus({ configured: { ...configuredModes({}), matterport: "live" }, forced: [] });
    const scanned = { ...(await createFakeMatterport().loadFloor(F1))!, source: "matterport" as const };
    const adapter = withFixtureFloor({ loadFloor: async () => scanned }, createFakeMatterport(), reportFallback, () =>
      reportLive("matterport"),
    );
    await adapter.loadFloor({ id: "F2" });
    expect(statusChip(getStatus()).onFixtures).toContain("Matterport");
    expect((await adapter.loadFloor(F1))?.source).toBe("matterport");
    expect(statusChip(getStatus()).onFixtures).not.toContain("Matterport");
  });
});

describe("what AppShell renders the chip with (R1-M4)", () => {
  it("after the aerial route trips Vexcel and the map trips CoStar, both are on fixtures with their fallbacks", async () => {
    stubEnv({ ...LIVE_COSTAR, ...LIVE_VEXCEL });
    deadNetwork();
    expect(serverStatus(new Set())).toMatchObject({ configured: { costar: "live", vexcel: "live" }, fallbacks: [] });

    const vexcel = ((await (await aerial("F1")).json()) as { fallback?: Fallback }).fallback;
    let status = serverStatus(new Set());
    expect(status.configured).toMatchObject({ costar: "live", vexcel: "fake" });
    expect(status.fallbacks).toEqual([vexcel]);

    const costar = ((await (await buildings()).json()) as { fallback?: Fallback }).fallback;
    status = serverStatus(new Set(["llm"] as const));
    expect(status.configured).toMatchObject({ costar: "fake", vexcel: "fake" });
    expect(status.fallbacks).toEqual([costar, vexcel]);
    expect(status.forced).toEqual(["llm"]);

    // The chip a page shows from it.
    initStatus(status);
    expect(statusChip(getStatus()).onFixtures).toEqual(expect.arrayContaining(["CoStar", "Vexcel"]));
    expect(getStatus().toasts.map((t) => t.service).sort()).toEqual(["costar", "vexcel"]);
  });
});

describe("Scout's aerial fetch (R1-M4)", () => {
  const answer = (status: number, body: unknown) =>
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })));

  it("reports the fallback an aerial answer carries: one toast, and the chip switches Vexcel", async () => {
    stubEnv(LIVE_VEXCEL);
    initStatus({ configured: { ...configuredModes(process.env), vexcel: "live" }, forced: [] });
    const fallback = { service: "vexcel", id: "vexcel-test-1", message: "Vexcel didn't answer, so the aerial is a fixture massing." };
    const fixture = (await getVexcel({ forced: true }).adapter.getAerial("F1"))!;
    answer(200, { mode: "fake", aerial: fixture, fallback });

    const load = await fetchAerial("F1", new AbortController().signal);
    expect(load).toMatchObject({ status: "ready", live: false });
    expect(getStatus().toasts).toEqual([fallback]);
    expect(statusChip(getStatus()).onFixtures).toContain("Vexcel");
  });

  it("reports a fallback on an error answer too", async () => {
    initStatus({ configured: { ...configuredModes({}), vexcel: "live" }, forced: [] });
    const fallback = { service: "vexcel", id: "vexcel-test-2", message: "Vexcel didn't answer, so the aerial is a fixture massing." };
    answer(502, { mode: "fake", error: "boom", fallback });
    expect(await fetchAerial("F1", new AbortController().signal)).toMatchObject({ status: "error" });
    expect(getStatus().toasts).toEqual([fallback]);
  });
});

describe("forcing a service to fixtures (the demo settings)", () => {
  it("forcing CoStar switches the chip, and the next request uses the fake", async () => {
    stubEnv(LIVE_COSTAR);
    const fetch = deadNetwork();
    initStatus({ configured: { ...configuredModes(process.env), costar: "live" }, forced: [] });
    expect(statusChip(getStatus()).onFixtures).not.toContain("CoStar");

    // What the CoStar switch in the popover does.
    let cookie = "";
    setForced("costar", true, (value) => (cookie = `${FORCE_COOKIE}=${value}`));
    expect(statusChip(getStatus()).onFixtures).toContain("CoStar");
    expect(cookie).toBe(`${FORCE_COOKIE}=costar`);

    const body = (await (await buildings(`theme=dark; ${cookie}`)).json()) as { mode: string; buildings: Building[]; fallback?: Fallback };
    expect(body.mode).toBe("fake");
    expect(body.buildings).toHaveLength(5);
    expect(body.fallback).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();

    // Letting it go clears the cookie and the chip.
    setForced("costar", false, (value) => (cookie = value));
    expect(cookie).toBe("");
    expect(statusChip(getStatus()).onFixtures).not.toContain("CoStar");
  });

  it("forcing Matterport makes the board's next load use the fixture floor", async () => {
    stubEnv({ NEXT_PUBLIC_MATTERPORT_MODE: "live", NEXT_PUBLIC_MATTERPORT_SDK_KEY: "test-key" });
    initStatus({ configured: configuredModes(process.env), forced: [] });
    setForced("matterport", true, () => {});
    const selection = getMatterport();
    expect(selection.mode).toBe("fake");
    expect((await selection.adapter.loadFloor({ id: "F1", matterportModelId: "mp-test-f1" }))?.source).toBe("fixture");
  });
});
