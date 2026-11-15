"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useCallback, useId, useState, type KeyboardEvent } from "react";
import { buttonVariants } from "@/components/ui/button";
import { BuildingMarker } from "@/components/map/map-pin";
import { MapView } from "@/components/map/map-screen";
import type { Building, Mission } from "@/domain";
import { cityName } from "@/lib/cities";
import { cn } from "@/lib/utils";
import { BuildingSketch, eraStyle } from "./building-sketch";

/** SPEC §1, taste rules: the line every mission carries. */
export const MISSION_DISCLAIMER =
  "Staged in a real building cast for its era. Security shown is game fiction derived from building class and era, not this building's.";

/** The era a mission's stand-in must be from: its `yearBuilt` filter's label, or "any era". */
export function eraNeeded(mission: Pick<Mission, "casting">): string {
  return mission.casting.find((f) => f.kind === "yearBuilt")?.label ?? "any era";
}

/** `url` when it parses as an http(s) address, else null: a source link never runs script or throws. */
export function safeSourceUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

/** Where a mission's card goes: its cast screen. */
export const castHref = (missionId: string) => `/m/${encodeURIComponent(missionId)}/cast`;

// One sheet of paper in the open case file (issue 166).
const PAGE = "relative flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto rounded-[4px] border-2 border-border bg-surface-0 p-4 shadow-[2px_3px_0_rgb(43_29_18/0.12)] md:p-5";
const CASEHEAD = "flex items-baseline justify-between gap-3 border-b-2 border-dashed border-border pb-1.5 font-mono text-xs text-text-2 uppercase";

/**
 * The mission picker (`/`, SPEC §2 beat 1) as the open case file (issue 166):
 * one file tab per job on the left page, with the chosen job's history, a
 * snapshot of the kind of building it needs, and its facts; its city's map and
 * the job itself on the right page; the stamp "Take the job" opens its cast
 * screen. ← and → flip through the jobs.
 */
/** A building as the mission picker's map draws it: where it is, and its name for the caption. */
export type MissionMapBuilding = Pick<Building, "id" | "name" | "city" | "lat" | "lng">;

