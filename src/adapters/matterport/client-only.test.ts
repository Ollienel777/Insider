// The Matterport adapter runs only in the browser (SPEC §4, §4.5): scan data
// must never pass through server code. This test fails when any module under
// src/ outside the adapter imports it without being a client module, that is,
// without a leading "use client" directive. Route handlers, server components
// and server-side libraries therefore cannot import it.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const adapterDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(adapterDir, "../..");

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g;

/** Whether `specifier`, imported from `file`, points into the Matterport adapter. */
function targetsAdapter(file: string, specifier: string): boolean {
  let resolved: string;
  if (specifier.startsWith("@/")) resolved = path.join(srcDir, specifier.slice(2));
  else if (specifier.startsWith(".")) resolved = path.resolve(path.dirname(file), specifier);
  else return false;
  const relative = path.relative(adapterDir, resolved);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Whether the module's first statement is the "use client" directive. */
function isClientModule(source: string): boolean {
  const code = source.replace(/^\uFEFF/, "").replace(/^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, "");
  return /^["']use client["']/.test(code);
}

/** Why `file` (with `source`) breaks the rule, or null when it does not. */
function violation(file: string, source: string): string | null {
  const imports = [...source.matchAll(SPECIFIER)].map((m) => m[1]).filter((s) => targetsAdapter(file, s));
  if (imports.length === 0 || isClientModule(source)) return null;
  return `${path.relative(srcDir, file)} imports ${imports.join(", ")} but is not a "use client" module`;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|js|jsx|mjs)$/.test(entry.name) ? [full] : [];
  });
}

describe("the Matterport adapter is imported only from client modules", () => {
  it("holds across src/", () => {
    const problems = sourceFiles(srcDir)
      .filter((file) => !file.startsWith(adapterDir + path.sep))
      .filter((file) => !/\.test\.(ts|tsx)$/.test(file))
      .map((file) => violation(file, readFileSync(file, "utf8")))
      .filter((p): p is string => p !== null);
    expect(problems).toEqual([]);
  });

  it("would fail a route handler or server component that imports it", () => {
    const route = path.join(srcDir, "app/api/floors/route.ts");
    expect(violation(route, 'import { getMatterport } from "@/adapters/matterport";\n')).toMatch(
      /^app\/api\/floors\/route\.ts imports @\/adapters\/matterport but is not/,
    );
    const page = path.join(srcDir, "app/b/[id]/run/page.tsx");
    expect(violation(page, '// a server component\nimport { F1_DEMO } from "@/adapters/matterport/fake";')).not.toBeNull();
    expect(violation(page, 'const m = await import("../../../../adapters/matterport/live");')).not.toBeNull();
  });

  it("accepts a client component, and ignores other adapters", () => {
    const board = path.join(srcDir, "components/run/board.tsx");
    expect(violation(board, '/* the board */\n"use client";\nimport { getMatterport } from "@/adapters/matterport";')).toBeNull();
    expect(violation(board, "'use client'\nimport x from '../../adapters/matterport/index';")).toBeNull();
    expect(violation(board, 'import { getCoStar } from "@/adapters/costar";')).toBeNull();
    expect(violation(board, 'import { x } from "@/adapters/matterport-other";')).toBeNull();
  });

  it("does not take a later \"use client\" string for the directive", () => {
    expect(isClientModule('import "x";\n"use client";')).toBe(false);
  });
});
