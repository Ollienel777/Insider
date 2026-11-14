// The `@/` import alias, read from one place: tsconfig.json's `paths`.
// Next.js and tsc read that file themselves; vitest.config.ts and the gate's
// step 0 call aliasRoot() below, so all of them resolve `@/` the same way.
// Node built-ins only: the gate imports this before `npm ci`.
import { readFileSync } from "node:fs";
import path from "node:path";

/** Absolute directory that `@/` maps to, for the package at `projectDir`. */
export function aliasRoot(projectDir) {
  const file = path.join(projectDir, "tsconfig.json");
  // tsconfig.json is kept as plain JSON (no comments) so this parse is exact.
  const config = JSON.parse(readFileSync(file, "utf8"));
  const options = config.compilerOptions ?? {};
  const target = options.paths?.["@/*"]?.[0];
  if (typeof target !== "string" || !target.endsWith("/*")) {
    throw new Error(`${file}: compilerOptions.paths["@/*"] must be ["<dir>/*"]`);
  }
  const base = path.resolve(projectDir, options.baseUrl ?? ".");
  return path.resolve(base, target.slice(0, -2));
}
