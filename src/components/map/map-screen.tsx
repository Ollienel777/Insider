"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Fragment, useState, type KeyboardEvent, type ReactNode } from "react";
import { LAYERS, LayerDot, type Layer } from "@/components/shell/layer-dot";
import { BuildingScreen } from "@/components/shell/building-screen";
import { Button, buttonVariants } from "@/components/ui/button";
import { City } from "@/domain";
import { cityName } from "@/lib/cities";
import { cn } from "@/lib/utils";
import { buildingHref } from "@/lib/building-href";
import { aspect, ATTRIBUTION, BASEMAPS, placeIn, project, type Bounds } from "./basemap";
import { MapPin } from "./map-pin";
import type { MapBuilding } from "./types";

const CITIES = City.options;

interface MapScreenProps {
  /** Every city's buildings, from the CoStar adapter. */
  buildings: MapBuilding[];
  /** The tab with no `?city=` in the address (and outside the router). */
  defaultCity: City;
}

/**
 * The map (`/`, SPEC §2 beat 1): the city's basemap with a pin per building,
 * the buildings as rows beside it, LA / Houston tabs, and "Scout this
 * building". Selecting a pin or a row selects both; hovering either shows the
 * pin's card.
 */
export function MapScreen({ buildings, defaultCity }: MapScreenProps) {
  const [city, writeCity] = useCityTab(defaultCity);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const inCity = buildings.filter((b) => b.city === city);
  const selected = inCity.find((b) => b.id === selectedId && b.levelReady) ?? null;
  const cardId = hoveredId ?? selected?.id ?? null;

  function switchCity(next: City) {
    setHoveredId(null);
    writeCity(next);
  }

  return (
    <BuildingScreen
      visualLabel={`Map of ${cityName(city)}`}
      visual={
        <MapView
          city={city}
          buildings={inCity}
          caption={`${cityName(city)} · ${inCity.length} ${inCity.length === 1 ? "building" : "buildings"}`}
          pin={(building, x, y) => (
            <MapPin
              building={building}
              x={x}
              y={y}
              selected={building.id === selected?.id}
              showCard={building.id === cardId}
              onSelect={setSelectedId}
              onHover={setHoveredId}
            />
          )}
        />
      }
      panel={
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="text-lg font-semibold text-text-1">Pick a building</h1>
            <p className="mt-1 text-sm text-text-2">
              Its CoStar record, aerial and floor become the level.
            </p>
          </div>
          <CityTabs city={city} onChange={switchCity} counts={countByCity(buildings)} />
          <div role="tabpanel" id="city-panel" aria-labelledby={`tab-${city}`}>
            {inCity.length === 0 ? (
              <EmptyCity city={city} onSwitchCity={switchCity} />
            ) : (
              <ul aria-label={`Buildings in ${cityName(city)}`} className="-mx-4 flex flex-col">
                {inCity.map((building) => (
                  <li key={building.id}>
                    <BuildingRow
                      building={building}
                      selected={building.id === selected?.id}
                      onSelect={setSelectedId}
                      onHover={setHoveredId}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      }
      action={
        <div className="flex flex-col gap-2">
          <p data-testid="selection" className="truncate text-sm text-text-2">
            {selected ? (
              <>
                <span className="text-text-1">{selected.name}</span>, {selected.neighbourhood}
              </>
            ) : inCity.length === 0 ? (
              `No building to scout in ${cityName(city)}.`
            ) : (
              "Pick a building on the map or in the list."
            )}
          </p>
          {selected ? (
            <Link href={buildingHref(selected.id, "scout", null /* no mission picked on the map: Scout redirects to its own */)} className={buttonVariants({ variant: "primary" })}>
              Scout this building
            </Link>
          ) : (
            <Button variant="primary" disabled>
              Scout this building
            </Button>
          )}
        </div>
      }
    />
  );
}

/** `?city=` as a city; anything missing or unknown is the screen's default. */
export function cityFromParam(value: string | null | undefined, fallback: City = "LA"): City {
  const parsed = City.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

/**
 * The address that opens `city`'s tab on the route at `pathname`: the route
 * itself for its default city, else with `?city=`. Whatever route the map is
 * on (the map, the cast screen), a tab click keeps the address there.
 */
export function cityHref(pathname: string, city: City, defaultCity: City): string {
  return city === defaultCity ? pathname : `${pathname}?city=${city}`;
}

/**
 * The open city tab and a way to switch it. The address is the one record of
 * the open tab, so the tab follows it both ways: a tab click writes `?city=`
 * on the current route, and any navigation (Back, a shared link) moves the
 * tab. Outside the router (unit tests) `defaultCity` stands in.
 */
export function useCityTab(defaultCity: City): [City, (next: City) => void] {
  const params = useSearchParams();
  const pathname = usePathname();
  const city = cityFromParam(params?.get("city"), defaultCity);
  // Next keeps useSearchParams in step with the History API, so writing the
  // address is what switches the tab; a reload or a shared link opens it.
  const write = (next: City) =>
    window.history.replaceState(null, "", cityHref(pathname ?? window.location.pathname, next, defaultCity));
  return [city, write];
}

function countByCity(buildings: MapBuilding[]): Record<City, number> {
  const counts = Object.fromEntries(CITIES.map((c) => [c, 0])) as Record<City, number>;
  for (const b of buildings) counts[b.city]++;
  return counts;
}

/** LA / Houston as tabs (WAI-ARIA tabs: arrow keys move between them). */
export function CityTabs({ city, onChange, counts }: { city: City; onChange: (c: City) => void; counts: Record<City, number> }) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const index = CITIES.indexOf(city);
    const next = CITIES[(index + (event.key === "ArrowRight" ? 1 : CITIES.length - 1)) % CITIES.length];
    onChange(next);
    document.getElementById(`tab-${next}`)?.focus();
  }
  return (
    <div
      role="tablist"
      aria-label="City"
      onKeyDown={onKeyDown}
      className="grid grid-cols-2 gap-1 rounded-sm bg-surface-0 p-1"
    >
      {CITIES.map((c) => (
        <button
          key={c}
          type="button"
          role="tab"
          id={`tab-${c}`}
          aria-selected={c === city}
          aria-controls="city-panel"
          tabIndex={c === city ? 0 : -1}
          onClick={() => onChange(c)}
          className={cn(
            "inline-flex h-10 items-center justify-center gap-2 rounded-sm text-sm transition-colors duration-fast",
            c === city ? "bg-surface-3 font-medium text-text-1" : "text-text-2 hover:text-text-1",
          )}
        >
          {cityName(c)}
          <span className="font-mono text-xs text-text-3">{counts[c]}</span>
        </button>
      ))}
    </div>
  );
}

interface RowProps {
  building: MapBuilding;
  selected: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}

function BuildingRow({ building, selected, onSelect, onHover }: RowProps) {
  const disabled = !building.levelReady;
  return (
    <button
      type="button"
      data-testid="building-row"
      data-building={building.id}
      aria-pressed={disabled ? undefined : selected}
      aria-disabled={disabled || undefined}
      onClick={() => (disabled ? undefined : onSelect(building.id))}
      onPointerEnter={() => onHover(building.id)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onHover(building.id)}
      onBlur={() => onHover(null)}
      className={cn(
        "relative flex min-h-10 w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-fast",
        disabled ? "cursor-default" : "hover:bg-surface-3",
        selected &&
          "bg-accent-wash before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent hover:bg-accent-wash",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={cn("truncate text-sm font-medium", disabled ? "text-text-2" : "text-text-1")}>
            {building.name}
          </span>
          {disabled ? (
            <span className="shrink-0 rounded-sm border border-border px-1.5 label-caps text-text-3">Level in prep</span>
          ) : null}
        </span>
        <span className="block truncate text-sm text-text-2">
          {building.neighbourhood} · {building.yearBuilt} · Class {building.buildingClass} · {building.stories} stories
        </span>
      </span>
      <span className="flex shrink-0 gap-1">
        {(Object.keys(LAYERS) as Layer[]).map((layer) => (
          <LayerDot key={layer} layer={layer} absent={!building.layers[layer]} />
        ))}
      </span>
    </button>
  );
}

function EmptyCity({ city, onSwitchCity }: { city: City; onSwitchCity: (c: City) => void }) {
  const other = CITIES.find((c) => c !== city)!;
  return (
    <div data-testid="empty-city" className="flex flex-col items-start gap-3 py-2">
      <p className="text-sm text-text-1">No buildings are staged in {cityName(city)} yet.</p>
      <p className="text-sm text-text-2">CoStar returned no buildings for this city.</p>
      <Button variant="secondary" onClick={() => onSwitchCity(other)}>
        Show {cityName(other)}
      </Button>
    </div>
  );
}

interface MapViewProps<B extends Pick<MapBuilding, "id" | "lat" | "lng">> {
  city: City;
  buildings: B[];
  /** The mono caps line over the map's top-left corner. */
  caption: ReactNode;
  /** Draws one building's pin at (`x`, `y`), fractions of the map's box. */
  pin: (building: B, x: number, y: number) => ReactNode;
  /**
   * Show all of this view (`fitView`: the basemap, widened when a pin that
   * must show is off it), fitted inside the area with the basemap at its
   * place in it, so nothing in it is cropped. By default the basemap covers
   * the area, cropping its edges to fill it.
   */
  view?: Bounds;
}

/**
 * Behind a fitted view: the basemap's ground with a faint grid in its
 * street-line tone, so the area past the street map's edge reads as the
 * same map beyond its streets, not as missing tiles. No streets are drawn.
 */
const BEYOND_STREETS = {
  backgroundColor: "var(--n-950)",
  backgroundImage:
    "linear-gradient(to right, var(--n-800) 1px, transparent 1px), linear-gradient(to bottom, var(--n-800) 1px, transparent 1px)",
  backgroundSize: "48px 48px",
} as const;

/**
 * The basemap, scaled to cover the visual area (like `object-fit: cover`) in
 * a box with the image's aspect ratio, so a pin placed at a fraction of the
 * box lands on the right street at every viewport.
 */
export function MapView<B extends Pick<MapBuilding, "id" | "lat" | "lng">>({ city, buildings, caption, pin, view }: MapViewProps<B>) {
  const basemap = BASEMAPS[city];
  const fitted = view !== undefined;
  const bounds = fitted ? view : basemap.bounds;
  const ratio = fitted ? aspect(view) : basemap.width / basemap.height;
  const image = fitted ? placeIn(view, basemap.bounds) : null;
  return (
    <div className="absolute inset-0 overflow-hidden [container-type:size]" style={fitted ? BEYOND_STREETS : undefined}>
      <div
        data-testid="basemap"
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
        data-fitted={fitted || undefined}
        style={{
          // Cover the area with the basemap; or fit a wider view inside it, on
          // the grid (BEYOND_STREETS) that marks everything past the streets.
          width: fitted ? `min(100cqw, calc(100cqh * ${ratio}))` : `max(100cqw, calc(100cqh * ${ratio}))`,
          aspectRatio: fitted ? String(ratio) : `${basemap.width} / ${basemap.height}`,
        }}
      >
        <div
          // The street map's edge, so the grid around it reads as beyond it.
          className={cn("absolute", image && "ring-1 ring-border-strong")}
          style={image ? { left: `${image.left}%`, top: `${image.top}%`, width: `${image.width}%`, height: `${image.height}%` } : { inset: 0 }}
        >
        <Image
          key={city}
          src={basemap.file}
          alt={`Street map of ${cityName(city)}`}
          fill
          priority
          unoptimized
          sizes="100vw"
          className="select-none animate-in fade-in-0 duration-base"
        />
        </div>
        {buildings.map((building) => {
          const { x, y } = project(bounds, building.lat, building.lng);
          return <Fragment key={building.id}>{pin(building, x, y)}</Fragment>;
        })}
      </div>
      <p data-testid="map-caption" className="pointer-events-none absolute top-4 left-6 label-caps text-text-2">
        {caption}
      </p>
      <div className="absolute bottom-0 left-0 flex items-center gap-4 px-6 py-3 max-md:hidden" aria-label="Layers" role="group">
        {(Object.keys(LAYERS) as Layer[]).map((layer) => (
          <span key={layer} className="flex items-center gap-1.5 label-caps text-text-2">
            <LayerDot layer={layer} decorative />
            {LAYERS[layer].label}
          </span>
        ))}
      </div>
      <a
        href={ATTRIBUTION.href}
        target="_blank"
        rel="noreferrer"
        data-testid="basemap-attribution"
        className="absolute right-2 bottom-0 inline-flex h-10 items-center rounded-sm px-2 text-xs text-text-2 hover:text-text-1"
      >
        {ATTRIBUTION.text}
      </a>
    </div>
  );
}
