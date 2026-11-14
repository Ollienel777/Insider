"use client";

import { X } from "lucide-react";
import { forwardRef, useId } from "react";
import type { ProvenanceLayer } from "@/domain";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LAYER_LABEL, whyRows, type WhyRow, type WhyTarget } from "./why";

export const KIND_LABEL: Readonly<Record<WhyTarget["kind"], string>> = {
  guard: "Why this guard",
  cleaner: "Why this cleaner",
  camera: "Why this camera",
  lock: "Why this lock",
  zone: "Why this zone",
};

/**
 * The Why card (DESIGN.md "The signature element"): a popover beside the
 * piece, at `--e-2`, listing the element's provenance as `ProvenanceRow`s,
 * each one exactly as the placer recorded it. Esc, the close button and a
 * click outside close it (the board handles the last two keys).
 */
export const WhyCard = forwardRef<
  HTMLDivElement,
  {
    target: WhyTarget;
    /** The subtitle as the run stands now (`liveSubtitle`); the placed one when left out. */
    subtitle?: string;
    /** For a CoStar kit building: the line naming the real record fields the rows cite (`recordNote`, #95). */
    note?: string | null;
    style?: React.CSSProperties;
    className?: string;
    onClose: () => void;
  }
>(function WhyCard({ target, subtitle = target.subtitle, note = null, style, className, onClose }, ref) {
  const titleId = useId();
  const rows = whyRows(target);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-testid="why-card"
      data-why={target.key}
      style={style}
      className={cn(
        "absolute z-10 flex flex-col overflow-y-auto overscroll-contain rounded-md border border-border-strong bg-surface-1 shadow-e-2 outline-none",
        "animate-in fade-in-0 [animation-duration:var(--t-base)] ease-out",
        className,
      )}
    >
      <header className="flex shrink-0 items-start gap-3 py-3 pr-2 pl-4">
        <div className="min-w-0 flex-1 pt-1">
          <p className="label-caps text-text-3">{KIND_LABEL[target.kind]}</p>
          <h2 id={titleId} className={cn("mt-1 text-lg font-semibold text-text-1", target.kind !== "zone" && target.kind !== "lock" && "font-mono")}>
            {target.title}
          </h2>
          <p data-testid="why-subtitle" className="text-sm text-text-2">{subtitle}</p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Close the Why card" onClick={onClose}>
          <X aria-hidden />
        </Button>
      </header>
      <ul data-testid="why-rows" className="flex shrink-0 flex-col border-t border-border">
        {rows.map((row, i) => (
          <ProvenanceRow key={`${row.elementRole}-${i}`} row={row} />
        ))}
      </ul>
      {target.placement ? (
        <p data-testid="why-placement" className="shrink-0 border-t border-border px-4 py-3 text-sm text-text-2">
          <span className="label-caps mr-2 text-text-3">Placer</span>
          {target.placement}.
        </p>
      ) : null}
      {note ? (
        <p data-testid="why-record" className="shrink-0 border-t border-border px-4 py-3 text-sm text-text-2">
          {note}
        </p>
      ) : null}
    </div>
  );
});

/** One input: layer dot and name, the field in mono, its value, then the rule as the rules table wrote it. */
export function ProvenanceRow({ row }: { row: WhyRow }) {
  return (
    <li
      data-testid="why-row"
      data-layer={row.layer}
      data-role={row.elementRole}
      data-field={row.field}
      data-value={row.value}
      className="flex flex-col gap-1 border-b border-border px-4 py-3 last:border-b-0"
    >
      <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="flex items-center gap-2 text-text-2">
          <Dot layer={row.layer} />
          {LAYER_LABEL[row.layer]}
        </span>
        <span className="font-mono text-text-2">{row.field}</span>
        <span className="min-w-0 font-mono break-words text-text-1">{row.value}</span>
      </p>
      <p className="text-base text-text-1">{row.rule}</p>
    </li>
  );
}

/** The 8px layer dot; game fiction is no data layer, so its dot is an outline. */
function Dot({ layer }: { layer: ProvenanceLayer }) {
  return (
    <span
      aria-hidden
      data-layer={layer}
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        layer === "costar" ? "bg-layer-costar" : layer === "vexcel" ? "bg-layer-vexcel" : "border border-border-strong",
      )}
    />
  );
}
