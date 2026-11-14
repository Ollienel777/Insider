// The gate's step 0, run for real against throwaway copies of this package:
// a copy that is not the git top level, an alias that leaves src/, and a
// dependency Node finds outside the copy's own node_modules must each fail.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { FAKE_ENV, GateError, checkNextRoot, gateEnv } from "./gate.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.dirname(here);
const scratch = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "gate-test-")));
  scratch.push(dir);
  return dir;
}

// Stops git from finding a repository above the scratch directory.
function gitEnv(dir) {
  const env = { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(dir) };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return env;
}

function fakePackage(dir, name) {
  mkdirSync(path.join(dir, name), { recursive: true });
  writeFileSync(path.join(dir, name, "package.json"), JSON.stringify({ name, version: "0.0.0" }));
}

/** A minimal copy of this package at `dir`: the gate, its alias, the probe. */
function copyPackage(dir, { deps = true } = {}) {
  mkdirSync(path.join(dir, "scripts"), { recursive: true });
  for (const file of ["package.json", "tsconfig.json", "scripts/gate.mjs", "scripts/alias.mjs", "src/lib/locate.ts"]) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    cpSync(path.join(repo, file), path.join(dir, file));
  }
  if (deps) for (const name of ["next", "react"]) fakePackage(path.join(dir, "node_modules"), name);
}

function gitInit(dir, scratchRoot) {
  const result = spawnSync("git", ["init", "-q", dir], { env: gitEnv(scratchRoot) });
  expect(result.status).toBe(0);
}

// Output paths use "/" whatever the platform, so the assertions hold on Windows.
function locate(dir, scratchRoot, cwd = dir, { script = path.join(dir, "scripts", "gate.mjs"), nodeArgs = [] } = {}) {
  const result = spawnSync(process.execPath, [...nodeArgs, script, "locate"], {
    cwd,
    env: gitEnv(scratchRoot),
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}`.replaceAll("\\", "/") };
}

function setAlias(dir, target) {
  const file = path.join(dir, "tsconfig.json");
  const config = JSON.parse(readFileSync(file, "utf8"));
  config.compilerOptions.paths["@/*"] = [target];
  writeFileSync(file, JSON.stringify(config));
}

describe("gate step 0 (locate)", () => {
  it("passes for a package that is its own git top level", () => {
    const root = tempDir();
    const top = path.join(root, "app");
    copyPackage(top);
    gitInit(top, root);
    const { status, output } = locate(top, root);
    expect(output).toContain("gate: passed");
    expect(status).toBe(0);
  });

  it.each([[[]], [["--preserve-symlinks-main"]]])("runs when started through a symlinked path (node args %j)", (nodeArgs) => {
    const root = tempDir();
    const top = path.join(root, "app");
    copyPackage(top);
    gitInit(top, root);
    symlinkSync(path.join(top, "scripts"), path.join(top, "linked"), "junction");
    const { status, output } = locate(top, root, top, { script: path.join(top, "linked", "gate.mjs"), nodeArgs });
    expect(output).toContain("gate: summary");
    expect(output).toContain("gate: passed");
    expect(status).toBe(0);
  });

  it("fails when the package is a copy below the git top level", () => {
    const root = tempDir();
    gitInit(root, root);
    const copy = path.join(root, "copy");
    copyPackage(copy);
    const { status, output } = locate(copy, root);
    expect(status).toBe(1);
    expect(output).toContain("is not the git top level");
    expect(output).toContain("gate: failed at step 0 (locate)");
  });

  it("fails when the package is not in a git checkout at all", () => {
    const root = tempDir();
    const copy = path.join(root, "copy");
    copyPackage(copy);
    const { status, output } = locate(copy, root);
    expect(status).toBe(1);
    expect(output).toContain("is not inside a git checkout");
  });

  it("fails when run from another directory than the package", () => {
    const root = tempDir();
    const top = path.join(root, "app");
    copyPackage(top);
    gitInit(top, root);
    const { status, output } = locate(top, root, root);
    expect(status).toBe(1);
    expect(output).toContain("run the gate from");
  });

  it("fails when the @/ alias resolves outside top/src/", () => {
    const root = tempDir();
    const top = path.join(root, "app");
    copyPackage(top);
    gitInit(top, root);
    // The same probe file exists in a sibling checkout's src/.
    copyPackage(path.join(root, "main"), { deps: false });
    setAlias(top, "../main/src/*");
    const { status, output } = locate(top, root);
    expect(status).toBe(1);
    expect(output).toMatch(/@\/lib\/locate\.ts resolves to .*main\/src\/lib\/locate\.ts, outside/);
    expect(output).toContain("gate: failed at step 0 (locate)");
  });

  it("fails when the @/ alias resolves inside top but outside src/", () => {
    const root = tempDir();
    const top = path.join(root, "app");
    copyPackage(top);
    gitInit(top, root);
    mkdirSync(path.join(top, "other", "lib"), { recursive: true });
    cpSync(path.join(repo, "src/lib/locate.ts"), path.join(top, "other", "lib", "locate.ts"));
    setAlias(top, "./other/*");
    const { status, output } = locate(top, root);
    expect(status).toBe(1);
    expect(output).toMatch(/resolves to .*other\/lib\/locate\.ts, outside/);
  });

  it("names the step when a step throws an unexpected error", () => {
    const root = tempDir();
    const top = path.join(root, "app");
    copyPackage(top);
    gitInit(top, root);
    // tsc and Next.js accept a JSONC tsconfig; the alias reader does not.
    const file = path.join(top, "tsconfig.json");
    writeFileSync(file, `// a comment\n${readFileSync(file, "utf8")}`);
    const { status, output } = locate(top, root);
    expect(status).toBe(1);
    expect(output).toContain("step 0 locate: FAILED: ");
    expect(output).toContain("gate: failed at step 0 (locate)");
  });

  it("fails when the @/ alias goes through an installed copy inside top", () => {
    const root = tempDir();
    const top = path.join(root, "app");
    copyPackage(top);
    gitInit(top, root);
    const vendored = path.join(top, "src", "node_modules", "app");
    mkdirSync(path.join(vendored, "lib"), { recursive: true });
    cpSync(path.join(repo, "src/lib/locate.ts"), path.join(vendored, "lib", "locate.ts"));
    setAlias(top, "./src/node_modules/app/*");
    const { status, output } = locate(top, root);
    expect(status).toBe(1);
    expect(output).toContain("through a node_modules/ directory");
  });

  it("fails when a runtime dependency resolves from an outer checkout's node_modules", () => {
    const root = tempDir();
    // The main checkout has next installed; the worktree inside it has none.
    for (const name of ["next", "react"]) fakePackage(path.join(root, "node_modules"), name);
    const top = path.join(root, "worktree");
    copyPackage(top, { deps: false });
    gitInit(top, root);
    const { status, output } = locate(top, root);
    expect(status).toBe(1);
    expect(output).toMatch(/next resolves to .*\/node_modules\/next\/package\.json, outside .*worktree\/node_modules/);
    expect(output).toContain("gate: failed at step 0 (locate (installed dependencies))");
  });

  it("fails when top/node_modules links a dependency to another checkout", () => {
    const root = tempDir();
    fakePackage(path.join(root, "shared"), "next");
    const top = path.join(root, "app");
    copyPackage(top);
    rmSync(path.join(top, "node_modules", "next"), { recursive: true });
    // "junction" needs no symlink privilege on Windows and is ignored elsewhere.
    symlinkSync(path.join(root, "shared", "next"), path.join(top, "node_modules", "next"), "junction");
    gitInit(top, root);
    const { status, output } = locate(top, root);
    expect(status).toBe(1);
    expect(output).toContain("next resolves to");
  });
});

