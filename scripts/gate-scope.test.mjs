import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { needsGate, UNGATED_DOCS } from "./gate-scope.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "gate-scope.mjs");
const root = path.join(here, "..");

describe("needsGate", () => {
  it.each([
    ["the spec alone", ["hackathon/SPEC.md"]],
    ["the two readmes and CLAUDE.md", ["README.md", "CLAUDE.md", "hackathon/README.md"]],
    ["the event, the decision and a track file", ["hackathon/EVENT.md", "hackathon/DECISION.md", "hackathon/tracks/prizes.md"]],
  ])("is false for %s", (_, paths) => {
    expect(needsGate(paths)).toBe(false);
  });

  it.each([
    ["the design direction, which a test reads", ["hackathon/DESIGN.md"]],
    ["a doc beside one source file", ["hackathon/SPEC.md", "src/engine/actions.ts"]],
    ["the workflow itself", [".github/workflows/gate.yml"]],
    ["a readme under src", ["src/agents/builder/README.md"]],
    ["a doc that is not on the list yet", ["hackathon/SUBMIT.md"]],
    ["the env example", [".env.example"]],
    ["a path that only starts like a listed doc", ["README.md.bak", "hackathon/SPEC.md/x"]],
  ])("is true for %s", (_, paths) => {
    expect(needsGate(paths)).toBe(true);
  });

  it("is true when there are no paths: an unreadable change is gated", () => {
    expect(needsGate([])).toBe(true);
    expect(needsGate(["", "  "])).toBe(true);
  });

  it("ignores blank lines and surrounding space around real paths", () => {
    expect(needsGate(["", " hackathon/SPEC.md ", ""])).toBe(false);
  });
});

describe("the ungated list against the code", () => {
  it("holds no doc that a test or script reads", () => {
    // The one doc the suite reads today. If this stops being true, DESIGN.md can join the list.
    const tokens = readFileSync(path.join(root, "src/app/tokens.test.ts"), "utf8");
    expect(tokens).toContain("hackathon/DESIGN.md");
    expect(UNGATED_DOCS.some((doc) => doc.test("hackathon/DESIGN.md"))).toBe(false);
  });
});

describe("as a program", () => {
  const run = (input) => spawnSync(process.execPath, [script], { input, encoding: "utf8" });

  it("prints code=false for docs only, in the form GITHUB_OUTPUT takes", () => {
    const result = run("hackathon/SPEC.md\nREADME.md\n");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("code=false\n");
  });

  it("prints code=true for a source file, and for no input", () => {
    expect(run("src/app/page.tsx\n").stdout).toBe("code=true\n");
    expect(run("").stdout).toBe("code=true\n");
  });

  it("reads Windows line endings", () => {
    expect(run("hackathon/SPEC.md\r\nREADME.md\r\n").stdout).toBe("code=false\n");
  });
});
