import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FIXTURE_INVENTORY } from "@/adapters/costar/fake";
import { MISSIONS } from "@/agents/builder/missions";
import { CastingResult } from "@/domain";
import { castNotice, CastScreen, reasonLabel } from "./cast-screen";
import { fitValue, vacantFloorLine } from "./finalist-card";
import { castPins, funnelFilters } from "./pins";
import { CAST_START_MS, castSchedule, countLeft, pinState, rowsLanded } from "./replay";
import { scoutHref } from "./scout-href";

const root = path.resolve(import.meta.dirname, "../../..");
const cast = (id: string) =>
  CastingResult.parse(JSON.parse(readFileSync(path.join(root, "data", "casting", `${id}.json`), "utf8")));
const mission = (id: string) => MISSIONS.find((m) => m.id === id)!;
const romaine = cast("romaine-1974");

/** Visible text: tags dropped, and nothing inside a `visibility: hidden` wrapper. */
const textOf = (html: string) =>
  html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

describe("castPins", () => {
  it.each(MISSIONS.map((m) => m.id))("%s: one pin per property, and each row's count is the pins still in", (id) => {
    const result = cast(id);
    const { pins, perFilter } = castPins(result, mission(id), FIXTURE_INVENTORY);
    expect(perFilter).toBe(true);
    expect(pins).toHaveLength(FIXTURE_INVENTORY.length);
    result.funnel.forEach((row, i) => {
      expect(pins.filter((p) => pinState(p.outAt, i + 1) === "in"), row.label).toHaveLength(row.count);
    });
    const left = pins.filter((p) => p.outAt === null).map((p) => p.id);
    for (const c of result.finalists) expect(left).toContain(c.id);
  });

  it("drops the Houston properties at the first filter of an LA mission", () => {
    const { pins } = castPins(romaine, mission("romaine-1974"), FIXTURE_INVENTORY);
    expect(pins.filter((p) => p.city === "Houston").every((p) => p.outAt === 1)).toBe(true);
    expect(pins.find((p) => p.id === "F1")?.outAt).toBeNull();
  });

  it("pins only the finalists, none dimming, when the funnel is not this inventory's", () => {
    const live = { ...romaine, funnel: [{ label: "3,339 buildings in the inventory", count: 3339 }, ...romaine.funnel.slice(1)] };
    const { pins, perFilter } = castPins(live, mission("romaine-1974"), FIXTURE_INVENTORY);
    expect(perFilter).toBe(false);
    expect(pins.map((p) => p.id)).toEqual(["F1", "L01", "L02"]);
    expect(pins.every((p) => p.outAt === null)).toBe(true);
    expect(castPins(romaine, mission("romaine-1974"), []).perFilter).toBe(false);
  });

  it("maps the funnel's rows to the mission's filters by label, in the funnel's order", () => {
    expect(funnelFilters(romaine, mission("romaine-1974"))?.map((f) => f.kind)).toEqual([
      "city",
      "yearBuilt",
      "propertyTypes",
      "buildingClass",
      "minVacantFloorSf",
      "needsScan",
      "needsEntry",
    ]);
    const renamed = { funnel: [romaine.funnel[0], { label: "built in the 1970s", count: 9 }] };
    expect(funnelFilters(renamed, mission("romaine-1974"))).toBeNull();
  });
});

describe("castSchedule", () => {
  const schedule = castSchedule(romaine.trace, romaine.funnel.length);

  it("replays in about eight seconds", () => {
    expect(schedule.end).toBeGreaterThanOrEqual(7000);
    expect(schedule.end).toBeLessThanOrEqual(8500);
    expect(Math.min(...schedule.events)).toBe(CAST_START_MS);
  });

  it("lands funnel row k with the k-th search_inventory call, the inventory row with the scout's task", () => {
    const searches = romaine.trace.events.flatMap((e, i) => (e.label === "search_inventory" ? [schedule.events[i]] : []));
    expect(schedule.rows.slice(1)).toEqual(searches);
    const task = romaine.trace.events.findIndex((e) => e.kind === "subagent");
    expect(schedule.rows[0]).toBe(schedule.events[task]);
    for (let i = 1; i < schedule.rows.length; i++) expect(schedule.rows[i]).toBeGreaterThan(schedule.rows[i - 1]);
  });

  it("fills the cards after the last row, as write_shortlist returns", () => {
    expect(schedule.cards).toBeGreaterThan(schedule.rows[schedule.rows.length - 1]);
    const shortlist = romaine.trace.events.findIndex((e) => e.label === "write_shortlist");
    expect(schedule.cards).toBeGreaterThan(schedule.events[shortlist]);
    expect(schedule.end).toBeGreaterThanOrEqual(schedule.cards);
  });

  it("spreads funnel rows the trace has no search for, in order, before the cards", () => {
    const fewer = { events: romaine.trace.events.filter((e, i) => e.label !== "search_inventory" || i < 9) };
    const s = castSchedule(fewer, romaine.funnel.length);
    expect(s.rows).toHaveLength(8);
    for (let i = 1; i < s.rows.length; i++) expect(s.rows[i]).toBeGreaterThan(s.rows[i - 1]);
    expect(s.rows[7]).toBeLessThan(s.cards);
  });

  it("drives the funnel and the pins from one clock", () => {
    const { pins } = castPins(romaine, mission("romaine-1974"), FIXTURE_INVENTORY);
    expect(rowsLanded(schedule, 0)).toBe(0);
    expect(countLeft(romaine.funnel, 0)).toBeNull();
    schedule.rows.forEach((at, i) => {
      expect(rowsLanded(schedule, at)).toBe(i + 1);
      expect(rowsLanded(schedule, at - 1)).toBe(i);
      expect(countLeft(romaine.funnel, i + 1)).toBe(romaine.funnel[i].count);
      expect(pins.filter((p) => pinState(p.outAt, rowsLanded(schedule, at)) === "in")).toHaveLength(romaine.funnel[i].count);
    });
    expect(countLeft(romaine.funnel, Infinity)).toBe(3);
  });
});

