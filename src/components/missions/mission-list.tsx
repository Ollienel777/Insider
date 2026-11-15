import { ArrowRight, ExternalLink } from "lucide-react";
import Link from "next/link";
import type { Mission } from "@/domain";
import { cityName } from "@/lib/cities";

/** SPEC §1, taste rules: the line every mission card carries. */
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

/**
 * The mission picker (`/`, SPEC §2 beat 1): one card per mission with its
 * title, its "Inspired by" line (event, date and source) or that it is
 * fiction, its city and the era it needs. The card's upper part is one link
 * to its cast screen; the source link and the disclaimer sit under it.
 */
export function MissionList({ missions }: { missions: readonly Mission[] }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 py-8 md:px-6">
        <header>
          <p className="label-caps text-text-3">Missions · {missions.length}</p>
          <h1 className="mt-1 text-3xl font-normal text-text-1">Pick a mission</h1>
          {/* SPEC §2 beat 1, the hook, word for word. */}
          <p className="mt-1 max-w-[640px] text-base text-text-2">
            Every heist in history needed a building. Our agent finds one that&apos;s empty tonight.
          </p>
        </header>
        <ul aria-label="Missions" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {missions.map((mission, index) => (
            <li key={mission.id} className="min-w-0">
              <MissionCard mission={mission} index={index} />
            </li>
          ))}
        </ul>
        {/* Off the demo path: the map of every prepared building, kept for the building screens' "Back to the map". */}
        <Link
          href="/map"
          className="inline-flex h-10 w-fit items-center gap-1 rounded-sm text-sm text-text-2 hover:text-text-1"
        >
          Or browse every prepared building on the map
          <ArrowRight aria-hidden className="size-4 stroke-[1.5]" />
        </Link>
      </div>
    </div>
  );
}

function MissionCard({ mission, index }: { mission: Mission; index: number }) {
  const { inspiredBy } = mission;
  const source = inspiredBy ? safeSourceUrl(inspiredBy.sourceUrl) : null;
  return (
    <article
      data-testid="mission-card"
      data-mission={mission.id}
      className="flex h-full flex-col overflow-hidden rounded-md border-2 border-border-strong bg-surface-1 shadow-e-1 transition-transform duration-base ease-out hover:-translate-y-1"
    >
      <Link
        href={castHref(mission.id)}
        className="group flex flex-1 flex-col gap-2 p-4 pb-4 transition-colors duration-fast hover:bg-surface-2 focus-visible:outline-offset-[-2px]"
      >
        <span className="flex items-center justify-between gap-2">
          {/* A level-select card: a coloured tag for the kind of mission, and its number as a badge. */}
          <span
            className={
              mission.type === "heist"
                ? "label-caps rounded-full border-2 border-border-strong bg-danger px-2.5 py-0.5 text-accent-ink"
                : "label-caps rounded-full border-2 border-border-strong bg-layer-matterport px-2.5 py-0.5 text-accent-ink"
            }
          >
            {mission.type === "heist" ? "Heist" : "Prevent"} · {cityName(mission.city)}
          </span>
          <span
            aria-hidden
            className="grid size-9 place-items-center rounded-sm border-2 border-border-strong bg-surface-3 font-display text-lg font-normal text-text-1 shadow-[0_3px_0_var(--ink-shadow)]"
          >
            {String(index + 1).padStart(2, "0")}
          </span>
        </span>
        <h2 className="text-2xl font-normal tracking-wide text-text-1">{mission.title}</h2>
        <span data-testid="inspired-by" className="text-sm text-text-2">
          {inspiredBy ? (
            <>
              Inspired by {inspiredBy.event},{" "}
              <span className="font-mono whitespace-nowrap text-text-1">{inspiredBy.date}</span>
            </>
          ) : (
            "A fictional mission, written for the game."
          )}
        </span>
        <span className="mt-auto flex items-end justify-between gap-3 pt-2">
          <span className="min-w-0">
            <span className="block label-caps text-text-3">Era it needs</span>
            <span data-testid="era" className="block text-sm text-text-1">
              {eraNeeded(mission)}
            </span>
          </span>
          <span className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-sm border-2 border-border-strong bg-accent px-4 font-display text-base font-normal tracking-wider text-accent-ink shadow-[inset_0_2px_0_var(--key-sheen),inset_0_-3px_0_var(--key-shade),0_4px_0_var(--ink-shadow)] transition-transform duration-fast ease-out group-hover:-translate-y-px group-active:translate-y-[3px]">
            Cast it
            <ArrowRight aria-hidden className="size-4 stroke-[2.5]" />
          </span>
        </span>
      </Link>
      <div className="flex flex-col border-t-2 border-border-strong bg-surface-0/60 px-4 pt-1 pb-3">
        {source ? (
          <a
            href={source.href}
            target="_blank"
            rel="noreferrer"
            data-testid="source-link"
            className="inline-flex h-10 w-fit items-center gap-1 rounded-sm text-sm text-text-1 underline decoration-border-strong underline-offset-4 hover:decoration-text-2"
          >
            Source: {source.hostname.replace(/^www\./, "")}
            <ExternalLink aria-hidden className="size-4 stroke-[1.5]" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : (
          <p className="flex h-10 items-center text-sm text-text-2">No source: written for the game.</p>
        )}
        <p className="text-xs text-text-2">{MISSION_DISCLAIMER}</p>
      </div>
    </article>
  );
}
