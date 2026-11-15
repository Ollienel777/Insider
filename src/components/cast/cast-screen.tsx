"use client";

import { RotateCcw, SkipForward } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "@/components/drill/use-reduced-motion";
import { BASEMAPS, fitView, project } from "@/components/map/basemap";
import { BuildingMarker } from "@/components/map/map-pin";
import { CityTabs, MapView, useCityTab } from "@/components/map/map-screen";
import { formatRecordedAt, recordedRunHeader, traceView } from "@/components/dossier/replay";
import { Reveal } from "@/components/dossier/reveal";
import { TraceList } from "@/components/dossier/trace-list";
import { LAYERS, LayerDot, type Layer } from "@/components/shell/layer-dot";
import { Button, buttonVariants } from "@/components/ui/button";
import { City, type CastingResult, type Mission } from "@/domain";
import { cityName } from "@/lib/cities";
import { cn } from "@/lib/utils";
import { MISSION_DISCLAIMER } from "@/components/missions/mission-list";
import { FinalistCard } from "./finalist-card";
import type { CastPinData } from "./pins";
import { castSchedule, countLeft, pinState, rowsLanded, startElapsed, type PinState } from "./replay";
import type { MassingView } from "@/components/scout/massing";
import { scoutHref } from "./scout-href";
import { ShowcaseCard } from "./showcase-card";
import type { ShowcaseCast } from "@/lib/showcase-cast";

const LAYER_ORDER = Object.keys(LAYERS) as Layer[];

export interface CastScreenProps {
  mission: Pick<Mission, "id" | "title" | "city" | "type">;
  /** The cached shortlist; the trace may come without its tool payloads. */
  result: CastingResult;
  /** Every property the search ran on, with the row it drops out at (pins.ts). */
  pins: CastPinData[];
  /** Ids of the finalists that have building pages to scout. */
  scoutable: string[];
  /** One massing view per finalist with a fixture aerial, for its card's thumbnail. */
  thumbnails?: Record<string, MassingView>;
  /**
   * The showcase kit building the mission is cast onto (issue 103), live only:
   * one of the three cards, in the second finalist's slot (issue 228), and
   * picked for "Scout it" until another is.
   */
  showcase?: ShowcaseCast | null;
  /** Start with everything shown, as Skip does. For tests. */
  startComplete?: boolean;
}

/** The notice over the trace: what this replay is, and that nothing here calls a model. */
export function castNotice(source: CastingResult["source"]): string {
  return source === "fixture"
    ? "A replay of a run recorded on fixtures. Nothing on this screen calls a model."
    : "A replay of a run cast ahead on CoStar's data. Nothing on this screen calls a model.";
}

/** A scripted run's words come from its script, not a model: its header says so. */
const isScripted = (model: string | undefined) => model?.startsWith("ScriptedChatModel") ?? false;

/**
 * The trace's header line: "Scripted run · <timestamp> · <model>" for a
 * ScriptedChatModel run (hand-written turns replayed by a scripted model),
 * else the Dossier's "Recorded replay · …".
 */
export function castRunHeader(trace: { recordedAt?: string; model?: string }): string {
  return isScripted(trace.model)
    ? ["Scripted run", formatRecordedAt(trace.recordedAt), trace.model].join(" · ")
    : recordedRunHeader(trace);
}

/** Who wrote a finalist's reason, and how: a scripted run's words are the script's, not a model's. */
export function reasonLabel(model: string | undefined): string {
  return isScripted(model) ? "Casting Director · scripted" : "Casting Director · recorded";
}

/**
 * The cast screen (`/m/[missionId]/cast`, SPEC §2 beat 2). The Casting
 * Director's recorded run replays in the side panel in about eight seconds:
 * its todos, then the funnel it narrows, each row a filter on CoStar's data
 * with its count, while the map's pins dim as each filter drops them. Then
 * three finalist cards fill under the map; picking one and "Scout it" opens
 * its Scout with the mission. Skip shows everything at once; Replay starts it
 * again; under reduced motion it starts whole.
 */
