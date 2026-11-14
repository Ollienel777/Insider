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
    expect(buildingHref("F1", "scout")).toBe("/b/F1/scout");
    expect(buildingHref("F1", "scout", null)).toBe("/b/F1/scout");
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
  it("has no string or template starting /b/ outside the helper and the tests", () => {
    // A quote or backtick, then /b/ and anything but `[` (the route pattern in comments).
    const raw = /[`"']\/b\/(?!\[)/;
    const offenders = files(SRC)
      .filter((f) => !/\.test\.tsx?$/.test(f) && path.basename(f) !== "building-href.ts")
      .flatMap((f) =>
        readFileSync(f, "utf8")
          .split("\n")
          .map((line, i) => ({ at: `${path.relative(SRC, f)}:${i + 1}`, line }))
          .filter(({ line }) => raw.test(line)),
      );
    expect(offenders).toEqual([]);
  });

  it("would catch one", () => {
    expect(/[`"']\/b\/(?!\[)/.test("href={`/b/${id}/plan`}")).toBe(true);
    expect(/[`"']\/b\/(?!\[)/.test('router.push("/b/F1/run")')).toBe(true);
    expect(/[`"']\/b\/(?!\[)/.test("// The Dossier (`/b/[id]/dossier`)")).toBe(false);
  });
});
