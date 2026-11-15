import { defineConfig } from "@playwright/test";
import smoke from "./playwright.config";

// The Devpost gallery (issue #14): `npm run build`, then `npm run gallery`.
// The smoke's own server, in fake mode, so no Vexcel image or CoStar kit
// record ever lands in the repo (SPEC §4.5; Q3 and Q5 on the status issue).
// It walks the demo path at 1920×1080 and writes one 16:9 shot per screen to
// hackathon/submission/media/. Not part of the gate: the smoke covers the path.
export default defineConfig({
  ...smoke,
  testDir: "tests/gallery",
  use: { ...smoke.use, viewport: { width: 1920, height: 1080 } },
  projects: [{ name: "chromium", use: { ...smoke.projects![0].use, viewport: { width: 1920, height: 1080 } } }],
});