export function MissionList({ missions, buildings = [] }: { missions: readonly Mission[]; buildings?: readonly MissionMapBuilding[] }) {
  const [at, setAt] = useState(0);
  const tabsId = useId();
  const mission = missions[at];
  const flip = useCallback(
    (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const next = (at + (event.key === "ArrowRight" ? 1 : -1) + missions.length) % missions.length;
      setAt(next);
      document.getElementById(`${tabsId}-${next}`)?.focus();
    },
    [at, missions.length, tabsId],
  );
  if (!mission) return null;
  const source = mission.inspiredBy ? safeSourceUrl(mission.inspiredBy.sourceUrl) : null;
  const era = eraNeeded(mission);
  const inCity = buildings.filter((b) => b.city === mission.city);
  const fileNo = `${mission.type === "heist" ? "H" : "P"}-${String((at + 1) * 7).padStart(2, "0")}`;
  return (
    <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
      <h1 className="sr-only">Pick a mission</h1>
      <section aria-label="The job" className={PAGE}>
        <div className={CASEHEAD}>
          <span>
            Case {String(at + 1).padStart(2, "0")} / {cityName(mission.city)}
          </span>
          <span>File {fileNo}</span>
        </div>
        <p className="text-base text-text-2">Every heist in history needed a building. Our agent finds one that&apos;s empty tonight.</p>
        <div role="tablist" aria-label="Missions" className="flex flex-wrap gap-1.5" onKeyDown={flip}>
          {missions.map((m, i) => (
            <button
              key={m.id}
              id={`${tabsId}-${i}`}
              role="tab"
              type="button"
              aria-selected={i === at}
              tabIndex={i === at ? 0 : -1}
              data-testid="mission-tab"
              data-mission={m.id}
              onClick={() => setAt(i)}
              className={cn(
                "inline-flex h-10 items-center gap-1.5 rounded-[8px] border-2 border-border-strong px-2.5 font-hand text-sm text-text-1 transition-transform duration-fast",
                i === at ? "bg-accent shadow-[0_3px_0_var(--ink-shadow)]" : "bg-surface-2 hover:-translate-y-px",
              )}
            >
              <span aria-hidden className={cn("size-3.5 rounded-[4px] border-2 border-border-strong", m.type === "heist" ? "bg-danger" : "bg-success")} />
              {m.title}
            </button>
          ))}
        </div>
        <article data-testid="mission-card" data-mission={mission.id} role="tabpanel" aria-labelledby={`${tabsId}-${at}`} className="flex flex-1 flex-col gap-3">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 max-md:grid-cols-1">
            <div className="flex min-w-0 flex-col gap-2">
              <span className="font-mono text-xs text-text-3 uppercase">
                {mission.type === "heist" ? "Heist" : "Prevent"} · {cityName(mission.city)}
              </span>
              <h2 className="text-[clamp(30px,3.4vw,44px)] leading-none text-text-1">{mission.title}</h2>
              <p data-testid="inspired-by" className="font-mono text-[15px] leading-relaxed text-text-2">
                {mission.inspiredBy ? (
                  <>
                    Inspired by {mission.inspiredBy.event}, <span className="text-text-1">{mission.inspiredBy.date}</span>
                  </>
                ) : (
                  "A fictional mission, written for the game."
                )}
              </p>
            </div>
            {/* A taped snapshot of the kind of building the job needs; the stamp lands on the picture, never on text. */}
            <figure className="relative m-0 w-[170px] rotate-3 justify-self-center border-2 border-border-strong bg-n-950 p-2 pb-7 shadow-[3px_5px_0_rgb(0_0_0/0.2)]">
              <span aria-hidden className="absolute -top-2.5 left-1/2 h-5 w-16 -translate-x-1/2 -rotate-6 border border-black/10 bg-n-950/70" />
              <BuildingSketch era={eraStyle(era)} label={`A building ${era}`} />
              <figcaption className="absolute inset-x-0 bottom-1 text-center font-hand text-[13px] text-text-1">{era.replace(/^built /, "")}</figcaption>
              <span
                aria-hidden
                className={cn(
                  "absolute top-[42%] left-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-12 rounded-[7px] border-4 px-2.5 font-display text-[22px] tracking-widest whitespace-nowrap mix-blend-multiply opacity-85",
                  mission.type === "heist" ? "border-danger text-danger" : "border-success text-success",
                )}
              >
                {mission.type === "heist" ? "Heist" : "Prevent"}
              </span>
            </figure>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            <div>
              <dt className="label-caps text-text-3">City</dt>
              <dd className="font-mono text-[15px] text-text-1">{cityName(mission.city)}</dd>
            </div>
            <div>
              <dt className="label-caps text-text-3">Era it needs</dt>
              <dd data-testid="era" className="font-mono text-[15px] text-text-1">
                {era}
              </dd>
            </div>
            <div>
              <dt className="label-caps text-text-3">Source</dt>
              <dd className="font-mono text-[15px] text-text-1">
                {source ? (
                  <a
                    href={source.href}
                    target="_blank"
                    rel="noreferrer"
                    data-testid="source-link"
                    className="inline-flex h-10 items-center gap-1 underline decoration-border-strong underline-offset-4"
                  >
                    {source.hostname.replace(/^www\./, "")}
                    <ExternalLink aria-hidden className="size-3.5" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                ) : (
                  "No source: written for the game."
                )}
              </dd>
            </div>
            <div>
              <dt className="label-caps text-text-3">Building</dt>
              <dd className="font-mono text-[15px] text-text-1">our agent casts it</dd>
            </div>
          </dl>
          <p className="mt-auto font-mono text-xs text-text-3">{MISSION_DISCLAIMER}</p>
        </article>
      </section>
      <section aria-label={`The map of ${cityName(mission.city)}`} className={cn(PAGE, "static")}>
        <div className={CASEHEAD}>
          <span className="font-hand text-lg text-text-1 normal-case">{cityName(mission.city)}</span>
          <span>Map</span>
        </div>
        {/* The city's buildings our agent can cast from, each marked by a little building. */}
        <div data-testid="mission-map" className="relative min-h-[220px] flex-1 overflow-hidden rounded-[4px] border-2 border-border-strong bg-n-850">
          <MapView
            city={mission.city}
            buildings={inCity}
            caption={`${cityName(mission.city)} · ${inCity.length} ${inCity.length === 1 ? "building" : "buildings"}`}
            pin={(building, x, y) => (
              <div
                key={building.id}
                data-testid="mission-map-pin"
                data-building={building.id}
                title={building.name}
                className="absolute size-0"
                style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
              >
                <BuildingMarker size="sm" className="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2" />
              </div>
            )}
          />
        </div>
        <div className="max-w-[420px] -rotate-1 self-start border-2 border-border bg-accent px-3 pt-2 pb-3 font-hand text-base leading-snug text-text-1 shadow-[3px_5px_0_rgb(0_0_0/0.2)]">
          <span className="block font-sans text-[10px] font-extrabold tracking-[0.1em] text-text-2 uppercase">The job</span>
          {mission.objective}
        </div>
        <p className="font-hand text-sm text-text-2">Somewhere in this city our agent finds a building that fits, then the board is built from it.</p>
        {/* The stamp, docked on the desk at the end of the tab row like every screen's action (see BuildingScreen). */}
        <div
          data-testid="stamp-dock"
          className="lg:absolute lg:top-0 lg:right-4 lg:z-20 lg:-translate-y-[calc(100%+14px)] [&>*]:w-full lg:[&>*]:w-auto lg:[&>*]:min-w-[200px]"
        >
          <Link href={castHref(mission.id)} data-testid="take-the-job" className={buttonVariants({ variant: "primary" })}>
            Take the job
          </Link>
        </div>
      </section>
    </div>
  );
}
