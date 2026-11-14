// The tokens in globals.css against hackathon/DESIGN.md: every colour,
// radius, shadow and duration DESIGN.md names exists as a CSS variable with
// DESIGN.md's value and as a Tailwind theme key, and every text token passes
// AA on every surface.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const design = readFileSync(path.join(root, "hackathon/DESIGN.md"), "utf8");
const css = readFileSync(path.join(root, "src/app/globals.css"), "utf8");

function block(source: string, opener: RegExp): string {
  const start = source.search(opener);
  expect(start, `no ${opener} block`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`unclosed ${opener} block`);
}

function declarations(source: string): Map<string, string> {
  const out = new Map<string, string>();
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of stripped.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(match[1], match[2].trim().replace(/\s+/g, " "));
  }
  return out;
}

// DESIGN.md's colour block, plus the radius, elevation and motion tokens it
// gives in prose (`--r-sm: 6px`, `--e-1: ...`, `--t-fast: 150ms`).
const designColours = declarations(block(design, /```css\s*\n:root/));
const designOthers = new Map<string, string>();
for (const match of design.matchAll(/`(--(?:r|e|t)-[\w-]+): ([^`]+)`/g)) {
  designOthers.set(match[1], match[2].trim());
}
const rootVars = declarations(block(css, /^:root\s*\{/m));
const theme = declarations(block(css, /@theme inline\s*\{/));

describe("DESIGN.md tokens in globals.css", () => {
  it("parses a full token set from DESIGN.md", () => {
    expect(designColours.size).toBe(32);
    expect([...designOthers.keys()].sort()).toEqual(
      ["--e-1", "--e-2", "--r-md", "--r-sm", "--t-base", "--t-fast", "--t-slow"].sort(),
    );
  });

  it.each([...designColours, ...designOthers])("%s is a CSS variable with DESIGN.md's value", (name, value) => {
    expect(rootVars.get(name)).toBe(value);
  });

  it.each([...designColours.keys()])("%s is a Tailwind colour key", (name) => {
    expect(theme.get(`--color-${name.slice(2)}`)).toBe(`var(${name})`);
  });

  it.each([
    ["--radius-sm", "--r-sm"],
    ["--radius-md", "--r-md"],
    ["--shadow-e-1", "--e-1"],
    ["--shadow-e-2", "--e-2"],
    ["--duration-fast", "--t-fast"],
    ["--duration-base", "--t-base"],
    ["--duration-slow", "--t-slow"],
  ])("%s is the Tailwind key for %s", (key, token) => {
    expect(theme.get(key)).toBe(`var(${token})`);
  });
});

// WCAG 2.x relative luminance and contrast ratio.
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function resolve(name: string): string {
  let value = rootVars.get(name);
  while (value?.startsWith("var(")) value = rootVars.get(value.slice(4, -1));
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${name} does not resolve to a hex colour`);
  return value;
}

describe("contrast", () => {
  const surfaces = ["--surface-0", "--surface-1", "--surface-2", "--surface-3"];
  const pairs = ["--text-1", "--text-2", "--text-3"].flatMap((text) => surfaces.map((s) => [text, s]));

  it.each(pairs)("%s on %s is at least AA (4.5:1)", (text, surface) => {
    expect(contrast(resolve(text), resolve(surface))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["--accent", "--accent-hover", "--accent-active"])("--accent-ink on %s is at least AA", (fill) => {
    expect(contrast(resolve("--accent-ink"), resolve(fill))).toBeGreaterThanOrEqual(4.5);
  });

  it("measures DESIGN.md's old --text-3 as failing, so the check has teeth", () => {
    expect(contrast("#6b7686", resolve("--surface-1"))).toBeLessThan(4.5);
  });
});
