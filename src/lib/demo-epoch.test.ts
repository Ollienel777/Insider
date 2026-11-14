import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCoStar, resetCoStar } from "@/adapters/costar";
import { getVexcel, resetVexcel } from "@/adapters/vexcel";
import { demoEpochScript, EPOCH_FILE, readDemoEpoch, syncDemoEpoch } from "./demo-epoch";

/** A Storage on a Map, as much of it as the script uses. */
class MemoryStorage {
  map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

/** Runs the inline script against a fake browser; returns what it left. */
function runScript(epoch: string, local: MemoryStorage, session = new MemoryStorage(), cookie = "") {
  const document = { cookie };
  const reload = vi.fn();
  new Function("window", "document", demoEpochScript(epoch))({ localStorage: local, sessionStorage: session, location: { reload } }, document);
  return { local, session, cookie: document.cookie, reloads: reload.mock.calls.length };
}

describe("the demo epoch script (what the browser does after npm run demo:reset)", () => {
  it("clears run logs, crew plans and seen fallbacks, keeps other sites' keys, and expires the forced cookie", () => {
    const local = new MemoryStorage();
    local.setItem("heist:run-log:F1", '{"turns":14}');
    local.setItem("heist:crew-plan:F1", "{}");
    local.setItem("heist:demo-epoch", "2026-11-14T09:00:00.000Z");
    local.setItem("other-app", "keep");
    const session = new MemoryStorage();
    session.setItem("heist:seen-fallbacks", "[]");

    const after = runScript("2026-11-15T12:00:00.000Z", local, session);
    expect([...after.local.map.entries()]).toEqual([
      ["other-app", "keep"],
      ["heist:demo-epoch", "2026-11-15T12:00:00.000Z"],
    ]);
    expect(after.session.length).toBe(0);
    expect(after.cookie).toBe("heist-fixtures=; path=/; Max-Age=0; SameSite=Lax");
  });

  it("does nothing once the browser has seen this epoch, so a new run log survives the next page", () => {
    const local = new MemoryStorage();
    local.setItem("heist:demo-epoch", "e1");
    local.setItem("heist:run-log:F1", "{}");
    const after = runScript("e1", local);
    expect(after.local.getItem("heist:run-log:F1")).toBe("{}");
    expect(after.cookie).toBe("");
  });

  it("reloads once when it expired a cookie that forced a service, so no page rendered with it is shown", () => {
    // The server rendered this page with Vexcel forced to fixtures (R1-C2).
    const local = new MemoryStorage();
    const forced = runScript("e2", local, new MemoryStorage(), "theme=dark; heist-fixtures=vexcel");
    expect(forced.reloads).toBe(1);
    expect(forced.cookie).toBe("heist-fixtures=; path=/; Max-Age=0; SameSite=Lax");
    // The reloaded page has seen this epoch: no second reload.
    expect(runScript("e2", local, new MemoryStorage(), "theme=dark").reloads).toBe(0);
    // Nothing was forced: nothing to reload for.
    expect(runScript("e3", new MemoryStorage(), new MemoryStorage(), "theme=dark; heist-fixtures=").reloads).toBe(0);
    expect(runScript("e3", new MemoryStorage()).reloads).toBe(0);
  });

  it("cannot be closed early by the epoch's text", () => {
    expect(demoEpochScript("</script><script>alert(1)")).not.toContain("</script>");
  });
});

describe("reading the epoch on the server", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetCoStar();
  });

  it("is null before the first reset", () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "heist-epoch-"));
    expect(readDemoEpoch(dir)).toBeNull();
    writeFileSync(path.join(dir, EPOCH_FILE), "2026-11-15T12:00:00.000Z\n");
    expect(readDemoEpoch(dir)).toBe("2026-11-15T12:00:00.000Z");
  });

  it("a new epoch lets CoStar try live again after a failure", async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "heist-epoch-"));
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("HEIST_MODE", "");
    vi.stubEnv("COSTAR_MODE", "live");
    // A kit directory that does not exist: the first CoStar call fails.
    vi.stubEnv("COSTAR_KIT_DIR", path.join(dir, "no-kit"));
    resetCoStar();

    syncDemoEpoch(dir);
    await getCoStar().adapter.listBuildings("LA");
    expect(getCoStar().mode).toBe("fake");

    syncDemoEpoch(dir);
    expect(getCoStar().mode).toBe("fake");

    writeFileSync(path.join(dir, EPOCH_FILE), "after-reset\n");
    expect(syncDemoEpoch(dir)).toBe("after-reset");
    expect(getCoStar().mode).toBe("live");
  });

  it("a new epoch lets Vexcel try live again after a failure", async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "heist-epoch-"));
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("HEIST_MODE", "");
    vi.stubEnv("HEIST_STATE_DIR", dir);
    vi.stubEnv("VEXCEL_MODE", "live");
    vi.stubEnv("VEXCEL_API_BASE", "https://vexcel.test/api");
    vi.stubEnv("VEXCEL_API_KEY", "test-key");
    vi.stubGlobal("fetch", async () => Promise.reject(new TypeError("fetch failed")));
    resetVexcel();

    await getVexcel().adapter.getAerial("F1");
    expect(getVexcel()).toMatchObject({ mode: "fake", fallback: { service: "vexcel" } });

    writeFileSync(path.join(dir, EPOCH_FILE), "after-reset\n");
    expect(syncDemoEpoch()).toBe("after-reset");
    expect(getVexcel()).toMatchObject({ mode: "live" });
    expect(getVexcel().fallback).toBeUndefined();
    resetVexcel();
  });
});
