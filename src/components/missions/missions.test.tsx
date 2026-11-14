import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MISSIONS } from "@/agents/builder/missions";
import { castHref, eraNeeded, MISSION_DISCLAIMER, MissionList } from "./mission-list";

const html = renderToStaticMarkup(<MissionList missions={MISSIONS} />);
const text = html.replace(/&#x27;/g, "'").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("MissionList", () => {
  it("lists the five missions, each linking to its cast screen", () => {
    expect([...html.matchAll(/data-testid="mission-card" data-mission="([\w-]+)"/g)].map((m) => m[1])).toEqual([
      "romaine-1974",
      "sunset-1986",
      "night-desk",
      "paper-trail-2001",
      "syntactic-2019",
    ]);
    for (const m of MISSIONS) expect(html).toContain(`href="${castHref(m.id)}"`);
    expect(castHref("romaine-1974")).toBe("/m/romaine-1974/cast");
  });

  it("gives each card its title, city, era and the disclaimer", () => {
    for (const title of ["The Romaine Street Papers", "Hole in the Ground", "The Night Desk", "Paper Trail", "Syntactic"]) {
      expect(text).toContain(title);
    }
    expect(text).toContain("Heist · Los Angeles");
    expect(text).toContain("Prevent · Houston");
    expect(text.split(MISSION_DISCLAIMER)).toHaveLength(6);
  });

  it("carries the Inspired by line with its date and source, or says the mission is fiction", () => {
    expect(text).toContain("Inspired by The Summa Corporation burglary, 7000 Romaine St, Hollywood, June 5, 1974");
    expect(text).toContain("Source: cia.gov (opens in a new tab)");
    expect(html).toContain('href="https://www.cia.gov/stories/story/the-exposing-of-project-azorian"');
    expect(text).toContain("A fictional mission, written for the game.");
  });

  it("names the era each mission needs from its year-built filter", () => {
    const romaine = MISSIONS.find((m) => m.id === "romaine-1974")!;
    expect(eraNeeded(romaine)).toBe("built 1974 or earlier");
    expect(eraNeeded({ casting: [{ kind: "needsScan", label: "a scan" }] })).toBe("any era");
    for (const m of MISSIONS) expect(text).toContain(eraNeeded(m));
  });
});
