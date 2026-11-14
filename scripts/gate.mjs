#!/usr/bin/env node
// The gate (SPEC §6): `npm run gate`. The CI workflow (#46) is to run exactly this.
//
// Node built-ins only, so it runs before `npm ci`. Steps run in order and the
// gate stops at the first failure, naming the step and its exit code. Any
// error thrown inside a step, expected or not, fails that step by name.
//
//   node scripts/gate.mjs          every step
//   node scripts/gate.mjs locate   step 0 only (installs nothing; its dependency
//                                  check needs `npm ci` to have run)
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aliasRoot } from "./alias.mjs";

/** Forced on every step, whatever `.env.local` or the shell says (SPEC §7). */
export const FAKE_ENV = Object.freeze({
  HEIST_MODE: "fake",
  LLM_MODE: "fake",
  COSTAR_MODE: "fake",
  VEXCEL_MODE: "fake",
  NEXT_PUBLIC_MATTERPORT_MODE: "fake",
});

/** A file the `@/` alias must resolve into this checkout's src/ (step 0). */
export const ALIAS_PROBE = "lib/locate.ts";
/** Runtime dependencies that must resolve from this checkout's node_modules. */
export const RUNTIME_DEPENDENCIES = ["next", "react"];
const FORBIDDEN_SEGMENTS = ["node_modules", ".next", "dist", ".claude"];

export class GateError extends Error {}

/** The smoke's port when nothing else decides it (SPEC §6 step 6). */
export const DEFAULT_PORT = "3100";

export function isCI(base = process.env) {
  return Boolean(base.CI) && !["false", "0"].includes(base.CI);
}

/** A port the OS reports free on 127.0.0.1, where the smoke's server listens. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(String(port)));
    });
  });
}

/**
 * The port the build, start and smoke steps share. An explicit PORT wins. CI
 * keeps 3100: a runner is a fresh machine with one gate on it. Otherwise
 * another gate may hold 3100 (two worktrees, two agents on the VM), so ask the
 * OS for a free port. It hands out ephemeral ports in turn, so two gates
 * started together get different ones; probing upward from 3100 would let
 * both see 3100 free at the start and collide at the smoke minutes later.
 */
export async function pickPort(base = process.env, find = freePort) {
  if (base.PORT) return base.PORT;
  if (isCI(base)) return DEFAULT_PORT;
  return find();
}

/** The environment every step runs with. */
export function gateEnv(base = process.env, port = DEFAULT_PORT) {
  return {
    ...base,
    ...FAKE_ENV,
    PORT: base.PORT || port,
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

// .native returns the on-disk case (a drive letter on Windows, for one).
const real = (p) => realpathSync.native(p);

/**
 * Step 0, first half: the package this gate belongs to must be the git top
 * level, and the gate must be run from there. Returns that directory.
 */
export function locateTop(packageDir, cwd = process.cwd()) {
  const pkg = real(packageDir);
  if (!existsSync(path.join(pkg, "package.json"))) {
    throw new GateError(`no package.json next to scripts/ in ${pkg}`);
  }
  const git = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: pkg, encoding: "utf8" });
  if (git.status !== 0) {
    throw new GateError(`${pkg} is not inside a git checkout: ${git.error?.message ?? git.stderr?.trim()}`);
  }
  const top = real(git.stdout.trim());
  if (pkg !== top) {
    throw new GateError(`the gate's package ${pkg} is not the git top level ${top}`);
  }
  if (real(cwd) !== top) {
    throw new GateError(`run the gate from ${top}, not ${real(cwd)}`);
  }
  return top;
}

/**
 * Fails unless `file` (already a realpath) sits under `top/<prefix>/` with no
 * build, install or worktree directory between. The check is on the path
 * relative to `top`, since a worktree's `top` is itself under .claude/.
 */
export function assertInside(top, file, prefix, what) {
  const rel = path.relative(top, file);
  const parts = rel.split(path.sep);
  if (rel.startsWith("..") || path.isAbsolute(rel) || parts[0] !== prefix) {
    throw new GateError(`${what} resolves to ${file}, outside ${path.join(top, prefix)}${path.sep}`);
  }
  const bad = parts.slice(0, -1).find((p) => FORBIDDEN_SEGMENTS.includes(p));
  if (bad) {
    throw new GateError(`${what} resolves to ${file}, through a ${bad}/ directory`);
  }
}

/** Step 0: `@/` (as Vitest, Next.js and tsc see it) must land in top/src/. */
export function checkAlias(top) {
  const target = path.join(aliasRoot(top), ALIAS_PROBE);
  if (!existsSync(target)) {
    throw new GateError(`@/${ALIAS_PROBE} resolves to ${target}, which does not exist`);
  }
  assertInside(top, real(target), "src", `@/${ALIAS_PROBE}`);
}

/**
 * Step 0, after install: each runtime dependency must resolve from
 * top/node_modules. Node walks up parent directories, so a worktree missing a
 * package would otherwise load the main checkout's copy without a word.
 */
