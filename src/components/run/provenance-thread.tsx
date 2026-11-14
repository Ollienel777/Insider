import type { Point } from "./iso";

/**
 * The provenance thread (DESIGN.md "The signature element"): a 1px line in
 * the element's layer colour from the piece to the Why card, drawn over
 * `--t-slow`. Under `prefers-reduced-motion` it appears whole. It is drawn in
 * the board's CSS pixels, over the board, and takes no pointer events.
 */
export function ProvenanceThread({ from, to, colour, drawKey }: { from: Point; to: Point; colour: string; drawKey: string }) {
  return (
    <svg aria-hidden data-testid="provenance-thread" data-colour={colour} className="pointer-events-none absolute inset-0 size-full overflow-visible">
      <circle cx={from.x} cy={from.y} r="3" style={{ fill: colour }} />
      <line
        // A new element per selection, so the line draws again for each one.
        key={drawKey}
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        pathLength={1}
        strokeDasharray="1"
        strokeWidth="1"
        className="thread-draw"
        style={{ stroke: colour }}
      />
    </svg>
  );
}
