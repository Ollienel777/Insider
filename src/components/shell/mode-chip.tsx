import type { ModeChip as ModeChipState } from "@/lib/mode";

/** The tooltip's text: which services are on fixtures, or that none are. */
export function modeTooltip(chip: ModeChipState): string {
  return chip.onFixtures.length > 0 ? `On fixtures: ${chip.onFixtures.join(", ")}` : "All services live";
}

/**
 * The top bar's mode chip (DESIGN.md, Layout): `FIXTURES` in mono `--text-2`,
 * or `LIVE` with a 6px success dot. Hover or focus shows which services are
 * on fixtures. The chip is the only pill in the product.
 */
export function ModeChip({ chip }: { chip: ModeChipState }) {
  const tooltip = modeTooltip(chip);
  return (
    <span className="group relative inline-flex">
      {/* A 40px hit target around a 24px pill, so the tooltip is reachable by
          keyboard and by a mouse that misses by a few pixels. */}
      <button
        type="button"
        data-testid="mode-chip"
        aria-describedby="mode-chip-tooltip"
        className="inline-flex h-10 items-center rounded-sm px-1"
      >
        <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 label-caps text-text-2 transition-colors duration-fast group-hover:border-border-strong">
          {chip.label === "LIVE" ? <span aria-hidden className="size-1.5 rounded-full bg-success" /> : null}
          {chip.label}
        </span>
      </button>
      <span
        id="mode-chip-tooltip"
        role="tooltip"
        className="pointer-events-none invisible absolute top-full right-0 z-50 mt-1 w-max max-w-64 rounded-sm border border-border bg-surface-2 px-3 py-2 text-xs text-text-1 opacity-0 shadow-e-2 transition-opacity duration-fast group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        {tooltip}
      </span>
    </span>
  );
}
