import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, getStatus, initStatus, isForced, MAX_TOASTS, noteResponse, reportFallback, resetStatus, setForced, statusChip } from "./demo-status";
import { Breaker, fallbackMessage, fallbackOf, newFallback, withFallback, withLlmFallback } from "./fallback";
import { configuredModes, FORCE_COOKIE, forcedCookieValue, forcedFromCookieHeader, missingForLive, parseForced, SERVICE_IDS } from "./mode";

const ALL_LIVE = { llm: "live", costar: "live", vexcel: "live", matterport: "live" } as const;

beforeEach(() => resetStatus());

describe("which services can answer live (missingForLive, configuredModes)", () => {
  it("names the variables each service still needs", () => {
    expect(missingForLive("costar", {})).toEqual(["COSTAR_API_BASE", "COSTAR_API_KEY"]);
    expect(missingForLive("costar", { COSTAR_API_BASE: "b" })).toEqual(["COSTAR_API_KEY"]);
    expect(missingForLive("vexcel", { VEXCEL_API_KEY: "k" })).toEqual(["VEXCEL_API_BASE"]);
    expect(missingForLive("matterport", {})).toEqual(["NEXT_PUBLIC_MATTERPORT_SDK_KEY"]);
    expect(missingForLive("llm", {})).toEqual(["ANTHROPIC_API_KEY"]);
    expect(missingForLive("llm", { LLM_PROVIDER: "bedrock" })).toEqual(["BEDROCK_ENABLED"]);
    expect(missingForLive("llm", { LLM_PROVIDER: "bedrock", BEDROCK_ENABLED: "1" })).toEqual([]);
  });

  it("is live only where live is asked for and nothing is missing", () => {
    expect(configuredModes({ HEIST_MODE: "live" })).toEqual({ llm: "fake", costar: "fake", vexcel: "fake", matterport: "fake" });
    expect(
      configuredModes({ HEIST_MODE: "live", COSTAR_API_BASE: "b", COSTAR_API_KEY: "k", VEXCEL_MODE: "fake", VEXCEL_API_BASE: "b", VEXCEL_API_KEY: "k" }),
    ).toEqual({ llm: "fake", costar: "live", vexcel: "fake", matterport: "fake" });
  });
});

describe("the forced-fixtures cookie", () => {
  it("round-trips through the cookie value and a Cookie header, ignoring unknown names", () => {
    const value = forcedCookieValue(new Set(["vexcel", "costar"] as const));
    expect(value).toBe("costar.vexcel");
    expect([...parseForced(`${value}.nonsense`)]).toEqual(["costar", "vexcel"]);
    expect([...forcedFromCookieHeader(`a=1; ${FORCE_COOKIE}=${value}; b=2`)]).toEqual(["costar", "vexcel"]);
    expect(forcedFromCookieHeader(null).size).toBe(0);
    expect(forcedFromCookieHeader("heist-fixturesX=costar").size).toBe(0);
  });
});

describe("fallbacks", () => {
  it("name the service in one line (DESIGN.md, States)", () => {
    expect(fallbackMessage("costar")).toBe("CoStar didn't answer, so buildings use fixtures.");
    expect(fallbackMessage("vexcel", "timeout")).toBe("Vexcel didn't answer in time, so the aerial is a fixture massing.");
    expect(fallbackMessage("llm")).toBe("The model didn't answer, so a recorded reply stands in.");
    for (const service of SERVICE_IDS) expect(newFallback(service).id).not.toBe(newFallback(service).id);
  });

  it("are read from a response body only when well formed", () => {
    const f = newFallback("costar");
    expect(fallbackOf({ fallback: f })).toEqual(f);
    expect(fallbackOf({ fallback: { ...f, service: "elsewhere" } })).toBeNull();
    expect(fallbackOf({})).toBeNull();
    expect(fallbackOf(null)).toBeNull();
  });

  it("are added to a model answer only for a timeout or an error", () => {
    expect(withLlmFallback({ reason: "fake mode" }).fallback).toBeUndefined();
    expect(withLlmFallback({ reason: undefined }).fallback).toBeUndefined();
    expect(withLlmFallback({ reason: "timeout" }).fallback?.message).toBe("The model didn't answer in time, so a recorded reply stands in.");
    expect(withLlmFallback({ reason: "error" }).fallback?.service).toBe("llm");
  });

  it("withFallback answers from the fake after a failure, trips once, and then skips live", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const live = { get: vi.fn(async (id: string) => Promise.reject(new Error(`down ${id}`))) };
    const fake = { get: vi.fn(async (id: string) => `fixture ${id}`) };
    const breaker = new Breaker("costar");
    const guarded = withFallback(live, fake, breaker);
    expect(await guarded.get("F1")).toBe("fixture F1");
    const tripped = breaker.tripped;
    expect(tripped?.service).toBe("costar");
    expect(await guarded.get("F2")).toBe("fixture F2");
    expect(live.get).toHaveBeenCalledTimes(1);
    expect(breaker.tripped).toBe(tripped);
    breaker.reset();
    expect(breaker.tripped).toBeNull();
  });

  it("withFallback passes a live answer through", async () => {
    const guarded = withFallback({ get: async () => "live" }, { get: async () => "fake" }, new Breaker("vexcel"));
    expect(await guarded.get()).toBe("live");
  });

  it("call a timeout a timeout", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const breaker = new Breaker("vexcel");
    breaker.trip(Object.assign(new Error("The operation timed out."), { name: "TimeoutError" }));
    expect(breaker.tripped?.message).toBe("Vexcel didn't answer in time, so the aerial is a fixture massing.");
  });
});

