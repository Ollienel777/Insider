import { Check, Minus, X } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { LAYERS, LayerDot, type Layer } from "@/components/shell/layer-dot";
import { MODEL_FIXTURES_NOTE, MODEL_FORCED_NOTE } from "@/components/shell/steps";
import { buildingHref } from "@/lib/building-href";
import { cityName } from "@/lib/cities";
import type { CastReason, ReasonStatus, ShowcaseCast, ShowcaseLevel } from "@/lib/showcase-cast";
import { cn } from "@/lib/utils";

const LAYER_ORDER = Object.keys(LAYERS) as Layer[];

/** The building's steps the card links to, each on the cast mission (`?m=`). */
export const SHOWCASE_STEPS = [
  ["scout", "Scout"],
  ["dossier", "Dossier"],
  ["plan", "Plan"],
  ["run", "Run"],
] as const;

const STATUS: Record<ReasonStatus, { word: string; Icon: typeof Check }> = {
  match: { word: "Matches", Icon: Check },
  miss: { word: "Doesn't match", Icon: X },
  unknown: { word: "Not on the record", Icon: Minus },
};

/** How a row joins the value to the need: "Class B · needs Class A". */
const CONNECTOR: Record<ReasonStatus, string> = { match: "fits", miss: "needs", unknown: "can't check" };

/** "fits 5 of 7 of the mission's needs". */
export function matchLine(reasons: readonly CastReason[]): string {
  return `fits ${reasons.filter((r) => r.status === "match").length} of ${reasons.length} of the mission's needs`;
}

/** Where the building's level stands, in the Dossier's words where it has them. */
export const LEVEL_LINE: Record<ShowcaseLevel, string> = {
  built: "Its level is built: Plan and Run are ready.",
  building: "Its level is being built now. This takes a minute or two.",
  failed: "The last build of its level failed. Its Dossier says why and can try again.",
  none: "No level yet: its Dossier builds one before Plan and Run.",
  "model-forced": MODEL_FORCED_NOTE,
  "model-fixtures": MODEL_FIXTURES_NOTE,
};

interface ShowcaseCardProps {
  showcase: ShowcaseCast;
  missionId: string;
  selected: boolean;
  onSelect: (id: string) => void;
}

/**
 * The showcase building the mission is cast onto (issue 103): a real CoStar kit
 * building from the server's showcase list, not a pick of the replayed
 * funnel. It says so, then how it fits, need by need from its CoStar fields,
 * and where it does not, then links to its Scout, Dossier, Plan and Run on this
 * mission. Its heading picks it for "Scout it", like a finalist's.
 */
/** "Century City, Los Angeles"; the city once when the record's neighbourhood is the city itself. */
export function placeLine(neighbourhood: string, city: string): string {
  return neighbourhood.trim().toLowerCase() === city.trim().toLowerCase() || !neighbourhood.trim() ? city : `${neighbourhood}, ${city}`;
}

export function ShowcaseCard({ showcase: s, missionId, selected, onSelect }: ShowcaseCardProps) {
  return (
    <article
      data-testid="showcase-card"
      data-building={s.id}
      data-selected={selected || undefined}
      onClick={() => onSelect(s.id)}
      className={cn(
        "flex h-full cursor-pointer flex-col gap-4 rounded-md border bg-surface-2 p-4 shadow-e-1 transition-colors duration-fast",
        selected ? "border-accent bg-accent-wash" : "border-border hover:border-border-strong",
      )}
    >
      <div className="flex min-w-0 flex-col gap-3">
        <button
          type="button"
          data-testid="showcase-pick"
          aria-pressed={selected}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(s.id);
          }}
          className="-m-1 block min-w-0 rounded-sm p-1 text-left"
        >
          <span className="block label-caps text-text-3">Showcase · CoStar record</span>
          <span className={cn("mt-1 block truncate text-base font-semibold", selected ? "text-accent" : "text-text-1")}>{s.name}</span>
          <span className="block text-sm text-text-2">{placeLine(s.neighbourhood, cityName(s.city))}</span>
        </button>
        <dl className="grid grid-cols-4 gap-2">
          {(
            [
              ["Built", s.yearBuilt],
              ["Class", s.buildingClass],
              ["Stories", s.stories],
            ] as const
          ).map(([term, value]) => (
            <div key={term}>
              <dt className="label-caps text-text-3">{term}</dt>
              <dd className="font-mono text-sm text-text-1">{value}</dd>
            </div>
          ))}
          <div>
            <dt className="label-caps text-text-3">Layers</dt>
            <dd className="flex h-5 items-center gap-1" role="group" aria-label="Data layers">
              {LAYER_ORDER.map((layer) => (
                <LayerDot key={layer} layer={layer} absent={!s.layers[layer]} />
              ))}
            </dd>
          </div>
        </dl>
        <nav aria-label={`${s.name}'s steps`} data-testid="showcase-steps" onClick={(event) => event.stopPropagation()}>
          <ul className="flex flex-wrap gap-2">
            {SHOWCASE_STEPS.map(([screen, label]) => (
              <li key={screen}>
                <Link href={buildingHref(s.id, screen, missionId)} className={buttonVariants({ variant: "secondary" })}>
                  {label}
                </Link>
              </li>
            ))}
          </ul>
          <p data-testid="showcase-level" className="mt-2 text-sm text-text-2">
            {LEVEL_LINE[s.level]}
          </p>
        </nav>
      </div>
      <section aria-labelledby={`showcase-${s.id}-because`} className="min-w-0">
        <h3 id={`showcase-${s.id}-because`} className="label-caps text-text-3">
          Picked from the showcase list · {matchLine(s.reasons)}
        </h3>
        <ul data-testid="showcase-reasons" className="mt-2 flex flex-col gap-1 text-sm">
          {s.reasons.map((r) => {
            const { word, Icon } = STATUS[r.status];
            return (
              <li key={r.need} data-testid="showcase-reason" data-status={r.status} className="grid grid-cols-[16px_minmax(0,1fr)] items-start gap-2">
                <Icon aria-hidden className={cn("mt-0.5 size-4 stroke-[1.5]", r.status === "match" ? "text-text-1" : "text-text-3")} />
                <span className="min-w-0">
                  <span className="sr-only">{word}: </span>
                  <span className={cn("font-mono", r.status === "match" ? "text-text-1" : "text-text-2")}>{r.value}</span>
                  <span className="text-text-2">
                    {" "}
                    · {CONNECTOR[r.status]} {r.need}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </article>
  );
}
