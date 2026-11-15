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
          <h1 className="mt-1 text-xl font-semibold text-text-1">Pick a mission</h1>
          {/* SPEC §2 beat 1, the hook, word for word. */}
          <p className="mt-1 max-w-[640px] text-base text-text-2">
            Every heist in history needed a building. Our agent finds one that&apos;s empty tonight.
          </p>
        </header>
        <ul aria-label="Missions" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {missions.map((mission) => (
            <li key={mission.id} className="min-w-0">
              <MissionCard mission={mission} />
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

function MissionCard({ mission }: { mission: Mission }) {
  const { inspiredBy } = mission;
  const source = inspiredBy ? safeSourceUrl(inspiredBy.sourceUrl) : null;
  return (
    <article
      data-testid="mission-card"
      data-mission={mission.id}
      className="flex h-full flex-col rounded-md border border-border bg-surface-1 shadow-e-1 transition-colors duration-fast hover:border-border-strong"
    >
      <Link
        href={castHref(mission.id)}
        className="group flex flex-1 flex-col gap-2 rounded-t-md p-4 pb-3 transition-colors duration-fast hover:bg-surface-2 focus-visible:outline-offset-[-2px]"
      >
        <span className="label-caps text-text-3">
          {mission.type === "heist" ? "Heist" : "Prevent"} · {cityName(mission.city)}
        </span>
        <h2 className="text-lg font-semibold text-text-1">{mission.title}</h2>
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
          <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-text-2 group-hover:text-text-1">
            Cast it
            <ArrowRight aria-hidden className="size-4 stroke-[1.5]" />
          </span>
        </span>
      </Link>
      <div className="flex flex-col border-t border-border px-4 pt-1 pb-3">
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