describe("CastScreen", () => {
  const { pins } = castPins(romaine, mission("romaine-1974"), FIXTURE_INVENTORY);
  const screen = (startComplete: boolean) =>
    renderToStaticMarkup(
      <CastScreen mission={mission("romaine-1974")} result={romaine} pins={pins} scoutable={["F1"]} startComplete={startComplete} />,
    );
  const start = screen(false);
  const end = screen(true);

  it("starts with every funnel row and card laid out but hidden, and Skip", () => {
    expect(start.match(/data-testid="funnel-row" data-shown="false"/g)).toHaveLength(8);
    expect(start).toContain('data-testid="finalists" data-shown="false"');
    expect(start.match(/invisible opacity-0"><article data-testid="finalist-card"/g)).toHaveLength(3);
    expect(start).toContain('data-testid="skip"');
    expect(start.match(/data-testid="cast-pin"[^>]*data-state="in"/g)).toHaveLength(32);
  });

  it("ends with the funnel 61 → 3, three finalists F1 first, and Replay", () => {
    expect([...end.matchAll(/data-testid="funnel-count"[^>]*>(\d+)</g)].map((m) => Number(m[1]))).toEqual([
      61, 32, 14, 11, 8, 5, 4, 3,
    ]);
    expect(end).toContain('data-testid="replay"');
    expect(textOf(end)).toContain("3 left");
    expect([...end.matchAll(/data-testid="finalist-card" data-building="(\w+)"/g)].map((m) => m[1])).toEqual(["F1", "L01", "L02"]);
  });

  it("dims every LA pin a filter dropped, and marks the finalists", () => {
    expect(end.match(/data-testid="cast-pin"[^>]*data-state="out"/g)).toHaveLength(29);
    expect(end.match(/data-testid="cast-pin"[^>]*data-state="in"/g)).toHaveLength(3);
    expect(end.match(/data-finalist="true"/g)).toHaveLength(3);
    expect(textOf(end)).toContain("Los Angeles · 3 of 32 left · 1 beyond this map's edge");
  });

  const card = (html: string, id: string) => {
    const from = html.indexOf(`data-testid="finalist-card" data-building="${id}"`);
    const next = html.indexOf('data-testid="finalist-card"', from + 1);
    return html.slice(from, next < 0 ? undefined : next);
  };

  it("gives each finalist its facts, layer dots, fit and the agent's reason with its label", () => {
    const text = textOf(end);
    expect(text).toContain("Floor 22 · 23,341 SF suites 2202–2210");
    expect(text).toContain(romaine.finalists[0].reason);
    expect(text).toContain("Casting Director · scripted");
    expect(text).toContain("Fits all 7 filters");
    expect(card(end, "F1").match(/data-layer="(costar|vexcel|matterport)"/g)).toHaveLength(3);
  });

  it("marks a finalist with no building pages as level in prep", () => {
    expect(textOf(card(end, "L01"))).toMatch(/Level in prep/);
    expect(textOf(card(end, "F1"))).not.toMatch(/level in prep/i);
  });

  it("starts with nothing picked and Scout it disabled", () => {
    expect(end).toMatch(/<button[^>]*disabled=""[^>]*>Scout it<\/button>/);
    expect(end).not.toContain("/scout?m=");
    expect(textOf(end)).toContain("Pick a finalist to scout.");
  });

  it("heads the trace with the Recorded run line and the fixtures notice", () => {
    const text = textOf(end);
    expect(text).toContain("Casting Director");
    expect(text).toMatch(/Recorded run · Nov 14, 2026, \d\d:\d\d UTC · ScriptedChatModel \(script casting-romaine-1974, no LLM\)/);
    expect(text).toContain("A replay of a run recorded on fixtures. Nothing on this screen calls a model.");
    expect(text).toContain("Funnel · CoStar · fixtures");
  });
});

describe("the cast screen's words", () => {
  it("says a live shortlist was cast ahead on CoStar's data", () => {
    expect(castNotice("costar")).toBe("A replay of a run cast ahead on CoStar's data. Nothing on this screen calls a model.");
  });

  it("labels a scripted reason as scripted, and any other as recorded", () => {
    expect(reasonLabel("ScriptedChatModel (script casting-romaine-1974, no LLM)")).toBe("Casting Director · scripted");
    expect(reasonLabel("claude-sonnet-4-6")).toBe("Casting Director · recorded");
    expect(reasonLabel(undefined)).toBe("Casting Director · recorded");
  });

  it("prints a vacant floor and the fit values", () => {
    expect(vacantFloorLine({ floor: 9, sf: 14620, suites: ["910", "920", "930"] })).toBe("Floor 9 · 14,620 SF · suites 910, 920, 930");
    expect(vacantFloorLine({ floor: 1, sf: 900, suites: ["100"] })).toBe("Floor 1 · 900 SF · suite 100");
    expect([true, false, 1974, "dock"].map(fitValue)).toEqual(["yes", "no", "1974", "dock"]);
  });

  it("opens a finalist's scout with the mission", () => {
    expect(scoutHref("F1", "romaine-1974")).toBe("/b/F1/scout?m=romaine-1974");
  });
});
