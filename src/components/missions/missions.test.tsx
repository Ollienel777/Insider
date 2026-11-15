import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FIXTURE_BUILDINGS } from "@/adapters/costar/fake";
import { MISSIONS } from "@/agents/builder/missions";
import { eraStyle } from "./building-sketch";
import { castHref, eraNeeded, MISSION_DISCLAIMER, MissionList, safeSourceUrl } from "./mission-list";

// The mission picker as the open case file (issue 166): a file tab per job,
// the chosen job's file on the left page, its city's map and the job itself on
// the right page, and the stamp to take it. The server renders the first job.
const html = renderToStaticMarkup(<MissionList missions={MISSIONS} />);
const text = html.replace(/&#x27;/g, "'").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("MissionList", () => {
  it("gives every mission a file tab, in the library's order, with the first one open", () => {
    expect([...html.matchAll(/data-testid="mission-tab" data-mission="([\w-]+)"/g)].map((m) => m[1])).toEqual([
      "romaine-1974",
      "sunset-1986",
      "night-desk",
      "paper-trail-2001",
      "syntactic-2019",
    ]);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect([...html.matchAll(/data-testid="mission-card" data-mission="([\w-]+)"/g)].map((m) => m[1])).toEqual(["romaine-1974"]);
    for (const title of ["The Romaine Street Papers", "Hole in the Ground", "The Night Desk", "Paper Trail", "Syntactic"]) {
      expect(text).toContain(title);
    }
  });

  it("stamps Take the job to the open mission's cast screen", () => {
    const stamp = html.match(/<a [^>]*data-testid="take-the-job"[^>]*>/)![0];
    expect(stamp).toContain(`href="${castHref("romaine-1974")}"`);
    expect(text).toContain("Take the job");
    expect(castHref("romaine-1974")).toBe("/m/romaine-1974/cast");
  });

  it("opens the job's file: kind and city, era, the disclaimer, its objective and its city's map", () => {
    const romaine = MISSIONS.find((m) => m.id === "romaine-1974")!;
    expect(text).toContain("Heist · Los Angeles");
    expect(text).toContain(eraNeeded(romaine));
    expect(text.split(MISSION_DISCLAIMER)).toHaveLength(2);
    expect(text).toContain(romaine.objective);
    expect(html).toContain('alt="Street map of Los Angeles"');
  });

  it("carries the Inspired by line with its date and source", () => {
    expect(text).toContain("Inspired by The Summa Corporation burglary, 7000 Romaine St, Hollywood, June 5, 1974");
    expect(text).toContain("cia.gov (opens in a new tab)");
    expect(html).toContain('href="https://www.cia.gov/stories/story/the-exposing-of-project-azorian"');
  });

  it("says a mission with no history is fiction", () => {
    const desk = MISSIONS.find((m) => m.id === "night-desk")!;
    const out = renderToStaticMarkup(<MissionList missions={[desk]} />);
    expect(out).toContain("A fictional mission, written for the game.");
    expect(out).toContain("Prevent · Los Angeles");
  });

  it("opens with the hook as SPEC §2 beat 1 words it, with no link off to the map of every building", () => {
    expect(text).toContain("Every heist in history needed a building. Our agent finds one that's empty tonight.");
    expect(html).not.toContain('href="/map"');
  });

  it("marks the mission's city's buildings on its map with a little building each, and no other city's", () => {
    const marked = renderToStaticMarkup(<MissionList missions={MISSIONS} buildings={FIXTURE_BUILDINGS} />);
    const la = FIXTURE_BUILDINGS.filter((b) => b.city === "LA").map((b) => b.id);
    expect([...marked.matchAll(/data-testid="mission-map-pin" data-building="(\w+)"/g)].map((m) => m[1])).toEqual(la);
    expect(marked.match(/data-testid="pin-building"/g)).toHaveLength(la.length);
    expect(marked).toContain(`Los Angeles · ${la.length} buildings`);
  });

  it("names the era each mission needs from its year-built filter, and sketches a building of that era", () => {
    const romaine = MISSIONS.find((m) => m.id === "romaine-1974")!;
    expect(eraNeeded(romaine)).toBe("built 1974 or earlier");
    expect(eraNeeded({ casting: [{ kind: "needsScan", label: "a scan" }] })).toBe("any era");
    expect(eraStyle("built 1974 or earlier")).toBe("tower70");
    expect(eraStyle("built in the 1980s")).toBe("block80");
    expect(eraStyle("built 2015 or later")).toBe("glass15");
    expect(eraStyle("built 2001 or earlier")).toBe("tower00");
    expect(eraStyle("built 2019 or earlier")).toBe("lab19");
  });

  it("links a source only when it is an http(s) address, else shows no source", () => {
    expect(safeSourceUrl("https://www.cia.gov/x")?.hostname).toBe("www.cia.gov");
    expect(safeSourceUrl("javascript:alert(1)")).toBeNull();
    expect(safeSourceUrl("not a url")).toBeNull();
    const romaine = MISSIONS.find((m) => m.id === "romaine-1974")!;
    for (const sourceUrl of ["javascript:alert(1)", "not a url"]) {
      const bad = { ...romaine, inspiredBy: { ...romaine.inspiredBy!, sourceUrl } };
      const out = renderToStaticMarkup(<MissionList missions={[bad]} />);
      expect(out).not.toContain("source-link");
      expect(out).not.toContain("javascript:");
      expect(out).toContain("No source: written for the game.");
    }
  });
});
