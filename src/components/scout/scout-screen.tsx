"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { BuildingScreen } from "@/components/shell/building-screen";
import { buildingHref } from "@/lib/building-href";
import { useMissionId } from "@/lib/use-mission-id";
import { LayerDot } from "@/components/shell/layer-dot";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Aerial, type AerialEntry, type Building, type ViewDir } from "@/domain";
import { cityName } from "@/lib/cities";
import { fallbackOf } from "@/lib/fallback";
import { noteResponse, reportLive } from "@/lib/demo-status";
import { cn } from "@/lib/utils";
import {
  buildImageViews,
  buildMassing,
  entryFace,
  FRAME,
  VIEW_LABEL,
  VIEW_ORDER,
  type ImageView,
  type Marker,
  type MassingView,
} from "./massing";
import { MassingSvg } from "./massing-view";

export type ScoutBuilding = Pick<
  Building,
  "id" | "name" | "city" | "neighbourhood" | "yearBuilt" | "buildingClass" | "stories"
>;

export type Load =
  | { status: "loading" }
  /** `failed`: the live views whose photo didn't load in the browser. */
  | { status: "ready"; aerial: Aerial; live: boolean; failed?: readonly ViewDir[] }
  | { status: "error"; message: string };

/** What a live photo's alt text calls each view. */
const PHOTO_ALT: Record<ViewDir, string> = {
  N: "Vexcel aerial, north face",
  E: "Vexcel aerial, east face",
  S: "Vexcel aerial, south face",
  W: "Vexcel aerial, west face",
  ortho: "Vexcel aerial, straight down",
};

/**
 * The canvas's views: live imagery as photos, a fixture aerial as the massing
 * render. When every photo has failed to load, the massing is drawn instead,
 * so the Scout never shows only blank frames.
 */
export function scoutViews(aerial: Aerial, stories: number, failed: readonly ViewDir[] = []): CanvasView[] {
  const photos = buildImageViews(aerial);
  if (photos.length > 0 && !photos.every((v) => failed.includes(v.dir))) {
    return photos.map((v) => ({ kind: "image", ...v }));
  }
  return buildMassing(aerial, stories).map((v) => ({ kind: "massing", ...v }));
}

/** Horizontal drag, in CSS pixels, that turns the view one step. */
const DRAG_STEP = 72;

/**
 * The Scout screen (SPEC §2 beat 2, DESIGN.md Scout): the building from the
 * air, turned with ← →, a drag or the direction chips, with its tagged ways
 * in as markers; the panel holds the CoStar facts, the entries and the
 * selected entry's note, and "Plan the job".
 */
