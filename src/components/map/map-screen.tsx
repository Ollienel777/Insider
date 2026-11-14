"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type KeyboardEvent } from "react";
import { LAYERS, LayerDot, type Layer } from "@/components/shell/layer-dot";
import { BuildingScreen } from "@/components/shell/building-screen";
import { Button, buttonVariants } from "@/components/ui/button";
import { City } from "@/domain";
import { cityName } from "@/lib/cities";
import { cn } from "@/lib/utils";
import { buildingHref } from "@/lib/building-href";
import { ATTRIBUTION, BASEMAPS, project } from "./basemap";
import { MapPin } from "./map-pin";
import type { MapBuilding } from "./types";

const CITIES = City.options;

interface MapScreenProps {
  /** Every city's buildings, from the CoStar adapter. */
  buildings: MapBuilding[];
  /** The city whose tab opens first (`?city=`). */
  initialCity: City;
}

/**
 * The map (`/`, SPEC §2 beat 1): the city's basemap with a pin per building,
 * the buildings as rows beside it, LA / Houston tabs, and "Scout this
 * building". Selecting a pin or a row selects both; hovering either shows the
 * pin's card.
 */
export function MapScreen({ buildings, initialCity }: MapScreenProps) {
  // The address is the one record of the open tab, so the tab follows it
  // both ways: a tab click writes `?city=`, and any navigation (the wordmark
  // to `/`, Back, a shared link) moves the tab. Outside the router (unit
  // tests) the page's `initialCity` stands in.
  const params = useSearchParams();
  const city = params ? cityFromParam(params.get("city")) : initialCity;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const inCity = buildings.filter((b) => b.city === city);
  const selected = inCity.find((b) => b.id === selectedId && b.levelReady) ?? null;
  const cardId = hoveredId ?? selected?.id ?? null;

  function switchCity(next: City) {
    setHoveredId(null);
    // Next keeps useSearchParams in step with the History API, so writing the
    // address is what switches the tab; a reload or a shared link opens it.
    window.history.replaceState(null, "", next === "LA" ? "/" : `/?city=${next}`);
  }

  return (
    <BuildingScreen
      visualLabel={`Map of ${cityName(city)}`}
      visual={
        <MapView
          city={city}
          buildings={inCity}
          selectedId={selected?.id ?? null}
          cardId={cardId}
          onSelect={setSelectedId}
          onHover={setHoveredId}
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

/** `?city=` as a city; anything missing or unknown is LA, as the page reads it. */
export function cityFromParam(value: string | null): City {
  const parsed = City.safeParse(value);
  return parsed.success ? parsed.data : "LA";
}

function countByCity(buildings: MapBuilding[]): Record<City, number> {
  const counts = Object.fromEntries(CITIES.map((c) => [c, 0])) as Record<City, number>;
  for (const b of buildings) counts[b.city]++;
  return counts;
}

/** LA / Houston as tabs (WAI-ARIA tabs: arrow keys move between them). */
function CityTabs({ city, onChange, counts }: { city: City; onChange: (c: City) => void; counts: Record<City, number> }) {
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

interface MapViewProps {
  city: City;
  buildings: MapBuilding[];
  selectedId: string | null;
  cardId: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}

/**
 * The basemap, scaled to cover the visual area (like `object-fit: cover`) in
 * a box with the image's aspect ratio, so a pin placed at a fraction of the
 * box lands on the right street at every viewport.
 */
function MapView({ city, buildings, selectedId, cardId, onSelect, onHover }: MapViewProps) {
  const basemap = BASEMAPS[city];
  const ratio = basemap.width / basemap.height;
  return (
    <div className="absolute inset-0 overflow-hidden [container-type:size]">
      <div
        data-testid="basemap"
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ width: `max(100cqw, calc(100cqh * ${ratio}))`, aspectRatio: `${basemap.width} / ${basemap.height}` }}
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
        {buildings.map((building) => {
          const { x, y } = project(basemap.bounds, building.lat, building.lng);
          return (
            <MapPin
              key={building.id}
              building={building}
              x={x}
              y={y}
              selected={building.id === selectedId}
              showCard={building.id === cardId}
              onSelect={onSelect}
              onHover={onHover}
            />
          );
        })}
      </div>
      <p data-testid="map-caption" className="pointer-events-none absolute top-4 left-6 label-caps text-text-2">
        {cityName(city)} · {buildings.length} {buildings.length === 1 ? "building" : "buildings"}
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
