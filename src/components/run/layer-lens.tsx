"use client";

// The Layer lens's controls and marks (#33): the toggle in the board's top
// bar, its `L` key, the legend under the board, and the letter marks the board
// draws beside a tinted element. What each element carries comes from lens.ts.
import { Layers } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PlacedLevel } from "@/level/placer";
import { cn } from "@/lib/utils";
import { round, type Point } from "./iso";
import { describeKinds, layerCounts, lensElements, LENS_LABEL, LENS_MARK, type LensLayer } from "./lens";

export const LENS_COLOUR: Readonly<Record<LensLayer, string>> = {
  costar: "var(--layer-costar)",
  vexcel: "var(--layer-vexcel)",
  matterport: "var(--layer-matterport)",
};

/**
 * The lens's on/off state, toggled by the button and by `L`. The key is left
 * alone in a text field, with a modifier held, and on auto-repeat, so typing
 * an order on the Plan screen never flips it.
 */
export function useLayerLens(): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const toggle = useCallback(() => setOn((was) => !was), []);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "l" && event.key !== "L") return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true], [contenteditable='']")) return;
      event.preventDefault();
      toggle();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);
  return [on, toggle];
}

/** The lens's button in the board's top bar: its pressed state is exposed, and it names its key. */
export function LensToggle({ on, onToggle, disabled }: { on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      data-testid="lens-toggle"
      aria-pressed={on}
      aria-keyshortcuts="L"
      // A click must not leave focus here: Space on a focused button presses it, and on Run Space takes the files.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        "inline-flex h-10 shrink-0 items-center gap-2 rounded-sm border px-3 text-sm font-medium select-none",
        "transition-colors duration-fast ease-out disabled:pointer-events-none disabled:opacity-50",
        "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.5]",
        on
          ? "border-border-strong bg-surface-3 text-text-1"
          : "border-transparent text-text-2 hover:bg-surface-3 hover:text-text-1",
      )}
    >
      <Layers aria-hidden />
      {/* On a phone the top bar is narrow: the icon stays, the name stays for screen readers. */}
      <span className="max-md:sr-only">Layer lens</span>
      <kbd
        aria-hidden
        className="max-md:hidden inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-surface-2 px-1 font-mono text-xs text-text-2"
      >
        L
      </kbd>
    </button>
  );
}

/**
 * The legend, a strip under the board so it never covers a piece: each
 * layer's mark, name and count, and what it counted, in words. It counts the
 * same elements the board tints (`lensElements` on the same placement and
 * locked doors), so an element with two layers is in two columns. The floor's
 * source says whether the rooms came from the scan.
 */
