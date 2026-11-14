// Every `/b/[id]/…` address carries the chosen mission as `?m=` (#119), so
// all of them are built by one helper; this file also fails any link or
// redirect that bypasses it.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildingHref } from "./building-href";
import { useMissionId } from "./use-mission-id";

describe("buildingHref", () => {
  it("carries the mission as ?m=", () => {
    expect(buildingHref("F1", "dossier", "romaine-1974")).toBe("/b/F1/dossier?m=romaine-1974");
    expect(buildingHref("F 1", "run", "a&b")).toBe("/b/F%201/run?m=a%26b");
  });

  it("without a mission leaves m off, for the page to pick the building's own", () => {
    expect(buildingHref("F1", "scout", null)).toBe("/b/F1/scout");
    expect(buildingHref("F1", "scout", "")).toBe("/b/F1/scout");
  });

  it("reads no mission outside the app router", () => {
    function Probe() {
      return <i>{String(useMissionId())}</i>;
    }
    expect(renderToStaticMarkup(<Probe />)).toBe("<i>null</i>");
  });
});

const SRC = path.resolve(import.meta.dirname, "..");
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : [],
  );

describe("no building link bypasses buildingHref", () => {
  // A quote or backtick, maybe a line break, then `/b` and either `/` and
  // anything but `[` (the route pattern in comments), or a closing quote
  // (`"/b" + id`, `'/b'`).
  const RAW = /[`"']\s*\/b(?:\/(?!\[)|[`"'])/g;
  const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;

  it("has no string or template starting /b/ outside the helper and the tests", () => {
    const offenders = files(SRC)
      .filter((f) => !/\.test\.tsx?$/.test(f) && path.basename(f) !== "building-href.ts")
      .flatMap((f) => {
        const text = readFileSync(f, "utf8");
        return [...text.matchAll(RAW)].map((m) => `${path.relative(SRC, f)}:${lineOf(text, m.index)}`);
      });
    expect(
      offenders,
      "Build every /b/[id]/… link with buildingHref(id, screen, missionId) from @/lib/building-href, so it carries ?m= (issue 119)",
    ).toEqual([]);
  });

  it("would catch one, in each form", () => {
    const caught = (code: string) => [...code.matchAll(RAW)].length > 0;
    expect(caught("href={`/b/${id}/plan`}")).toBe(true);
    expect(caught('router.push("/b/F1/run")')).toBe(true);
    expect(caught('const href = "/b" + "/" + id;')).toBe(true);
    expect(caught("const base = '/b';")).toBe(true);
    expect(caught("href={`\n  /b/${id}/run`}")).toBe(true);
    expect(caught("// The Dossier (`/b/[id]/dossier`)")).toBe(false);
  });
});
