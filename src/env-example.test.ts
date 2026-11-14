// `.env.example` lists every variable the app reads (SPEC §7). This scans every
// non-test module under src/ for environment reads and fails on a name the
// file does not list, so a new variable cannot ship without its entry.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { missingForLive, SERVICES, SERVICE_IDS } from "@/lib/mode";

const src = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(src);

// Set by the framework, never by a deployer, so they have no place in
// `.env.example`: Next.js and Node tooling set NODE_ENV for the build and the
// server, and Next.js sets NEXT_RUNTIME to `nodejs` or `edge` per bundle.
const FRAMEWORK = new Set(["NODE_ENV", "NEXT_RUNTIME"]);

const NAME = "[A-Z_][A-Z0-9_]*";
const PROCESS_ENV = ["process", "env"].join("\\s*\\.\\s*");
// `process.env.X`, and `env.X` where an adapter takes `process.env` as `env`.
const DOT = new RegExp(`\\b(?:${PROCESS_ENV}|env)\\s*\\??\\.\\s*(${NAME})\\b`, "g");
// `process.env["X"]`, `process.env['X']`, `` process.env[`X`] ``, and the same on `env`.
const INDEX = new RegExp(`\\b(?:${PROCESS_ENV}|env)\\s*\\??\\.?\\[\\s*(["'\`])(${NAME})\\1\\s*\\]`, "g");
// `const { X, Y: y, Z = "d", ...rest } = process.env`.
const DESTRUCTURE = new RegExp(`\\{([^{}]*)\\}\\s*=\\s*${PROCESS_ENV}\\b`, "g");

/** Every environment variable name `source` reads statically. */
function envReads(source: string): string[] {
  const names = new Set<string>();
  for (const m of source.matchAll(DOT)) names.add(m[1]);
  for (const m of source.matchAll(INDEX)) names.add(m[2]);
  for (const m of source.matchAll(DESTRUCTURE)) {
    for (const part of m[1].split(",")) {
      const key = part.trim().split(/[:=]/)[0].trim();
      if (new RegExp(`^${NAME}$`).test(key)) names.add(key);
    }
  }
  return [...names].sort();
}

/** The names `.env.example` lists, one `NAME=` per line. */
function listed(): Set<string> {
  const text = readFileSync(path.join(root, ".env.example"), "utf8");
  return new Set([...text.matchAll(new RegExp(`^(${NAME})=`, "gm"))].map((m) => m[1]));
}

function modules(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return modules(full);
    return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name) && !/\.test\.[jt]sx?$/.test(entry.name) ? [full] : [];
  });
}

describe(".env.example lists every variable src/ reads", () => {
  const files = modules(src);

  it("scans the app's modules", () => {
    const rel = files.map((f) => path.relative(src, f).split(path.sep).join("/"));
    expect(rel).toEqual(expect.arrayContaining(["lib/mode.ts", "lib/demo-epoch.ts", "adapters/llm/select.ts"]));
  });

  it("holds for every module", () => {
    const names = listed();
    const missing = files.flatMap((f) =>
      envReads(readFileSync(f, "utf8"))
        .filter((name) => !FRAMEWORK.has(name) && !names.has(name))
        .map((name) => `${path.relative(root, f)} reads ${name}`),
    );
    expect(missing).toEqual([]);
  });

  it("holds for the names the mode switches look up by variable", () => {
    // `env[variable]` and `env[name]` are dynamic, so the scan cannot see them;
    // ask the module for the names instead.
    const names = listed();
    const dynamic = [
      ...SERVICE_IDS.map((s) => SERVICES[s].variable),
      ...SERVICE_IDS.flatMap((s) => missingForLive(s, {})),
      ...missingForLive("llm", { LLM_PROVIDER: "bedrock" }),
    ];
    expect(dynamic.filter((name) => !names.has(name))).toEqual([]);
  });

  it("would catch each form of read", () => {
    const pe = "process.env";
    const samples: [string, string[]][] = [
      [`const a = ${pe}.ALPHA;`, ["ALPHA"]],
      [`const b = ${pe}["BRAVO"] ?? ${pe}['CHARLIE'];`, ["BRAVO", "CHARLIE"]],
      [`const c = ${pe}[\`DELTA\`];`, ["DELTA"]],
      [`const { ECHO, FOXTROT: f, GOLF = "1", ...rest } = ${pe};`, ["ECHO", "FOXTROT", "GOLF"]],
      [`const {\n  HOTEL,\n  INDIA,\n} = ${pe};`, ["HOTEL", "INDIA"]],
      ["function pick(env: Env) { return env.JULIET ?? env?.KILO ?? env[\"LIMA\"]; }", ["JULIET", "KILO", "LIMA"]],
      [`const all = ${pe}; const mode = ${pe}.NODE_ENV;`, ["NODE_ENV"]],
    ];
    for (const [source, expected] of samples) expect(envReads(source)).toEqual(expected);
  });
});
