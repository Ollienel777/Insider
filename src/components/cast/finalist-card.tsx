import { ChevronRight } from "lucide-react";
import { LAYERS, LayerDot, type Layer } from "@/components/shell/layer-dot";
import { suiteRange } from "@/components/dossier/data-to-level";
import type { MassingView } from "@/components/scout/massing";
import { MassingSvg } from "@/components/scout/massing-view";
import type { Candidate } from "@/domain";
import { cityName } from "@/lib/cities";
import { cn } from "@/lib/utils";

const LAYER_ORDER = Object.keys(LAYERS) as Layer[];
const SF = new Intl.NumberFormat("en-US");

interface FinalistCardProps {
  candidate: Candidate;
  /** 1 for the agent's first pick. */
  rank: number;
  selected: boolean;
  /** False for a finalist with no building pages yet: picking it shows "Level in prep". */
  scoutable: boolean;
  /** "Casting Director · scripted": who wrote the reason, and how this run made it. */
  reasonLabel: string;
  /** One view of its massing (fixture aerials only); none shows "Level in prep" or "No aerial" in the slot. */
  thumbnail?: MassingView;
  onSelect: (id: string) => void;
}

/** A fit value as the card prints it: `true` reads "yes". */
export function fitValue(value: Candidate["fit"][number]["value"]): string {
  return value === true ? "yes" : value === false ? "no" : String(value);
}

/** "Floor 22 · 23,341 SF · suites 2202–2210". */
export function vacantFloorLine(floor: Candidate["vacantFloor"]): string {
  const suites = suiteRange(floor.suites);
  return `Floor ${floor.floor} · ${SF.format(floor.sf)} SF · ${floor.suites.length === 1 ? "suite" : "suites"} ${suites}`;
}

/**
 * One of the three finalists (SPEC §2 beat 2): name and place, year built,
 * class and stories, the vacant floor, the three layer dots as the map's pins
 * carry them, the agent's one-line reason in its own words, and how the
 * building fits each filter. Its heading is the button that picks it (a
 * click anywhere else on the card does too); the fit list opens on its own.
 */
export function FinalistCard({ candidate, rank, selected, scoutable, reasonLabel, thumbnail, onSelect }: FinalistCardProps) {
  const c = candidate;
  return (
    <article
      data-testid="finalist-card"
      data-building={c.id}
      data-selected={selected || undefined}
      onClick={() => onSelect(c.id)}
      className={cn(
        "relative flex h-full cursor-pointer flex-col gap-3 rounded-md border bg-surface-2 p-4 shadow-e-1 transition-colors duration-fast",
        selected ? "border-accent bg-accent-wash" : "border-border hover:border-border-strong",
      )}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          data-testid="finalist-pick"
          aria-pressed={selected}
          aria-describedby={scoutable ? undefined : `finalist-${c.id}-prep`}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(c.id);
          }}
          className="-m-1 block min-w-0 flex-1 rounded-sm p-1 text-left"
        >
          <span className="block label-caps whitespace-nowrap text-text-3">
            Finalist {rank} · <span className="font-mono">{c.id}</span>
          </span>
          <span className={cn("mt-1 block truncate text-base font-semibold", selected ? "text-accent" : "text-text-1")}>
            {c.name}
          </span>
          <span className="block text-sm text-text-2">
            {c.neighbourhood}, {cityName(c.city)}
          </span>
        </button>
        <Thumbnail candidate={c} view={thumbnail} prepId={scoutable ? undefined : `finalist-${c.id}-prep`} />
      </div>
      <dl className="grid grid-cols-4 gap-2">
        {(
          [
            ["Built", c.yearBuilt],
            ["Class", c.buildingClass],
            ["Stories", c.stories],
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
              <LayerDot key={layer} layer={layer} absent={!c.layers[layer]} />
            ))}
          </dd>
        </div>
        <div className="col-span-4">
          <dt className="label-caps text-text-3">Vacant floor</dt>
          <dd data-testid="vacant-floor" className="font-mono text-sm text-text-1">
            {/* The floor on one line, its suites on the next: "Floor 22 · 23,341 SF" / "suites 2202–2210". */}
            {vacantFloorLine(c.vacantFloor)
              .split(" · suite")
              .map((part, i) => (i === 0 ? <span key={i}>{part}</span> : <span key={i} className="block">{` suite${part}`}</span>))}
          </dd>
        </div>
      </dl>
      <figure className="border-l-2 border-border-strong pl-3">
        <blockquote data-testid="finalist-reason" className="text-sm text-text-1">
          {c.reason}
        </blockquote>
        <figcaption className="mt-1 label-caps text-text-3">{reasonLabel}</figcaption>
      </figure>
      <details className="mt-auto text-sm" onClick={(event) => event.stopPropagation()}>
        <summary className="group/fit inline-flex h-10 cursor-pointer list-none items-center gap-1 rounded-sm text-text-2 hover:text-text-1 [&::-webkit-details-marker]:hidden">
          <ChevronRight aria-hidden className="size-4 stroke-[1.5] transition-transform duration-fast [[open]>summary_&]:rotate-90" />
          Fits all {c.fit.length} filters
        </summary>
        <ul data-testid="finalist-fit" className="flex flex-col gap-1 pb-1">
          {c.fit.map((f) => (
            <li key={f.criterion} className="flex justify-between gap-3">
              <span className="text-text-2">{f.criterion}</span>
              <span className="shrink-0 font-mono text-text-1">{fitValue(f.value)}</span>
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}

/**
 * The card's aerial slot (SPEC §2 beat 2's "aerial thumbnail"). The Vexcel
 * fake has no photographs, so a fixture building shows the Scout screen's
 * massing, drawn from its fixture footprint, height and tags; a finalist
 * without a level shows "Level in prep" there instead, and one with a level
 * but no aerial says so.
 */
function Thumbnail({ candidate, view, prepId }: { candidate: Candidate; view?: MassingView; prepId?: string }) {
  const box = "relative h-16 w-[102px] shrink-0 overflow-hidden rounded-sm border border-border bg-surface-0";
  if (view) {
    return (
      <div
        role="img"
        aria-label={`Massing of ${candidate.name}, drawn from fixture footprint and tags, not imagery`}
        data-testid="finalist-thumbnail"
        className={box}
      >
        <MassingSvg view={view} />
      </div>
    );
  }
  return (
    <div data-testid="finalist-thumbnail" className={cn(box, "flex items-center justify-center")}>
      <span id={prepId} className="px-1 text-center label-caps text-text-3">
        {prepId ? "Level in prep" : "No aerial"}
      </span>
    </div>
  );
}
