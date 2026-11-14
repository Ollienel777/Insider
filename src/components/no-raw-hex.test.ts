// Components use DESIGN.md's tokens only (DESIGN.md, Tokens): no hex colour
// anywhere under src/components/ or in the routes under src/app/. The one
// place raw values live is src/app/globals.css.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = path.resolve(import.meta.dirname, "..");
const ALLOWED = new Set([path.join(src, "app", "globals.css")]);
const SOURCE = /\.(tsx?|css|mjs|js)$/;

/** A `#` followed by 3, 4, 6 or 8 hex digits and then a non-word character. */
const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi;

function rawHexValues(text: string): string[] {
  return [...text.matchAll(HEX)].map((m) => m[0]);
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(full);
    return SOURCE.test(entry.name) && !entry.name.includes(".test.") ? [full] : [];
  });
}

describe("no raw hex values", () => {
  it("finds hex colours in the forms a component would write them", () => {
    expect(rawHexValues(`className="bg-[#f2a93b] text-[#FFF]" style={{ color: "#1a120680" }}`)).toEqual([
      "#f2a93b",
      "#FFF",
      "#1a120680",
    ]);
    expect(rawHexValues(`href="#main" aria-describedby="#mode-chip"`)).toEqual([]);
  });

  const targets = [...files(path.join(src, "components")), ...files(path.join(src, "app"))].filter(
    (file) => !ALLOWED.has(file),
  );

  it("scans the component and route sources", () => {
    expect(targets.some((f) => f.includes(`${path.sep}components${path.sep}shell${path.sep}`))).toBe(true);
    expect(targets.some((f) => f.endsWith(path.join("components", "ui", "button.tsx")))).toBe(true);
  });

  it.each(targets.map((file) => [path.relative(src, file), file]))("%s has none", (_name, file) => {
    expect(rawHexValues(readFileSync(file, "utf8"))).toEqual([]);
  });
});
