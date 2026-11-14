import { cn } from "@/lib/utils";

export const LAYERS = {
  costar: { label: "CoStar", className: "bg-layer-costar" },
  vexcel: { label: "Vexcel", className: "bg-layer-vexcel" },
  matterport: { label: "Matterport", className: "bg-layer-matterport" },
} as const;

export type Layer = keyof typeof LAYERS;

interface LayerDotProps {
  layer: Layer;
  /** The layer has no data here: an outlined dot instead of a filled one. */
  absent?: boolean;
  /** Hide from assistive tech when a visible label already names the layer. */
  decorative?: boolean;
  className?: string;
}

/** The 8px dot that marks which data layer a value comes from (DESIGN.md). */
export function LayerDot({ layer, absent = false, decorative = false, className }: LayerDotProps) {
  const { label } = LAYERS[layer];
  return (
    <span
      data-layer={layer}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : absent ? `${label}: no data` : label}
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        absent ? "border border-border-strong" : LAYERS[layer].className,
        className,
      )}
    />
  );
}
