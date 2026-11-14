import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

// The smoke test (SPEC §6 step 6): a production server on PORT, always one
// this run started itself, in fake mode. The gate sets PORT to a free port
// outside CI, so parallel gates do not collide (#150).
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
  use: { baseURL, trace: "retain-on-failure" },
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
    },
  },
});
