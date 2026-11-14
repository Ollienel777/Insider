// The drill simulation is pure (SPEC §5), like the engine: no React, no DOM,
// no clock and no `Math.random`. This scans every non-test module under
// src/drill/, with the same rules as src/engine/purity.test.ts.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = path.dirname(fileURLToPath(import.meta.url));

// Spelled in pieces so this file does not trip its own check.
const RANDOM = ["Math", "random"].join(".");
const RULES: readonly { what: string; pattern: RegExp }[] = [
  { what: "imports React", pattern: /from\s+["'](react|react-dom)(\/[^"']*)?["']/ },
  { what: "imports Next.js", pattern: /from\s+["']next(\/[^"']*)?["']/ },
  { what: "imports a component or adapter", pattern: /from\s+["']@\/(components|adapters|app)\// },
  { what: `calls ${RANDOM}`, pattern: new RegExp(RANDOM.replace(".", "\\s*\\.\\s*")) },
  { what: "reads the clock", pattern: /\b(Date\s*\.\s*now|new\s+Date|performance\s*\.\s*now)\b/ },
  { what: "touches the DOM", pattern: /\b(window|document|localStorage|navigator)\s*[.[]/ },
  { what: "is a client module", pattern: /^["']use client["']/m },
];

function problems(file: string, source: string): string[] {
  return RULES.filter((r) => r.pattern.test(source)).map((r) => `${file} ${r.what}`);
}

describe("src/drill is pure", () => {
  const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));

  it("scans the drill modules", () => {
    expect(files).toEqual(expect.arrayContaining(["index.ts", "occupancy.ts", "simulate.ts"]));
  });

  it("holds for every module", () => {
    const found = files.flatMap((f) => problems(f, readFileSync(path.join(dir, f), "utf8")));
    expect(found).toEqual([]);
  });

  it("would catch each kind of impurity", () => {
    const samples = [
      'import { useState } from "react";',
      'import { createRoot } from "react-dom/client";',
      'import Link from "next/link";',
      'import { F1_DEMO } from "@/adapters/matterport/fake";',
      `const r = ${RANDOM}();`,
      "const t = Date.now();",
      "const el = document.getElementById('x');",
      "window.addEventListener('x', f);",
      '"use client";',
    ];
    for (const sample of samples) expect(problems("x.ts", sample), sample).not.toEqual([]);
  });
});
