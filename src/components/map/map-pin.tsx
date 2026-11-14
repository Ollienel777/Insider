import { LAYERS, LayerDot, type Layer } from "@/components/shell/layer-dot";
import { cn } from "@/lib/utils";
import { BuildingCard, cardPlacement } from "./building-card";
import type { MapBuilding } from "./types";

const LAYER_ORDER = Object.keys(LAYERS) as Layer[];

interface MapPinProps {
  building: MapBuilding;
  /** Position on the basemap, as fractions of its width and height. */
  x: number;
  y: number;
  selected: boolean;
  /** Show the hover card: the pointer or focus is on this pin or its row. */
  showCard: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}

/**
 * One building on the map (DESIGN.md, Map): a 12px disc with the three layer
 * dots beneath, each outlined when the building lacks that layer, and its
 * name beside it. The hit target is 40px. A building without a level is
 * shown but disabled, marked "Level in prep"; a CoStar kit building, which
 * never gets a level, is marked "facts only" instead.
 */
export function MapPin({ building, x, y, selected, showCard, onSelect, onHover }: MapPinProps) {
  const disabled = !building.levelReady;
  return (
    <div
      data-testid="map-pin"
      data-building={building.id}
      data-selected={selected || undefined}
      className={cn("absolute size-0", showCard || selected ? "z-20" : "z-10")}
      style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
    >
      <button
        type="button"
        aria-label={disabled ? `${building.name}, ${building.source === "costar" ? "facts only" : "level in prep"}` : building.name}
        aria-pressed={disabled ? undefined : selected}
        aria-disabled={disabled || undefined}
        aria-describedby={showCard ? `card-${building.id}` : undefined}
        onClick={() => (disabled ? undefined : onSelect(building.id))}
        onPointerEnter={() => onHover(building.id)}
        onPointerLeave={() => onHover(null)}
        onFocus={() => onHover(building.id)}
        onBlur={() => onHover(null)}
        className={cn(
          "group absolute top-0 left-0 flex size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-sm",
          disabled ? "cursor-default" : "cursor-pointer",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "size-3 rounded-full ring-2 ring-surface-0 transition-transform duration-fast",
            disabled ? "bg-n-500" : selected ? "bg-accent" : "bg-text-1 group-hover:scale-125",
          )}
        />
        {selected ? (
          <span aria-hidden className="absolute size-6 rounded-full border border-accent" />
        ) : null}
        <span className="absolute top-[calc(50%+12px)] left-1/2 flex -translate-x-1/2 gap-0.5">
          {LAYER_ORDER.map((layer) => (
            <LayerDot key={layer} layer={layer} absent={!building.layers[layer]} decorative />
          ))}
        </span>
        <span
          aria-hidden
          className={cn(
            "absolute top-1/2 left-[calc(50%+16px)] -translate-y-1/2 whitespace-nowrap rounded-sm bg-surface-0/80 px-1.5 text-xs font-medium",
            disabled ? "text-text-3" : selected ? "text-accent" : "text-text-1",
          )}
        >
          {building.name}
        </span>
      </button>
      {showCard ? <BuildingCard building={building} placement={cardPlacement(x, y)} /> : null}
    </div>
  );
}
