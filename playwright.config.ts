import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

// The smoke test (SPEC §6 step 6): a production server on PORT, always one
// this run started itself, in fake mode.
const port = Number(process.env.PORT ?? 3100);
const baseURL = `http://127.0.0.1:${port}`;

// testIgnore globs match absolute paths, and a worktree's own path contains
// `/.claude/worktrees/`, so `**/.claude/**` would ignore every test here.
// Exclude only the .claude/ directly under this project.
const root = path.dirname(fileURLToPath(import.meta.url));
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const underRoot = (dir: string) => new RegExp(`^${escape(path.join(root, dir))}[\\\\/]`);

export default defineConfig({
  testDir: "tests/smoke",
  testIgnore: [underRoot(".claude"), underRoot("node_modules")],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    // Playwright gives a click, fill or read no limit of its own, and a goto
    // none either, so a hung one ran until its test's timeout: 90 s on the
    // demo path (#85). An action on a ready page takes well under a second,
    // and a few seconds on a loaded VM; a page this server renders loads in
    // under 2 s there. 10 s and 15 s fail a hung one on its own line, long
    // before any test's budget. Outcome waits keep their own timeouts.
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next start --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    // Never reuse a server already on the port: it could be another
    // worktree's build, and the smoke would then test that code.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      HEIST_MODE: "fake",
      LLM_MODE: "fake",
      COSTAR_MODE: "fake",
      VEXCEL_MODE: "fake",
      NEXT_PUBLIC_MATTERPORT_MODE: "fake",
      // The fictional test kit's one building opens by id, for the recorded
      // kit path (kit-path.spec.ts, #95). The map and the fixtures are unchanged.
      HEIST_TEST_KIT: "1",
    },
  },
});