describe("gateEnv", () => {
  it("forces fake mode on every service, over the caller's environment", () => {
    const env = gateEnv({
      HEIST_MODE: "live",
      LLM_MODE: "live",
      COSTAR_MODE: "live",
      VEXCEL_MODE: "live",
      NEXT_PUBLIC_MATTERPORT_MODE: "live",
    });
    expect(Object.keys(FAKE_ENV).sort()).toEqual(
      ["COSTAR_MODE", "HEIST_MODE", "LLM_MODE", "NEXT_PUBLIC_MATTERPORT_MODE", "VEXCEL_MODE"],
    );
    for (const name of Object.keys(FAKE_ENV)) expect(env[name]).toBe("fake");
  });

  it("defaults PORT to 3100 and keeps one the caller set", () => {
    expect(gateEnv({}).PORT).toBe("3100");
    expect(gateEnv({ PORT: "3101" }).PORT).toBe("3101");
  });
});

describe("checkNextRoot", () => {
  function built(top, config, appDir = top) {
    mkdirSync(path.join(top, ".next"), { recursive: true });
    writeFileSync(path.join(top, ".next", "required-server-files.json"), JSON.stringify({ appDir, config }));
  }

  it("passes when Next.js recorded this checkout as its root", () => {
    const top = tempDir();
    built(top, { outputFileTracingRoot: top, turbopack: { root: top } });
    expect(() => checkNextRoot(top)).not.toThrow();
  });

  it("fails when Next.js inferred an outer checkout as its root", () => {
    const outer = tempDir();
    const top = path.join(outer, "worktree");
    mkdirSync(top);
    built(top, { outputFileTracingRoot: outer, turbopack: { root: top } });
    expect(() => checkNextRoot(top)).toThrow(GateError);
    built(top, { outputFileTracingRoot: top, turbopack: { root: outer } });
    expect(() => checkNextRoot(top)).toThrow(/turbopack\.root/);
    built(top, { outputFileTracingRoot: top, turbopack: { root: top } }, outer);
    expect(() => checkNextRoot(top)).toThrow(/appDir/);
  });

  it("fails when the build left no record", () => {
    expect(() => checkNextRoot(tempDir())).toThrow(/missing after the build/);
  });
});