export function ScoutScreen({ building, initialLoad }: { building: ScoutBuilding; initialLoad?: Load }) {
  // `initialLoad` is for tests: the state the screen renders before any fetch.
  const [load, setLoad] = useState<Load>(initialLoad ?? { status: "loading" });
  const [attempt, setAttempt] = useState(0);
  // `null` until the presenter picks one: then the default view is used.
  const [chosen, setView] = useState<ViewDir | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const missionId = useMissionId();

  useEffect(() => {
    const controller = new AbortController();
    fetchAerial(building.id, controller.signal).then(
      (result) => setLoad(result),
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({ status: "error", message: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => controller.abort();
  }, [building.id, attempt]);

  const views = useMemo<CanvasView[] | null>(
    () => (load.status === "ready" ? scoutViews(load.aerial, building.stories, load.failed) : null),
    [load, building.stories],
  );
  const ready = load.status === "ready";
  // Live Vexcel may lack a direction; the chips, keys and drag skip it.
  const available = useMemo(() => (views ? VIEW_ORDER.filter((d) => views.some((v) => v.dir === d)) : VIEW_ORDER), [views]);
  // Live photos open straight down, where the entries are pinned; the massing on its north face.
  const opening = views?.[0]?.kind === "image" && available.includes("ortho") ? "ortho" : available[0];
  const view = chosen && available.includes(chosen) ? chosen : opening;

  const turn = useCallback(
    (by: 1 | -1) => {
      const i = Math.max(0, available.indexOf(view));
      setView(available[(i + by + available.length) % available.length]);
    },
    [available, view],
  );

  const photoFailed = useCallback((dir: ViewDir) => {
    setLoad((l) => (l.status === "ready" && !l.failed?.includes(dir) ? { ...l, failed: [...(l.failed ?? []), dir] } : l));
  }, []);

  useEffect(() => {
    if (!ready) return;
    function onKey(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        turn(event.key === "ArrowRight" ? 1 : -1);
      } else if (event.key === "Escape") {
        setSelectedId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, turn]);

  const entries = load.status === "ready" ? load.aerial.entries : [];
  const selected = entries.find((e) => e.id === selectedId) ?? null;

  const retry = useCallback(() => {
    setLoad({ status: "loading" });
    setAttempt((a) => a + 1);
  }, []);

  function pickEntry(entry: AerialEntry) {
    setSelectedId(entry.id);
    setView(entry.view);
  }

  return (
    <BuildingScreen
      visualLabel="Aerial view"
      visual={
        <div className="absolute inset-0 flex flex-col">
          <div className="flex h-14 shrink-0 items-center gap-3 px-6">
            <span className="flex items-center gap-2 label-caps text-text-2">
              <LayerDot layer="vexcel" decorative />
              {load.status === "ready" && load.live && views?.[0]?.kind === "image" ? "Vexcel · aerial" : <>Vexcel · massing<span className="max-md:hidden"> from fixtures</span></>}
            </span>
            <span aria-hidden className="h-4 w-px bg-border" />
            <span data-testid="view-caption" aria-live="polite" className="text-sm text-text-1">
              {VIEW_LABEL[view].caption}
            </span>
          </div>

          <FrameArea>
            {load.status === "loading" ? (
              <Skeleton data-testid="aerial-skeleton" className="absolute inset-0 rounded-md bg-surface-1" />
            ) : load.status === "error" ? (
              <AerialError message={load.message} onRetry={retry} />
            ) : (
              <AerialCanvas
                views={views!}
                current={view}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onTurn={turn}
                onPhotoFailed={photoFailed}
              />
            )}
          </FrameArea>

          <div className="flex h-16 shrink-0 items-center justify-between gap-4 px-6">
            <div role="group" aria-label="Viewpoint" className="flex items-center gap-1">
              {VIEW_ORDER.map((dir) => (
                <ViewChip
                  key={dir}
                  dir={dir}
                  active={dir === view}
                  disabled={!ready || !available.includes(dir)}
                  onClick={() => setView(dir)}
                  className={dir === "ortho" ? "ml-3" : undefined}
                />
              ))}
            </div>
            <p className="flex items-center gap-2 text-sm text-text-2 max-md:hidden">
              <Kbd>←</Kbd>
              <Kbd>→</Kbd>
              <span>or drag to turn</span>
            </p>
          </div>
        </div>
      }
      panel={
        <ScoutPanel
          building={building}
          load={load}
          selected={selected}
          onPick={pickEntry}
          onRetry={retry}
        />
      }
      action={
        <Link href={buildingHref(building.id, "dossier", missionId)} className={buttonVariants({ variant: "primary" })}>
          Plan the job
        </Link>
      }
    />
  );
}

/** Fetches the aerial, and tells the mode chip of any `fallback` the answer carries. */
export async function fetchAerial(id: string, signal: AbortSignal): Promise<Load> {
  const response = await fetch(`/api/buildings/${encodeURIComponent(id)}/aerial`, { signal });
  const body = (await response.json().catch(() => null)) as { mode?: string; aerial?: unknown; error?: string } | null;
  if (body) noteResponse(body);
  if (!response.ok || !body) {
    return { status: "error", message: body?.error ?? `The aerial service answered ${response.status}.` };
  }
  const parsed = Aerial.safeParse(body.aerial);
  if (!parsed.success) return { status: "error", message: "The aerial came back in a shape the Scout can't draw." };
  // Live only when the photos came back: a building Vexcel has no coverage for is drawn as its massing.
  const live = body.mode === "live" && parsed.data.source === "vexcel";
  // An earlier building's massing switched the chip to fixtures; these photos switch it back.
  if (live && !fallbackOf(body)) reportLive("vexcel");
  return { status: "ready", aerial: parsed.data, live };
}

/**
 * The box every state of the aerial sits in: the largest 16:10 rectangle that
 * fits the visual area. The skeleton, the error and the render all fill it,
 * so nothing moves when the aerial arrives.
 */
function FrameArea({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-0 flex-1 px-6 [container-type:size]">
      <div
        data-testid="aerial-frame"
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{
          width: `min(calc(100cqw - 48px), calc(100cqh * ${FRAME.width / FRAME.height}))`,
          aspectRatio: `${FRAME.width} / ${FRAME.height}`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** One view on the canvas: a live photo, or the fixture massing's render. */
type CanvasView = ({ kind: "image" } & ImageView) | ({ kind: "massing" } & MassingView);

/**
 * A live Vexcel image, fitted whole into the frame. It is fetched through the
 * image route and drawn with a plain <img>: next/image's optimiser would
 * write a copy to disk, and the imagery is never stored (SPEC §10).
 */
function AerialPhoto({ view, onFailed }: { view: ImageView; onFailed: (dir: ViewDir) => void }) {
  const [failed, setFailed] = useState(false);
  const { box } = view;
  return (
    <div
      data-testid="aerial-photo"
      className="absolute overflow-hidden rounded-md bg-surface-1"
      style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }}
    >
      {failed ? (
        <p className="flex size-full items-center justify-center text-sm text-text-2">This view didn&apos;t load.</p>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- see above: no optimiser, no copy on disk
        <img
          src={view.url}
          alt={PHOTO_ALT[view.dir]}
          draggable={false}
          decoding="async"
          onError={() => {
            setFailed(true);
            onFailed(view.dir);
          }}
          className="size-full object-cover"
        />
      )}
    </div>
  );
}

interface CanvasProps {
  views: CanvasView[];
  current: ViewDir;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onTurn: (by: 1 | -1) => void;
  onPhotoFailed: (dir: ViewDir) => void;
}

/**
 * The five views stacked; the current one is opaque and the rest are
 * transparent and inert, so changing view is a `--t-base` cross-fade (instant
 * under reduced motion, by the global rule in globals.css).
 */
function AerialCanvas({ views, current, selectedId, onSelect, onTurn, onPhotoFailed }: CanvasProps) {
  const drag = useRef<{ id: number; x: number } | null>(null);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    drag.current = { id: event.pointerId, x: event.clientX };
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    const dx = event.clientX - d.x;
    if (Math.abs(dx) < DRAG_STEP) return;
    // Dragging the scene left brings the next side round, like turning a model.
    onTurn(dx < 0 ? 1 : -1);
    drag.current = { id: d.id, x: event.clientX };
  }
  function endDrag() {
    drag.current = null;
  }

  return (
    <div
      data-testid="aerial-canvas"
      data-view={current}
      className="absolute inset-0 cursor-grab touch-pan-y select-none active:cursor-grabbing"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={endDrag}
    >
      {views.map((v) => {
        const active = v.dir === current;
        return (
          <div
            key={v.dir}
            data-testid="aerial-view"
            data-dir={v.dir}
            data-active={active}
            aria-hidden={!active}
            inert={!active}
            className={cn(
              "absolute inset-0 transition-opacity duration-base ease-out",
              active ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            {v.kind === "image" ? <AerialPhoto view={v} onFailed={onPhotoFailed} /> : <MassingSvg view={v} />}
            <Leaders markers={v.markers} selectedId={selectedId} />
            {v.markers.map((marker) => (
              <EntryMarker
                key={marker.entry.id}
                marker={marker}
                selected={marker.entry.id === selectedId}
                onSelect={onSelect}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** The leaders from each marker's ring to its label, in frame units. */
function Leaders({ markers, selectedId }: { markers: Marker[]; selectedId: string | null }) {
  return (
    <svg
      viewBox={`0 0 ${FRAME.width} ${FRAME.height}`}
      preserveAspectRatio="none"
      aria-hidden
      className="pointer-events-none absolute inset-0 size-full"
    >
      {markers.map(({ entry, x, y, labelX, labelY, facing }) => {
        const [x1, y1, x2, y2] = [x * FRAME.width, y * FRAME.height, labelX * FRAME.width, labelY * FRAME.height];
        const len = Math.hypot(x2 - x1, y2 - y1) || 1;
        // Start at the ring's edge, not its centre.
        const r = Math.min(20, len);
        const selected = entry.id === selectedId;
        return (
          <line
            key={entry.id}
            data-testid="entry-leader"
            x1={x1 + ((x2 - x1) / len) * r}
            y1={y1 + ((y2 - y1) / len) * r}
            x2={x2}
            y2={y2}
            vectorEffect="non-scaling-stroke"
            strokeWidth="1"
            strokeDasharray={facing ? undefined : "3 3"}
            style={{ stroke: selected ? "var(--accent)" : facing ? "var(--n-400)" : "var(--n-600)" }}
          />
        );
      })}
    </svg>
  );
}

/**
 * A tagged entry (DESIGN.md Scout): a 24px accent ring in a 40px hit target,
 * and its mono label as a callout clear of the building. An entry on a face
 * turned away from this view keeps its place but is drawn dashed and dimmer,
 * so the judge sees it is round the back.
 */
function EntryMarker({ marker, selected, onSelect }: { marker: Marker; selected: boolean; onSelect: (id: string) => void }) {
  const { entry, x, y, facing, side, labelX, labelY } = marker;
  return (
    <>
      <button
        type="button"
        data-testid="entry-marker"
        data-entry={entry.id}
        data-facing={facing}
        aria-pressed={selected}
        aria-label={facing ? entry.label : `${entry.label}, far side`}
        onClick={() => onSelect(entry.id)}
        onPointerDown={(e) => e.stopPropagation()}
        className={cn(
          "group absolute flex size-10 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm",
          selected ? "z-20" : facing ? "z-10" : "z-0",
        )}
        style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
      >
        <span
          aria-hidden
          className={cn(
            "flex size-6 items-center justify-center rounded-full border-2 transition-colors duration-fast",
            selected
              ? "border-accent bg-accent-wash"
              : facing
                ? "border-accent bg-surface-0/60 group-hover:bg-accent-wash"
                : "border-dashed border-accent/60 bg-surface-0/40 group-hover:border-accent",
          )}
        >
          {selected ? <span className="size-2 rounded-full bg-accent" /> : null}
        </span>
      </button>
      <span
        aria-hidden
        data-testid="entry-label"
        data-entry={entry.id}
        onClick={() => onSelect(entry.id)}
        onPointerDown={(e) => e.stopPropagation()}
        className={cn(
          "absolute -translate-y-1/2 cursor-pointer whitespace-nowrap rounded-sm border px-2 py-1 font-mono text-xs transition-colors duration-fast",
          side === "left" && "-translate-x-full",
          selected
            ? "z-20 border-accent bg-surface-1 text-text-1"
            : facing
              ? "z-10 border-border bg-surface-1 text-text-1 hover:border-border-strong"
              : "z-0 border-border bg-surface-1 text-text-2 hover:text-text-1",
        )}
        style={{ left: `${labelX * 100}%`, top: `${labelY * 100}%` }}
      >
        {entry.label}
      </span>
    </>
  );
}

function ViewChip({
  dir,
  active,
  disabled,
  onClick,
  className,
}: {
  dir: ViewDir;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-testid="view-chip"
      data-dir={dir}
      aria-pressed={active}
      title={VIEW_LABEL[dir].caption}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative inline-flex h-10 min-w-10 items-center justify-center rounded-sm border px-3 font-mono text-xs transition-colors duration-fast",
        "disabled:pointer-events-none disabled:opacity-50",
        active
          ? "border-accent bg-surface-2 text-text-1"
          : "border-border bg-surface-1 text-text-2 hover:border-border-strong hover:bg-surface-3 hover:text-text-1",
        className,
      )}
    >
      {VIEW_LABEL[dir].chip}
    </button>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex size-6 items-center justify-center rounded-sm border border-border bg-surface-2 font-mono text-xs text-text-1">
      {children}
    </kbd>
  );
}

function AerialError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      data-testid="aerial-error"
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-md border border-border bg-surface-1 p-6 text-center"
    >
      <p className="label-caps text-danger">Vexcel didn&apos;t answer</p>
      <p className="text-lg font-semibold text-text-1">The aerial couldn&apos;t load.</p>
      <p className="max-w-md font-mono text-sm break-words text-text-2">{message}</p>
      <Button variant="secondary" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

interface PanelProps {
  building: ScoutBuilding;
  load: Load;
  selected: AerialEntry | null;
  onPick: (entry: AerialEntry) => void;
  onRetry: () => void;
}

/**
 * The side panel. Every Vexcel-backed slot has three states: a skeleton while
 * the aerial loads, its value when it lands, and, when it fails, a plain
 * "not loaded" with a Retry beside the entries, so nothing shimmers forever.
 */
export function ScoutPanel({ building, load, selected, onPick, onRetry }: PanelProps) {
  const aerial = load.status === "ready" ? load.aerial : null;
  const facts: { term: string; value: ReactNode; layer: "costar" | "vexcel" }[] = [
    { term: "Built", value: building.yearBuilt, layer: "costar" },
    { term: "Class", value: building.buildingClass, layer: "costar" },
    { term: "Stories", value: building.stories, layer: "costar" },
    {
      term: "Height",
      value: aerial ? (
        `${Math.round(aerial.heightM)} m`
      ) : load.status === "error" ? (
        <span data-testid="height-unavailable" className="text-text-3">
          <span aria-hidden>—</span>
          <span className="sr-only">Not loaded</span>
        </span>
      ) : (
        <Skeleton data-testid="height-skeleton" className="mt-1 h-4 w-12" />
      ),
      layer: "vexcel",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="label-caps text-text-3">Scout</p>
        <h1 className="text-2xl font-semibold text-text-1">{building.name}</h1>
        <p className="text-sm text-text-2">
          {building.neighbourhood}, {cityName(building.city)}
        </p>
      </div>

      <dl data-testid="scout-facts" className="grid grid-cols-4 gap-2">
        {facts.map(({ term, value, layer }) => (
          <div key={term} className="rounded-sm border border-border bg-surface-2 px-3 py-2">
            <dt className="flex items-center gap-1.5 label-caps text-text-3">
              <LayerDot layer={layer} />
              {term}
            </dt>
            <dd className="h-5 font-mono text-sm text-text-1">{value}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="ways-in" className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 id="ways-in" className="label-caps text-text-3">
            Ways in
          </h2>
          <span className="flex items-center gap-1.5 label-caps text-text-3">
            <LayerDot layer="vexcel" decorative />
            {aerial ? `${aerial.entries.length} tagged` : load.status === "error" ? "Not loaded" : "Tagging"}
          </span>
        </div>
        {load.status === "loading" ? (
          <ul aria-busy="true" aria-label="Loading entries" className="-mx-4 flex flex-col">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} data-testid="entry-row-skeleton" className="flex h-11 items-center gap-3 px-4">
                <Skeleton className="size-3 rounded-full" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="ml-auto h-3 w-16" />
              </li>
            ))}
          </ul>
        ) : load.status === "error" ? (
          <div data-testid="entries-error" className="flex flex-col items-start gap-3 rounded-md border border-border bg-surface-2 p-4">
            <p className="text-sm text-text-2">The entries come with the aerial. Retry it to tag them.</p>
            <Button variant="secondary" onClick={onRetry}>
              Retry
            </Button>
          </div>
        ) : aerial!.entries.length === 0 ? (
          <p className="text-sm text-text-2">The aerial tags no entries on this building.</p>
        ) : (
          <ul aria-label="Tagged entries" className="-mx-4 flex flex-col">
            {aerial!.entries.map((entry) => (
              <li key={entry.id}>
                <EntryRow
                  entry={entry}
                  face={entryFace(entry, aerial!.heightM, aerial!.footprint)}
                  selected={entry.id === selected?.id}
                  onPick={onPick}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <div data-testid="entry-note" aria-live="polite" className="min-h-28 rounded-md border border-border bg-surface-2 p-4">
        {selected && aerial ? (
          <>
            <p className="label-caps text-text-3">
              {selected.label} · {entryFace(selected, aerial.heightM, aerial.footprint)}
            </p>
            <p className="mt-2 text-base text-text-1">{selected.note}</p>
          </>
        ) : (
          <p className="text-sm text-text-2">Pick a marker or an entry to read what the aerial shows there.</p>
        )}
      </div>
    </div>
  );
}

function EntryRow({
  entry,
  face,
  selected,
  onPick,
}: {
  entry: AerialEntry;
  face: string;
  selected: boolean;
  onPick: (entry: AerialEntry) => void;
}) {
  return (
    <button
      type="button"
      data-testid="entry-row"
      data-entry={entry.id}
      aria-pressed={selected}
      onClick={() => onPick(entry)}
      className={cn(
        "relative flex h-11 w-full items-center gap-3 px-4 text-left transition-colors duration-fast hover:bg-surface-3",
        selected &&
          "bg-accent-wash before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent hover:bg-accent-wash",
      )}
    >
      <span aria-hidden className={cn("size-3 rounded-full border-2 border-accent", selected && "bg-accent")} />
      <span className="flex-1 truncate text-sm font-medium text-text-1">{entry.label}</span>
      <span className="label-caps text-text-3">{face}</span>
    </button>
  );
}