describe("the browser's status store", () => {
  afterEach(() => vi.restoreAllMocks());

  it("toasts each fallback once, however many responses repeat it", () => {
    initStatus({ configured: ALL_LIVE, forced: [] });
    const costar = newFallback("costar");
    noteResponse({ fallback: costar });
    noteResponse({ fallback: costar });
    reportFallback(costar);
    expect(getStatus().toasts).toEqual([costar]);
    const vexcel = newFallback("vexcel");
    noteResponse({ fallback: vexcel });
    expect(getStatus().toasts.map((t) => t.service)).toEqual(["costar", "vexcel"]);
    expect(statusChip(getStatus())).toEqual({ label: "LIVE", onFixtures: ["CoStar", "Vexcel"] });
  });

  it("toasts the fallbacks the server rendered with, and keeps the ones seen before it", () => {
    const early = newFallback("costar");
    reportFallback(early);
    const server = newFallback("vexcel");
    initStatus({ configured: ALL_LIVE, forced: [], fallbacks: [server, early] });
    expect(getStatus().toasts.map((t) => t.id)).toEqual([early.id, server.id]);
    expect(statusChip(getStatus()).onFixtures).toEqual(["CoStar", "Vexcel"]);
  });

  it("never toasts again a fallback this session has seen, even one reported before initStatus runs (#68)", () => {
    // A full page load: the module is fresh, but the session has toasted Matterport's "no scan" before.
    // The Run screen's adapter reports it again before DemoSafety's effect calls initStatus.
    const noScan = { service: "matterport", id: "matterport-no-scan-F1", message: "No scan." } as const;
    const store = new Map([["heist:seen-fallbacks", JSON.stringify([noScan.id])]]);
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    try {
      reportFallback(noScan);
      initStatus({ configured: ALL_LIVE, forced: [], fallbacks: [noScan] });
      expect(getStatus().toasts).toEqual([]);
      // The chip still says Matterport is on fixtures: only the toast is not repeated.
      expect(statusChip(getStatus()).onFixtures).toEqual(["Matterport"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps at most a few toasts, and dismisses one by id", () => {
    initStatus({ configured: ALL_LIVE, forced: [] });
    const all = Array.from({ length: MAX_TOASTS + 2 }, () => newFallback("llm"));
    for (const f of all) reportFallback(f);
    expect(getStatus().toasts).toEqual(all.slice(-MAX_TOASTS));
    dismissToast(all.at(-1)!.id);
    expect(getStatus().toasts).toHaveLength(MAX_TOASTS - 1);
  });

  it("says FIXTURES when everything is forced, and writes the cookie each time", () => {
    initStatus({ configured: ALL_LIVE, forced: ["llm"] });
    const writes: string[] = [];
    for (const service of ["costar", "vexcel", "matterport"] as const) setForced(service, true, (v) => writes.push(v));
    expect(statusChip(getStatus())).toEqual({ label: "FIXTURES", onFixtures: ["Model", "CoStar", "Vexcel", "Matterport"] });
    expect(writes).toEqual(["llm.costar", "llm.costar.vexcel", "llm.costar.vexcel.matterport"]);
  });
});

describe("after demo:reset expired the forced cookie (R1-C2)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetStatus();
  });

  it("takes the forced services from the browser's cookie, not the server's stale copy", () => {
    // The server rendered with `heist-fixtures=vexcel`; the epoch script has since expired it.
    vi.stubGlobal("document", { cookie: "theme=dark" });
    initStatus({ configured: ALL_LIVE, forced: ["vexcel"] });
    expect([...getStatus().forced]).toEqual([]);
    expect(statusChip(getStatus())).toEqual({ label: "LIVE", onFixtures: [] });

    // A later toggle does not write the stale service back into the cookie.
    const writes: string[] = [];
    setForced("costar", true, (v) => writes.push(v));
    expect(writes).toEqual(["costar"]);
  });

  it("still honours a cookie that is set", () => {
    vi.stubGlobal("document", { cookie: `${FORCE_COOKIE}=costar.vexcel` });
    initStatus({ configured: ALL_LIVE, forced: [] });
    expect(statusChip(getStatus()).onFixtures).toEqual(["CoStar", "Vexcel"]);
  });

  it("answers isForced from the cookie before the store is initialised", () => {
    vi.stubGlobal("document", { cookie: `${FORCE_COOKIE}=matterport` });
    expect(isForced("matterport")).toBe(true);
    expect(isForced("costar")).toBe(false);
  });

  it("a malformed cookie forces nothing rather than throwing", () => {
    expect(forcedFromCookieHeader(`${FORCE_COOKIE}=%E0%A4%A`).size).toBe(0);
  });
});