export function checkDependencies(top, names = RUNTIME_DEPENDENCIES) {
  const require = createRequire(path.join(top, "package.json"));
  for (const name of names) {
    let resolved;
    try {
      resolved = real(require.resolve(`${name}/package.json`));
    } catch {
      throw new GateError(`${name} does not resolve from ${top}`);
    }
    const rel = path.relative(path.join(top, "node_modules"), resolved);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new GateError(`${name} resolves to ${resolved}, outside ${path.join(top, "node_modules")}${path.sep}`);
    }
  }
}

/** After the build: the root Next.js recorded must be this checkout. */
export function checkNextRoot(top) {
  const file = path.join(top, ".next", "required-server-files.json");
  if (!existsSync(file)) throw new GateError(`${file} is missing after the build`);
  const { appDir, config = {} } = JSON.parse(readFileSync(file, "utf8"));
  const roots = {
    appDir,
    outputFileTracingRoot: config.outputFileTracingRoot,
    "turbopack.root": config.turbopack?.root,
  };
  for (const [key, value] of Object.entries(roots)) {
    if (typeof value !== "string" || !existsSync(value) || real(value) !== top) {
      throw new GateError(`Next.js built with ${key} = ${value}, not ${top}`);
    }
  }
}

function run(command, args, { top, env }) {
  console.log(`$ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: top,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw new GateError(`${command} did not start: ${result.error.message}`);
  if (result.status !== 0) {
    const code = result.status ?? `signal ${result.signal}`;
    throw new GateError(`\`${[command, ...args].join(" ")}\` exited with ${code}`);
  }
}

export function steps(top, env) {
  const ci = isCI();
  const sh = (command, ...args) => () => run(command, args, { top, env });
  return [
    { id: "0", name: "locate", run: () => checkAlias(top) },
    {
      id: "1",
      name: "install",
      run: () => {
        run("npm", ["ci"], { top, env });
        run("npx", ["playwright", "install", ...(ci ? ["--with-deps"] : []), "chromium"], { top, env });
      },
    },
    { id: "0", name: "locate (installed dependencies)", run: () => checkDependencies(top) },
    { id: "2", name: "lint", run: sh("npm", "run", "lint") },
    { id: "3", name: "typecheck", run: sh("npm", "run", "typecheck") },
    { id: "4", name: "test", run: sh("npm", "run", "test") },
    {
      id: "5",
      name: "build",
      run: () => {
        run("npm", ["run", "build"], {
          top,
          env: { ...env, NODE_OPTIONS: [env.NODE_OPTIONS, "--max-old-space-size=1536"].filter(Boolean).join(" ") },
        });
        checkNextRoot(top);
      },
    },
    { id: "6", name: "smoke", run: sh("npm", "run", "smoke") },
  ];
}

export async function main(argv = process.argv.slice(2)) {
  const only = argv[0];
  if (only !== undefined && only !== "locate") {
    console.error(`gate: unknown argument ${only}; use no argument, or \`locate\``);
    return 2;
  }
  const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const results = [];
  let top;
  try {
    top = locateTop(packageDir);
  } catch (error) {
    return fail("0", "locate", error, results);
  }
  let env;
  try {
    env = gateEnv(process.env, await pickPort());
  } catch (error) {
    return fail("0", "locate (free port)", error, results);
  }
  console.log(`gate: testing ${top} (PORT=${env.PORT}, every service on fixtures)`);
  let list = steps(top, env);
  if (only === "locate") list = list.filter((s) => s.name.startsWith("locate"));
  for (const step of list) {
    console.log(`\ngate: step ${step.id} ${step.name}`);
    const started = Date.now();
    try {
      step.run();
    } catch (error) {
      return fail(step.id, step.name, error, results);
    }
    results.push(`step ${step.id} ${step.name}: passed (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  }
  console.log(`\ngate: summary\n${results.map((r) => `  ${r}`).join("\n")}\ngate: passed`);
  return 0;
}

function fail(id, name, error, results) {
  // A GateError is an expected failure and its message says it all; anything
  // else is unexpected, so its stack is printed too, but it still fails the
  // step by name.
  const message = error instanceof Error ? error.message : String(error);
  if (!(error instanceof GateError)) console.error(error instanceof Error ? error.stack : error);
  const done = results.map((r) => `  ${r}\n`).join("");
  console.error(`\ngate: summary\n${done}  step ${id} ${name}: FAILED: ${message}\ngate: failed at step ${id} (${name})`);
  return 1;
}

// Run main() when this file is the entry point. Both sides are realpath'd, so a
// symlinked path (with or without --preserve-symlinks-main) still runs the gate
// instead of silently doing nothing and exiting 0. A path that cannot be
// resolved throws, which fails loudly rather than skipping.
if (process.argv[1] && real(fileURLToPath(import.meta.url)) === real(process.argv[1])) {
  process.exitCode = await main();
}