export function LensLegend({ placed, locked }: { placed: PlacedLevel; locked: readonly string[] }) {
  const { layers, unsourced } = useMemo(() => layerCounts(lensElements(placed, locked)), [placed, locked]);
  const fixtureFloor = placed.level.floor.source === "fixture";
  return (
    <section
      data-testid="lens-legend"
      aria-label="Layer lens legend"
      className="shrink-0 border-t border-border px-6 py-3"
    >
      <ul className="flex flex-wrap gap-x-6 gap-y-2 md:gap-x-10">
        {layers.map((count) => (
          <li
            key={count.layer}
            data-testid="lens-legend-row"
            data-layer={count.layer}
            data-count={count.total}
            className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3"
          >
            <LegendSwatch layer={count.layer} />
            <span className="min-w-0">
              <span className="flex items-baseline gap-2 text-sm">
                <span className="font-medium text-text-1">{LENS_LABEL[count.layer]}</span>
                <span className="font-mono text-text-1 tabular-nums">{count.total}</span>
              </span>
              <span className="block text-xs text-text-2 max-md:hidden">
                {describeKinds(count)}
                {count.layer === "matterport" && fixtureFloor ? ", fixture floor" : null}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {unsourced > 0 ? (
        <p data-testid="lens-unsourced" className="mt-2 text-xs text-text-2">
          {unsourced} {unsourced === 1 ? "piece is" : "pieces are"} game fiction, from no data layer.
        </p>
      ) : null}
    </section>
  );
}

/** A row's swatch: the letter mark the board draws, over the pattern its rooms take. */
function LegendSwatch({ layer }: { layer: LensLayer }) {
  return (
    <svg aria-hidden width="36" height="20" viewBox="0 0 36 20" className="mt-0.5 shrink-0">
      <defs>
        <RoomPattern id={`legend-${layer}`} layer={layer} />
      </defs>
      <rect x="0.5" y="2.5" width="15" height="15" rx="2" style={roomStyle(layer, `legend-${layer}`)} />
      <LayerMarks layers={[layer]} at={{ x: 20, y: 3 }} />
    </svg>
  );
}

/**
 * How a room tile carries a layer, so rooms differ by more than hue: the
 * Matterport tile by a solid outline, a CoStar zone by a hatch rising to the
 * right, a Vexcel zone by a hatch falling to the right.
 */
export function RoomPattern({ id, layer }: { id: string; layer: LensLayer }) {
  if (layer === "matterport") return null;
  return (
    <pattern
      id={id}
      width="10"
      height="10"
      patternUnits="userSpaceOnUse"
      patternTransform={`rotate(${layer === "costar" ? -45 : 45})`}
    >
      <line x1="0" y1="0" x2="0" y2="10" style={{ stroke: LENS_COLOUR[layer] }} strokeWidth="1.5" strokeOpacity="0.4" />
    </pattern>
  );
}

/** The fill and stroke a room face takes for one layer: a hatch, or the Matterport outline. */
export function roomStyle(layer: LensLayer, patternId: string) {
  return layer === "matterport"
    ? { fill: "none", stroke: LENS_COLOUR.matterport, strokeWidth: 1.5 }
    : { fill: `url(#${patternId})`, stroke: "none" };
}

/** A letter mark's size, in board units. */
export const MARK = { w: 14, h: 14, gap: 3 } as const;

/** The width a row of marks takes. */
export function marksWidth(count: number): number {
  return count * MARK.w + Math.max(0, count - 1) * MARK.gap;
}

/**
 * An element's letter marks, side by side from `at` (their top-left): one
 * outlined chip per layer, the layer's letter in its colour, so a layer reads
 * without its hue.
 */
export function LayerMarks({ layers, at }: { layers: readonly LensLayer[]; at: Point }) {
  return (
    <g data-testid="lens-marks">
      {layers.map((layer, i) => {
        const x = round(at.x + i * (MARK.w + MARK.gap));
        return (
          <g key={layer} data-testid="lens-mark" data-layer={layer} transform={`translate(${x}, ${round(at.y)})`}>
            <rect
              x="0.75"
              y="0.75"
              width={MARK.w - 1.5}
              height={MARK.h - 1.5}
              rx="3"
              style={{ fill: "var(--n-950)", stroke: LENS_COLOUR[layer] }}
              strokeWidth="1.5"
            />
            <text
              x={MARK.w / 2}
              y={MARK.h / 2 + 0.5}
              textAnchor="middle"
              dominantBaseline="middle"
              className="font-mono"
              fontSize="10"
              fontWeight="600"
              style={{ fill: LENS_COLOUR[layer] }}
            >
              {LENS_MARK[layer]}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/**
 * Rings around a piece's base, one per layer, the inner one solid and any
 * outer one dashed, so two layers read as two rings.
 */
export function LayerRings({ layers, rx, ry }: { layers: readonly LensLayer[]; rx: number; ry: number }) {
  return (
    <g aria-hidden>
      {layers.map((layer, i) => (
        <ellipse
          key={layer}
          data-testid="lens-ring"
          data-layer={layer}
          cx="0"
          cy="0"
          rx={rx + i * 5}
          ry={ry + i * 2.5}
          fill="none"
          style={{ stroke: LENS_COLOUR[layer] }}
          strokeWidth="2"
          strokeDasharray={i === 0 ? undefined : "4 3"}
        />
      ))}
    </g>
  );
}
