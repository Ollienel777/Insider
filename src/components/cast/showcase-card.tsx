import { Check, ChevronRight, Minus, X } from "lucide-react";
import { LAYERS, LayerDot, type Layer } from "@/components/shell/layer-dot";
import { cityName } from "@/lib/cities";
import type { ReasonStatus, ShowcaseCast, ShowcaseLevel } from "@/lib/showcase-cast";
import { cn } from "@/lib/utils";
import { vacantFloorLine } from "./finalist-card";

const LAYER_ORDER = Object.keys(LAYERS) as Layer[];

const STATUS: Record<ReasonStatus, { word: string; Icon: typeof Check }> = {
  match: { word: "Matches", Icon: Check },
  miss: { word: "Doesn't match", Icon: X },
  unknown: { word: "Not on the record", Icon: Minus },
};

/** Where the building's level stands, in the few words its card's slot holds. */
export const LEVEL_WORD: Record<ShowcaseLevel, string> = {
  built: "Level ready",
  building: "Level building",
  failed: "Level failed",
  none: "Level in prep",
  "model-forced": "Level in prep",
  "model-fixtures": "Level in prep",
};

/** "Century City, Los Angeles"; the city once when the record's neighbourhood is the city itself. */
export function placeLine(neighbourhood: string, city: string): string {
  return neighbourhood.trim().toLowerCase() === city.trim().toLowerCase() || !neighbourhood.trim() ? city : `${neighbourhood}, ${city}`;
}

interface ShowcaseCardProps {
  showcase: ShowcaseCast;
  /** Its place among the three cards. */
  rank: number;
  selected: boolean;
  onSelect: (id: string) => void;
}

/**
 * The showcase building the mission is cast onto (issues 103 and 228): a real
 * CoStar kit building from the server's showcase list, in a finalist's slot
 * and laid out as a finalist's card is: name and place, year built, class and
 * stories, its layers, the vacant floor, a line on what it is, and how it
 * meets each filter, folded away. Its heading picks it for "Scout it".
 */
export function ShowcaseCard({ showcase: s, rank, selected, onSelect }: ShowcaseCardProps) {
  return (
    <article
      data-testid="showcase-card"
      data-building={s.id}
      data-selected={selected || undefined}
      onClick={() => onSelect(s.id)}
      className={cn(
        "relative flex h-full cursor-pointer flex-col gap-3 rounded-md border bg-surface-2 p-4 shadow-e-1 transition-colors duration-fast",
        selected ? "border-accent bg-accent-wash" : "border-border hover:border-border-strong",
      )}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          data-testid="showcase-pick"
          aria-pressed={selected}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(s.id);
          }}
          className="-m-1 block min-w-0 flex-1 rounded-sm p-1 text-left"
        >
          <span className="block label-caps whitespace-nowrap text-text-3">
            Finalist {rank} · Showcase
          </span>
          <span className={cn("mt-1 block truncate text-base font-semibold", selected ? "text-accent" : "text-text-1")}>{s.name}</span>
          <span className="block text-sm text-text-2">{placeLine(s.neighbourhood, cityName(s.city))}</span>
        </button>
        <div
          data-testid="showcase-level"
          data-level={s.level}
          className="relative flex h-16 w-[102px] shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-surface-0"
        >
          <span className="px-1 text-center label-caps text-text-3">{LEVEL_WORD[s.level]}</span>
        </div>
      </div>
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
        <div className="col-span-4">
          <dt className="label-caps text-text-3">Vacant floor</dt>
          <dd data-testid="vacant-floor" className="font-mono text-sm text-text-1">
            {s.vacantFloor
              ? vacantFloorLine(s.vacantFloor)
                  .split(" · suite")
                  .map((part, i) => (i === 0 ? <span key={i}>{part}</span> : <span key={i} className="block">{` suite${part}`}</span>))
              : "None on the market"}
          </dd>
        </div>
      </dl>
      <figure className="border-l-2 border-border-strong pl-3">
        <blockquote data-testid="showcase-description" className="text-sm text-text-1">
          {s.description}
        </blockquote>
        <figcaption className="mt-1 label-caps text-text-3">Showcase list · CoStar record</figcaption>
      </figure>
      <details className="mt-auto text-sm" onClick={(event) => event.stopPropagation()}>
        <summary className="group/fit inline-flex h-10 cursor-pointer list-none items-center gap-1 rounded-sm text-text-2 hover:text-text-1 [&::-webkit-details-marker]:hidden">
          <ChevronRight aria-hidden className="size-4 stroke-[1.5] transition-transform duration-fast [[open]>summary_&]:rotate-90" />
          How it meets the filters
        </summary>
        <ul data-testid="showcase-reasons" className="flex flex-col gap-1 pb-1">
          {s.reasons.map((r) => {
            const { word, Icon } = STATUS[r.status];
            return (
              <li key={r.need} data-testid="showcase-reason" data-status={r.status} className="flex justify-between gap-3">
                <span className="text-text-2">{r.need}</span>
                <span className="flex shrink-0 items-center gap-1 font-mono text-text-1">
                  <span className="sr-only">{word}: </span>
                  {r.value}
                  <Icon aria-hidden className={cn("size-4 stroke-[1.5]", r.status === "match" ? "text-text-1" : "text-text-3")} />
                </span>
              </li>
            );
          })}
        </ul>
      </details>
    </article>
  );
}
