// The server's breakers are one per process, not one per bundle (PR #72,
// R1-C1). A production build loads the adapters once per route handler and
// once for the pages; here each `vi.resetModules()` + `import()` stands for
// one such bundle, with its own copy of every module. A live failure in the
// aerial route must show in the chip AppShell renders, and `demo:reset` must
// put every bundle's breaker back without a restart.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoReset } from "../../scripts/demo-reset.mjs";
import type { Fallback } from "./fallback";
import { resetServerSlots } from "./server-breakers";

const LIVE = {
  HEIST_MODE: "",
  COSTAR_MODE: "live",
  VEXCEL_MODE: "live",
  VEXCEL_API_BASE: "https://vexcel.test/api",
  VEXCEL_API_KEY: "test-key",
};

/**
 * The bundles and route calls the current test has started. A test that times
 * out keeps running; afterEach waits for its work to settle before unstubbing,
 * or its next fetch lands on the following test's stub (#85).
 */
const pending = new Set<Promise<unknown>>();
function track<T>(work: Promise<T>): Promise<T> {
  pending.add(work);
  const settled = () => pending.delete(work);
  work.then(settled, settled);
  return work;
}

const tracked =
  <A extends unknown[], T>(call: (...args: A) => Promise<T>) =>
  (...args: A) =>
    track(call(...args));

/** A fresh copy of every module, as a separate bundle of the build has. */
const bundle = tracked(async () => {
  vi.resetModules();
  const [aerialRoute, buildingsRoute, shell, status] = await Promise.all([
    import("@/app/api/buildings/[id]/aerial/route"),
    import("@/app/api/buildings/route"),
    import("@/components/shell/app-shell"),
    import("./demo-status"),
  ]);
  return {
    aerial: tracked(
      async (id: string = "F1") =>
        (await (
          await aerialRoute.GET(new Request(`http://localhost/api/buildings/${id}/aerial`), { params: Promise.resolve({ id }) })
        ).json()) as { mode: string; fallback?: Fallback },
    ),
    buildings: tracked(
      async () => (await (await buildingsRoute.GET(new Request("http://localhost/api/buildings"))).json()) as { mode: string; fallback?: Fallback },
    ),
    serverStatus: () => shell.serverStatus(new Set()),
    /** The chip the browser shows for a page AppShell rendered from this bundle. */
    chip: () => {
      status.resetStatus();
      const server = shell.serverStatus(new Set());
      status.initStatus({ configured: server.configured, forced: server.forced, fallbacks: server.fallbacks });
      return status.statusChip(status.getStatus());
    },
  };
});

/** A throwaway git repo for `demo:reset` to reset, with its own `.heist/`. */
function repo(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "heist-breakers-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "test");
  mkdirSync(path.join(root, "data", "levels"), { recursive: true });
  writeFileSync(path.join(root, "data", "levels", "F1.json"), "{}\n");
  git("add", ".");
  git("commit", "-q", "-m", "levels");
  return root;
}

let root: string;
let fetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  root = repo();
  for (const [name, value] of Object.entries(LIVE)) vi.stubEnv(name, value);
  vi.stubEnv("HEIST_STATE_DIR", path.join(root, ".heist"));
  // A kit directory that does not exist: live CoStar fails on its first call.
  vi.stubEnv("COSTAR_KIT_DIR", path.join(root, "no-kit"));
  fetch = vi.fn(async () => {
    throw new TypeError("fetch failed");
  });
  vi.stubGlobal("fetch", fetch);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  resetServerSlots();
});

afterEach(async () => {
  // A timed-out test's work can start more as it settles: drain until none is left.
  while (pending.size) await Promise.allSettled(pending);
  rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetServerSlots();
}, 30_000); // the drain can wait on a bundle's imports, as the test above does

describe("the server's breakers, across bundles", () => {
  // Each new bundle re-imports the routes and the shell: about 0.5 s alone,
  // 2.4 s pinned to one busy CPU, and past the 5 s default with two gates on
  // the 2-vCPU VM (#85). 30 s is several times the worst seen; a broken
  // breaker still fails on its assertions, not on this.
  it("a Vexcel failure in the aerial route shows in the chip a page renders from another bundle", { timeout: 30_000 }, async () => {
    const pages = await bundle();
    expect(pages.serverStatus().configured.vexcel).toBe("live");
    expect(pages.chip().onFixtures).not.toContain("Vexcel");

    const routes = await bundle();
    const tripped = await routes.aerial();
    expect(tripped).toMatchObject({ mode: "fake", fallback: { service: "vexcel" } });

    // The pages' bundle never called Vexcel itself, and still says so.
    const status = pages.serverStatus();
    expect(status.configured.vexcel).toBe("fake");
    expect(status.fallbacks).toContainEqual(tripped.fallback);
    expect(pages.chip().onFixtures).toContain("Vexcel");
  });

  it("one CoStar failure trips CoStar for every bundle: the next bundle goes straight to the fixtures", async () => {
    const first = await (await bundle()).buildings();
    expect(first.fallback?.service).toBe("costar");

    // A second trip would carry a new id: the same id means the breaker held.
    const second = await (await bundle()).buildings();
    expect(second.fallback?.id).toBe(first.fallback!.id);
  });

  it("demo:reset puts every bundle's breaker back: the chip and the adapters return to live, with no restart", async () => {
    const pages = await bundle();
    const routes = await bundle();
    // Reading the chip reads the epoch once before the reset, as a running server has.
    const before = pages.chip().onFixtures;
    expect(before).not.toContain("Vexcel");
    expect(before).not.toContain("CoStar");

    await routes.aerial();
    await routes.buildings();
    expect(pages.chip().onFixtures).toEqual(expect.arrayContaining(["CoStar", "Vexcel"]));

    demoReset({ root });

    // The page's bundle reads the new epoch: the chip is back where it started.
    expect(pages.chip().onFixtures).toEqual(before);
    expect(pages.serverStatus()).toMatchObject({ configured: { costar: "live", vexcel: "live" }, fallbacks: [] });

    // And the routes' adapters try live again: the next call reaches the network.
    const calls = fetch.mock.calls.length;
    const retried = await routes.aerial();
    expect(fetch.mock.calls.length).toBeGreaterThan(calls);
    expect(retried.fallback?.service).toBe("vexcel");
  });

  it("demo:reset reaches a route handler even when no page renders in between", async () => {
    const routes = await bundle();
    const tripped = await routes.aerial();
    demoReset({ root });
    const calls = fetch.mock.calls.length;
    const retried = await routes.aerial();
    expect(fetch.mock.calls.length).toBeGreaterThan(calls);
    expect(retried.fallback?.id).not.toBe(tripped.fallback?.id);
  });
});
