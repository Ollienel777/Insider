import { placeLine } from "./showcase-card";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FIXTURE_INVENTORY } from "@/adapters/costar/fake";
import { MISSIONS } from "@/agents/builder/missions";
import { CastingResult } from "@/domain";
import { FIXTURE_AERIALS } from "@/adapters/vexcel/fake";
import { BASEMAPS, fitView, project } from "@/components/map/basemap";
import { castNotice, castRunHeader, CastScreen, reasonLabel } from "./cast-screen";
import { fitValue, vacantFloorLine } from "./finalist-card";
import { castPins, funnelFilters } from "./pins";
import { CAST_START_MS, castSchedule, countLeft, pinState, rowsLanded, startElapsed } from "./replay";
import { castThumbnails, clientTrace } from "./props";
import { scoutHref } from "./scout-href";
import { MISSION_DISCLAIMER } from "@/components/missions/mission-list";
import { toKitProperty } from "@/adapters/costar/mapping";
import { fictionalProperty } from "@/adapters/costar/test-kit";
import { castReasons, type ShowcaseCast } from "@/lib/showcase-cast";

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

  it("still plays out a trace whose events share one moment, in order, over the replay", () => {
    const flat = { events: romaine.trace.events.map((e) => ({ ...e, atMs: 5 })) };
    const s = castSchedule(flat, romaine.funnel.length);
    expect(s.events[0]).toBe(CAST_START_MS);
    expect(s.events[s.events.length - 1]).toBe(CAST_START_MS + 7000);
    for (let i = 1; i < s.events.length; i++) expect(s.events[i]).toBeGreaterThan(s.events[i - 1]);
    for (let i = 1; i < s.rows.length; i++) expect(s.rows[i]).toBeGreaterThan(s.rows[i - 1]);
    expect(s.rows[s.rows.length - 1] - s.rows[0]).toBeGreaterThan(1000);
  });

  it("starts at the end under reduced motion or when asked, else at zero", () => {
    expect(startElapsed(false, false)).toBe(0);
    expect(startElapsed(false, true)).toBe(Infinity);
    expect(startElapsed(true, false)).toBe(Infinity);
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
  const thumbnails = castThumbnails(romaine.finalists, FIXTURE_AERIALS);
  const screen = (startComplete: boolean) =>
    renderToStaticMarkup(
      <CastScreen
        mission={mission("romaine-1974")}
        result={{ ...romaine, trace: clientTrace(romaine.trace) }}
        pins={pins}
        scoutable={["F1"]}
        thumbnails={thumbnails}
        startComplete={startComplete}
      />,
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
    expect(textOf(end)).toContain("Los Angeles · 3 of 32 left");
    expect(textOf(end)).not.toContain("beyond this map's edge · ");
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

  it("shows F1's massing as its thumbnail, and Level in prep in the slot of a finalist with no level", () => {
    expect(card(end, "F1")).toMatch(/role="img" aria-label="Massing of Halvorsen Tower, drawn from fixture footprint and tags, not imagery"/);
    expect(card(end, "F1")).toContain('data-testid="massing-roof"');
    expect(card(end, "L01")).not.toContain("massing-roof");
    expect(card(end, "L01")).toContain('aria-describedby="finalist-L01-prep"');
    expect(card(end, "L01")).toMatch(/id="finalist-L01-prep"[^>]*>Level in prep</);
  });

  it("names each pick button by its visible text", () => {
    expect(card(end, "F1")).toMatch(/<button[^>]*data-testid="finalist-pick"(?![^>]*aria-label)/);
  });

  it("marks a finalist with no building pages as level in prep", () => {
    expect(textOf(card(end, "L01"))).toMatch(/Level in prep/);
    expect(textOf(card(end, "F1"))).not.toMatch(/level in prep/i);
  });

  it("starts with nothing picked and Scout it off but focusable, saying why in a live line", () => {
    expect(end).toMatch(/<button[^>]*aria-disabled="true"[^>]*aria-describedby="selection"[^>]*>Scout it<\/button>/);
    expect(end).not.toMatch(/<button[^>]*disabled=""[^>]*>Scout it/);
    expect(end).toMatch(/<p id="selection"[^>]*aria-live="polite"/);
    expect(textOf(start)).toContain("Replaying the Casting Director's run.");
    expect(end).not.toContain("/scout?m=");
    expect(textOf(end)).toContain("Pick a finalist to scout.");
  });

  it("carries the mission cards' disclaimer once, under the finalists", () => {
    expect(textOf(end).split(MISSION_DISCLAIMER)).toHaveLength(2);
    expect(end.indexOf('data-testid="cast-disclaimer"')).toBeGreaterThan(end.lastIndexOf('data-testid="finalist-card"'));
  });

  it("puts the mission's h1 before the finalists' h2", () => {
    expect(end.indexOf("<h1")).toBeLessThan(end.indexOf("<h2"));
  });

  it("heads the trace with the Scripted run line and the fixtures notice", () => {
    const text = textOf(end);
    expect(text).toContain("Casting Director");
    expect(text).toMatch(/Scripted run · Nov 14, 2026, \d\d:\d\d UTC · ScriptedChatModel \(script casting-romaine-1974, no LLM\)/);
    expect(text).not.toContain("Recorded run");
    expect(text).toContain("A replay of a run recorded on fixtures. Nothing on this screen calls a model.");
    expect(text).toContain("Funnel · CoStar · fixtures");
  });

  it("has no showcase card without a showcase building", () => {
    expect(end).not.toContain('data-testid="showcase');
  });
});

// Issue 103: a showcase kit building, from the fictional test kit only.
describe("CastScreen with a showcase building", () => {
  const { pins } = castPins(romaine, mission("romaine-1974"), FIXTURE_INVENTORY);
  const mapped = toKitProperty(fictionalProperty(900001, { buildingClass: 2 }), {
    spaces: () => [{ floor: 6, suite: "600", sf: 2410 }],
    scans: () => ["mpTestAAAA001"],
  });
  if (typeof mapped === "string") throw new Error(mapped);
  const b = mapped.building;
  const showcase: ShowcaseCast = {
    ...{ id: b.id, name: b.name, neighbourhood: b.neighbourhood, city: b.city, yearBuilt: b.yearBuilt },
    ...{ buildingClass: b.buildingClass, stories: b.stories, layers: b.layers },
    reasons: castReasons(b, mapped.propertyType, mission("night-desk")),
    level: "none",
  };
  const screen = (startComplete: boolean, cast = showcase) =>
    renderToStaticMarkup(
      <CastScreen
        mission={mission("night-desk")}
        result={{ ...romaine, trace: clientTrace(romaine.trace) }}
        pins={pins}
        scoutable={["F1"]}
        showcase={cast}
        startComplete={startComplete}
      />,
    );
  const end = screen(true);
  const at = end.indexOf('data-testid="showcase-card"');
  const card = end.slice(at, end.indexOf('data-testid="finalist-card"', at));

  it("links to the building's Scout, Dossier, Plan and Run on the cast mission", () => {
    const steps = card.slice(card.indexOf('data-testid="showcase-steps"'));
    expect([...steps.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"))).toEqual(
      ["scout", "dossier", "plan", "run"].map((s) => `/b/900001/${s}?m=night-desk`),
    );
    expect(textOf(card)).toContain("No level yet: its Dossier builds one before Plan and Run.");
  });

  it.each([
    ["built", "Its level is built: Plan and Run are ready."],
    ["building", "Its level is being built now. This takes a minute or two."],
    ["failed", "The last build of its level failed. Its Dossier says why and can try again."],
    ["model-forced", "The model is forced to fixtures in the demo settings, so the Level Builder can't build this level. Turn the model back on there to build it."],
    ["model-fixtures", "The model is on fixtures, so the Level Builder can't build this level here. It needs the live model."],
  ] as const)("words a level that is %s truthfully", (level, line) => {
    const text = textOf(screen(true, { ...showcase, level }));
    expect(text).toContain(line);
    expect(text).not.toContain("its Dossier builds one");
  });

  it("says why it fits, and that a Class B building misses a mission that needs Class A", () => {
    const text = textOf(card);
    expect(text).toContain("Testwood Tower 900001");
    expect(text).toContain("Doesn't match: Class B · needs Class A");
    expect(text).toContain("Matches: office · fits office");
    expect(text).toContain("Not on the record: no aerial on record · can't check a dock on the aerial");
    // Picked from the list, not by the rules: the fit is a second fact.
    expect(text).toMatch(/Picked from the showcase list · fits \d of 7 of the mission's needs/);
    expect(text).not.toContain("Because");
    expect(card.match(/data-testid="showcase-reason" data-status="miss"/g)?.length).toBeGreaterThan(0);
  });

  it("is picked for Scout it from the start, once the cards show", () => {
    expect(card).toContain('data-selected="true"');
    expect(end).toMatch(/<a[^>]*href="\/b\/900001\/scout\?m=night-desk"[^>]*>Scout it<\/a>/);
    expect(textOf(end)).toMatch(/Testwood Tower 900001 ?, Testville Scout it/);
    // Mid-replay it is hidden, and Scout it waits.
    const start = screen(false);
    expect(start).toContain('data-testid="scout-off"');
    expect(start).toMatch(/invisible opacity-0"><article data-testid="showcase-card"/);
  });

  // Issue 228: one of the three cards, not a card over them.
  it("takes the second finalist's slot among the three cards, with the disclaimer still shown", () => {
    const cards = [...end.matchAll(/data-testid="(finalist|showcase)-card" data-building="(\w+)"/g)].map((m) => m[2]);
    expect(cards).toEqual(["F1", "900001", "L02"]);
    expect(end).not.toContain('data-testid="finalists-fold"');
    expect(end).not.toContain("<details data-testid");
    expect(textOf(end)).toContain("Three finalists · pick one to scout");
    expect(end.indexOf('data-testid="cast-disclaimer"')).toBeGreaterThan(end.indexOf('data-testid="showcase-card"'));
    // The finalist it stands in for is neither a card nor labelled on the map.
    expect(end).not.toMatch(/data-testid="cast-pin" data-building="L01" data-state="in" data-finalist/);
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

describe("what the page hands the browser", () => {
  it("strips every tool and task payload from the trace", () => {
    expect(romaine.trace.events.some((e) => e.input !== undefined || e.output !== undefined)).toBe(true);
    const trace = clientTrace(romaine.trace);
    expect(trace.events).toHaveLength(romaine.trace.events.length);
    for (const e of trace.events) {
      expect(e).not.toHaveProperty("input");
      expect(e).not.toHaveProperty("output");
    }
    expect(JSON.stringify(trace)).not.toContain('"filter":"city"');
    const first: Record<string, unknown> = { ...romaine.trace.events[0] };
    delete first.input;
    delete first.output;
    expect(trace.events[0]).toEqual(first);
    expect(trace.events[0]).toMatchObject({ kind: "tool", agent: "casting-director", label: "get_mission", status: "completed" });
  });

  it("gives a thumbnail to each finalist with a fixture aerial only", () => {
    expect(Object.keys(castThumbnails(romaine.finalists, FIXTURE_AERIALS))).toEqual(["F1"]);
    expect(castThumbnails(romaine.finalists, FIXTURE_AERIALS).F1.dir).toBe("N");
  });

  it("calls a non-scripted run a recorded run", () => {
    expect(castRunHeader({ recordedAt: "2026-11-14T04:28:16.140Z", model: "claude-sonnet-4-6" })).toBe(
      "Recorded replay · Nov 14, 2026, 04:28 UTC · model turns: claude-sonnet-4-6",
    );
  });
});

describe("fitView", () => {
  it.each(MISSIONS.map((m) => m.id))("%s: every finalist falls inside its city's map view", (id) => {
    const result = cast(id);
    const city = mission(id).city;
    const view = fitView(BASEMAPS[city].bounds, result.finalists);
    for (const c of result.finalists) {
      const { x, y } = project(view, c.lat, c.lng);
      expect(x, c.id).toBeGreaterThan(0.02);
      expect(x, c.id).toBeLessThan(0.98);
      expect(y, c.id).toBeGreaterThan(0.02);
      expect(y, c.id).toBeLessThan(0.98);
    }
  });

  it("keeps the basemap's own bounds when every point is on it", () => {
    const bounds = BASEMAPS.LA.bounds;
    expect(fitView(bounds, [{ lat: 34.05226, lng: -118.25287 }])).toBe(bounds);
  });
});

describe("the showcase card's place line", () => {
  it("names the place once when the record's neighbourhood is its city", () => {
    expect(placeLine("Los Angeles", "Los Angeles")).toBe("Los Angeles");
    expect(placeLine("", "Los Angeles")).toBe("Los Angeles");
    expect(placeLine("Century City", "Los Angeles")).toBe("Century City, Los Angeles");
  });
});

describe("the showcase card's heading", () => {
  it("says it is a CoStar record without showing the record's id", async () => {
    const { ShowcaseCard } = await import("./showcase-card");
    const showcase = {
      id: "900042",
      name: "Made-up Tower",
      neighbourhood: "Los Angeles",
      city: "LA",
      yearBuilt: 1972,
      buildingClass: "B",
      stories: 30,
      layers: { costar: true, vexcel: false, matterport: true },
      level: "built",
      reasons: [],
    } as unknown as Parameters<typeof ShowcaseCard>[0]["showcase"];
    const html = renderToStaticMarkup(<ShowcaseCard showcase={showcase} missionId="romaine-1974" selected={false} onSelect={() => {}} />);
    const pick = html.slice(html.indexOf('data-testid="showcase-pick"'), html.indexOf("</button>"));
    expect(pick).toContain("Showcase · CoStar record");
    expect(pick).not.toContain("900042");
    expect(pick).toContain("Made-up Tower");
  });
});