export function CastScreen({ mission, result, pins, scoutable, thumbnails = {}, showcase = null, startComplete = false }: CastScreenProps) {
  // The showcase building, when the mission has one, is the cast: picked from the start.
  const showcaseId = showcase?.id ?? null;
  const { funnel, finalists, trace } = result;
  const schedule = useMemo(() => castSchedule(trace, funnel.length), [trace, funnel.length]);
  const [clock, setElapsed] = useState(startComplete ? Number.POSITIVE_INFINITY : 0);
  const [runId, setRunId] = useState(0);
  const reducedMotion = useReducedMotion();
  // Until Replay is pressed, reduced motion (DESIGN.md: streams appear whole) starts at the end.
  const elapsed = runId === 0 ? Math.max(clock, startElapsed(startComplete, reducedMotion)) : clock;
  const [selectedId, setSelectedId] = useState<string | null>(showcaseId);
  const [city, switchCity] = useCityTab(mission.city);
  const frame = useRef<number | null>(null);
  const done = elapsed >= schedule.end;
  const cardsShown = elapsed >= schedule.cards;
  const landed = rowsLanded(schedule, elapsed);

  // The replay clock, as the dossier's: one animation frame at a time until
  // the schedule ends. Under reduced motion the first run is not played at
  // all: the screen derives its end state below, so no frame shows it hidden.
  useEffect(() => {
    if ((startComplete || reducedMotion) && runId === 0) return;
    const whole = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const start = performance.now();
    const tick = (now: number) => {
      const t = whole ? Number.POSITIVE_INFINITY : now - start;
      setElapsed(t);
      frame.current = t < schedule.end ? requestAnimationFrame(tick) : null;
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [runId, schedule.end, startComplete, reducedMotion]);

  const skip = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setElapsed(Number.POSITIVE_INFINITY);
  }, []);
  const replay = useCallback(() => {
    setSelectedId(showcaseId);
    setElapsed(0);
    setRunId((n) => n + 1);
  }, [showcaseId]);

  const view = traceView(trace, (i) => elapsed >= schedule.events[i], "casting-director");
  const control = done ? (
    <Button variant="ghost" onClick={replay} data-testid="replay">
      <RotateCcw aria-hidden />
      Replay
    </Button>
  ) : (
    <Button variant="ghost" onClick={skip} data-testid="skip">
      <SkipForward aria-hidden />
      Skip
    </Button>
  );

  // The three cards: with a showcase building, it takes the second finalist's slot (issue 228).
  const slots: ({ kind: "finalist"; candidate: (typeof finalists)[number] } | { kind: "showcase" })[] = finalists.map((c) => ({
    kind: "finalist" as const,
    candidate: c,
  }));
  if (showcase) {
    if (slots.length > 1) slots[1] = { kind: "showcase" };
    else slots.push({ kind: "showcase" });
  }
  const shownFinalists = slots.flatMap((s) => (s.kind === "finalist" ? [s.candidate] : []));
  const finalistIds = new Set(shownFinalists.map((c) => c.id));
  const selected = cardsShown ? (shownFinalists.find((c) => c.id === selectedId) ?? null) : null;
  const showcasePicked = cardsShown && showcase !== null && selectedId === showcase.id;
  // What "Scout it" acts on: the showcase building or a finalist, and whether it has pages to scout.
  const picked = showcasePicked ? showcase : selected;
  const canScout = showcasePicked || (selected !== null && scoutable.includes(selected.id));
  const inCity = pins.filter((p) => p.city === city);
  const states = new Map(inCity.map((p) => [p.id, pinState(p.outAt, landed)]));
  const left = inCity.filter((p) => states.get(p.id) === "in");
  // Every finalist in this city is on the map: the view widens past the
  // basemap when one stands beyond it. Only other properties can be off it.
  const mapView = fitView(BASEMAPS[city].bounds, shownFinalists.filter((c) => c.city === city));
  const offMap = left.filter((p) => {
    if (finalistIds.has(p.id)) return false;
    const { x, y } = project(mapView, p.lat, p.lng);
    return x < 0 || x > 1 || y < 0 || y > 1;
  }).length;
  const counts = Object.fromEntries(City.options.map((c) => [c, pins.filter((p) => p.city === c).length])) as Record<City, number>;
  const caption = [
    `${cityName(city)} · ${left.length} of ${inCity.length} left`,
    offMap > 0 ? `${offMap} beyond this map's edge` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const finalistList = (
    <ol className="mt-3 grid gap-4 md:grid-cols-3">
      {slots.map((slot, i) =>
        slot.kind === "showcase" && showcase ? (
          <li key={`showcase-${showcase.id}`} data-testid="showcase" className="min-w-0">
            <Reveal shown={cardsShown} className="h-full">
              <ShowcaseCard showcase={showcase} rank={i + 1} selected={showcasePicked} onSelect={setSelectedId} />
            </Reveal>
          </li>
        ) : slot.kind === "finalist" ? (
          <li key={slot.candidate.id} className="min-w-0">
            <Reveal shown={cardsShown} className="h-full">
              <FinalistCard
                candidate={slot.candidate}
                rank={i + 1}
                selected={slot.candidate.id === selected?.id}
                scoutable={scoutable.includes(slot.candidate.id)}
                reasonLabel={reasonLabel(trace.model)}
                thumbnail={thumbnails[slot.candidate.id]}
                onSelect={setSelectedId}
              />
            </Reveal>
          </li>
        ) : null,
      )}
    </ol>
  );

  // DOM order is reading and focus order: the mission and the run first (the
  // page's h1), then the map and the finalists, then the one action.
  return (
    <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-[minmax(0,1fr)_auto]">
      <div className="min-h-0 overflow-y-auto border-border bg-surface-1 p-4 lg:col-start-2 lg:row-start-1 lg:border-l">
        <header className="mb-4">
          <p className="label-caps text-text-3">
            Cast · {mission.type === "heist" ? "Heist" : "Prevent"} · {cityName(mission.city)}
          </p>
          <h1 className="mt-1 text-xl font-semibold text-text-1">{mission.title}</h1>
        </header>
        <TraceList
          view={view}
          header={castRunHeader(trace)}
          control={control}
          title="Casting Director"
          wrapLongParts
          expandable={false}
          banner={castNotice(result.source)}
          afterPlan={<Funnel funnel={funnel} landed={landed} source={result.source} />}
        />
      </div>
      <div className="flex min-h-0 min-w-0 flex-col lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:overflow-y-auto">
        <section
          aria-label={`Cast map: ${caption}`}
          data-testid="cast-map"
          className="relative h-80 shrink-0 overflow-hidden bg-surface-0 lg:h-auto lg:min-h-[240px] lg:flex-1"
        >
          <div role="tabpanel" id="city-panel" aria-labelledby={`tab-${city}`} className="absolute inset-0">
            <MapView
              city={city}
              buildings={inCity}
              caption={caption}
              view={mapView}
              pin={(p, x, y) => (
                <CastPin
                  pin={p}
                  x={x}
                  y={y}
                  state={states.get(p.id) ?? "in"}
                  finalist={cardsShown && finalistIds.has(p.id)}
                  selected={p.id === selected?.id}
                />
              )}
            />
          </div>
          {/* Top right beside the caption; on a phone, under the caption, which wraps there. */}
          <div className="absolute top-16 left-3 w-60 md:top-3 md:right-3 md:left-auto md:w-64">
            <CityTabs city={city} onChange={switchCity} counts={counts} />
          </div>
        </section>

        <section
          aria-labelledby="finalists-title"
          data-testid="finalists"
          data-shown={cardsShown}
          className="shrink-0 border-t border-border bg-surface-1 px-4 pt-3 pb-4 md:px-6"
        >
          <h2 id="finalists-title" className="label-caps text-text-3">
            Three finalists · pick one to scout
          </h2>
          {finalistList}
          {/* SPEC §1, taste rules: the reasons speak of locks and cameras, so the mission cards' line stands here too. */}
          <p data-testid="cast-disclaimer" className="mt-3 text-sm text-text-2">
            {MISSION_DISCLAIMER}
          </p>
        </section>
      </div>

      <div className="flex flex-col gap-2 border-t border-border bg-surface-1 p-4 lg:col-start-2 lg:row-start-2 lg:border-l [&>*]:w-full">
        <p id="selection" data-testid="selection" aria-live="polite" className="text-sm text-text-2">
          {picked ? (
            canScout ? (
              <>
                <span className="text-text-1">{picked.name}</span>, {picked.neighbourhood}
              </>
            ) : (
              <>
                <span className="label-caps text-text-3">Level in prep</span>{" "}
                <span className="text-text-1">{picked.name}</span> has no floor yet. Pick another finalist.
              </>
            )
          ) : cardsShown ? (
            "Pick a finalist to scout."
          ) : (
            "Replaying the Casting Director's run."
          )}
        </p>
        {picked && canScout ? (
          <Link href={scoutHref(picked.id, mission.id)} className={buttonVariants({ variant: "primary" })}>
            Scout it
          </Link>
        ) : (
          // Focusable, and it says why it is off: the line above (the map's "level in prep" pattern).
          <Button variant="primary" aria-disabled="true" aria-describedby="selection" data-testid="scout-off">
            Scout it
          </Button>
        )}
      </div>
    </div>
  );
}

interface FunnelProps {
  funnel: CastingResult["funnel"];
  /** How many rows have landed. */
  landed: number;
  source: CastingResult["source"];
}

/**
 * The funnel the agent narrows (SPEC §2 beat 2): one row per filter on
 * CoStar's data with the count left, each with a bar against the whole
 * inventory. Rows land in order; the count beside the title counts down with
 * them. Every row is laid out from the start, so nothing below moves.
 */
function Funnel({ funnel, landed, source }: FunnelProps) {
  const total = funnel[0].count;
  const left = countLeft(funnel, landed);
  return (
    <section aria-labelledby="funnel-title" data-testid="funnel">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="funnel-title" className="flex items-center gap-2 label-caps text-text-3">
          <LayerDot layer="costar" decorative />
          Funnel · CoStar {source === "fixture" ? "· fixtures" : "data kit"}
        </h3>
        <p className="font-mono text-sm text-text-1 tabular-nums" data-testid="funnel-left">
          {left === null ? "—" : `${left} left`}
        </p>
      </div>
      <ol aria-label="Funnel" className="mt-2 flex flex-col">
        {funnel.map((row, i) => (
          <li key={row.label} data-testid="funnel-row" data-shown={i < landed} className="py-1">
            <Reveal shown={i < landed} skeleton="bar">
              <span className="flex items-baseline justify-between gap-3 text-sm">
                <span className={i === 0 ? "text-text-2" : "text-text-1"}>{row.label}</span>
                <span data-testid="funnel-count" className="shrink-0 font-mono text-text-1 tabular-nums">
                  {row.count}
                </span>
              </span>
              <span aria-hidden className="mt-1 block h-1 overflow-hidden rounded-sm bg-surface-3">
                <span
                  className={cn("block h-full", i === funnel.length - 1 ? "bg-text-1" : "bg-n-500")}
                  style={{ width: `${total > 0 ? (row.count / total) * 100 : 0}%` }}
                />
              </span>
            </Reveal>
          </li>
        ))}
      </ol>
    </section>
  );
}

interface CastPinProps {
  pin: CastPinData;
  x: number;
  y: number;
  state: PinState;
  /** Shown once the cards are: a finalist is labelled with its name. */
  finalist: boolean;
  selected: boolean;
}

/**
 * One property on the cast map: the map pin's 12px disc and three layer dots
 * while it is still in, a dimmed point once a filter drops it. Display only:
 * the caption and the finalist cards carry what it says, for every reader.
 */
function CastPin({ pin, x, y, state, finalist, selected }: CastPinProps) {
  const out = state === "out";
  return (
    <div
      aria-hidden
      data-testid="cast-pin"
      data-building={pin.id}
      data-state={state}
      data-finalist={finalist || undefined}
      data-selected={selected || undefined}
      className={cn("pointer-events-none absolute size-0", out ? "z-0" : finalist ? "z-20" : "z-10")}
      style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
    >
      {out ? (
        <span className="absolute top-0 left-0 block size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-n-600 opacity-60 ring-2 ring-surface-0 transition-opacity duration-slow" />
      ) : (
        // Still in: a little building marks the property.
        <BuildingMarker size="sm" tone={selected ? "selected" : "default"} className="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2" />
      )}
      {finalist && !out ? (
        <span
          className={cn(
            "absolute top-0 left-0 block size-8 -translate-x-1/2 -translate-y-1/2 rounded-[7px] border",
            selected ? "border-accent" : "border-text-2",
          )}
        />
      ) : null}
      <span
        className={cn(
          "absolute top-[14px] left-0 flex -translate-x-1/2 gap-0.5 transition-opacity duration-slow",
          out ? "opacity-0" : "opacity-100",
        )}
      >
        {LAYER_ORDER.map((layer) => (
          <LayerDot key={layer} layer={layer} absent={!pin.layers[layer]} decorative />
        ))}
      </span>
      {finalist && !out ? (
        <span
          className={cn(
            "absolute top-0 -translate-y-1/2 rounded-sm bg-surface-0/80 px-1.5 text-xs font-medium whitespace-nowrap",
            // Near the right edge the name sits left of the pin, so it stays on the map.
            x > 0.7 ? "right-5" : "left-5",
            selected ? "text-accent" : "text-text-1",
          )}
        >
          {pin.name}
        </span>
      ) : null}
    </div>
  );
}
