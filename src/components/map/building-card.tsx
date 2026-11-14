import { LayerDot } from "@/components/shell/layer-dot";
import { cn } from "@/lib/utils";
import type { MapBuilding } from "./types";

/** Where the card sits relative to its pin, so it stays on the map. */
export interface CardPlacement {
  vertical: "above" | "below";
  horizontal: "centre" | "start" | "end";
}

/** Above the pin unless the pin is near the top; flush to the pin's side near the left or right edge. */
export function cardPlacement(x: number, y: number): CardPlacement {
  return {
    vertical: y < 0.4 ? "below" : "above",
    horizontal: x < 0.2 ? "start" : x > 0.8 ? "end" : "centre",
  };
}

/**
 * The pin's hover card (DESIGN.md, Map): name, neighbourhood, and the CoStar
 * fields the level is built from: year built, class and stories.
 */
export function BuildingCard({ building, placement }: { building: MapBuilding; placement: CardPlacement }) {
  return (
    <div
      role="tooltip"
      id={`card-${building.id}`}
      data-testid="building-card"
      className={cn(
        "pointer-events-none absolute z-30 w-64 rounded-md border border-border-strong bg-surface-2 p-3 shadow-e-1",
        "animate-in fade-in-0 duration-fast",
        placement.vertical === "above" ? "bottom-8" : "top-12",
        placement.horizontal === "centre" && "left-1/2 -translate-x-1/2",
        placement.horizontal === "start" && "-left-2",
        placement.horizontal === "end" && "-right-2",
      )}
    >
      <p className="flex items-center gap-1.5 label-caps text-text-3">
        <LayerDot layer="costar" decorative />
        CoStar {building.source === "fixture" ? "· fixture" : "record"}
      </p>
      <p className="mt-2 truncate text-sm font-medium text-text-1">{building.name}</p>
      <p className="truncate text-sm text-text-2">{building.neighbourhood}</p>
      <dl className="mt-3 grid grid-cols-3 gap-2">
        {(
          [
            ["Built", building.yearBuilt],
            ["Class", building.buildingClass],
            ["Stories", building.stories],
          ] as const
        ).map(([term, value]) => (
          <div key={term}>
            <dt className="label-caps text-text-3">{term}</dt>
            <dd className="font-mono text-sm text-text-1">{value}</dd>
          </div>
        ))}
      </dl>
      {building.levelReady ? null : (
        <p className="mt-3 border-t border-border pt-2 text-sm text-text-2">Level in prep: no floor yet.</p>
      )}
    </div>
  );
}
