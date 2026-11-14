import { useId } from "react";
import { cn } from "@/lib/utils";
import { FRAME, type MassingView as View } from "./massing";

/**
 * One view of the massing as SVG: a dark ground plane with a fading grid, the
 * lot and the building's cast shadow, the walls turned to the camera (shaded
 * by the light, with a line at every storey) and the roof. Colours are the
 * neutral tokens only; the accent stays for the entry markers.
 */
export function MassingSvg({ view, className }: { view: View; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      viewBox={`0 0 ${FRAME.width} ${FRAME.height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
      className={cn("absolute inset-0 size-full", className)}
    >
      <defs>
        <radialGradient
          id={`fade-${id}`}
          gradientUnits="userSpaceOnUse"
          cx={view.centre.x}
          cy={view.centre.y}
          r={view.dir === "ortho" ? 640 : 760}
        >
          <stop offset="0" style={{ stopColor: "var(--n-50)", stopOpacity: 1 }} />
          <stop offset="0.7" style={{ stopColor: "var(--n-50)", stopOpacity: 0.35 }} />
          <stop offset="1" style={{ stopColor: "var(--n-50)", stopOpacity: 0 }} />
        </radialGradient>
        <mask id={`mask-${id}`}>
          <rect width={FRAME.width} height={FRAME.height} fill={`url(#fade-${id})`} />
        </mask>
      </defs>

      <g mask={`url(#mask-${id})`} style={{ stroke: "var(--n-700)" }} strokeWidth="1">
        {view.ground.map((l, i) => (
          <line key={i} {...l} />
        ))}
      </g>
      <polygon points={view.pad} style={{ fill: "var(--n-900)", stroke: "var(--n-700)" }} strokeWidth="1" />
      <polygon points={view.shadow} style={{ fill: "var(--n-950)" }} fillOpacity="0.75" />

      {view.walls.map((wall, i) => (
        <polygon
          key={i}
          data-testid="massing-wall"
          points={wall.points}
          style={{
            fill: `color-mix(in srgb, var(--n-300) ${Math.round(wall.light * 70)}%, var(--n-800))`,
            stroke: "var(--n-950)",
          }}
          strokeWidth="1"
          strokeLinejoin="round"
        />
      ))}
      <g style={{ stroke: "var(--n-950)" }} strokeOpacity="0.3" strokeWidth="1">
        {view.floors.map((l, i) => (
          <line key={i} {...l} />
        ))}
      </g>
      <polygon
        data-testid="massing-roof"
        points={view.roof.points}
        style={{ fill: "color-mix(in srgb, var(--n-300) 55%, var(--n-700))", stroke: "var(--n-300)" }}
        strokeOpacity="0.5"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <polygon
        points={view.parapet}
        style={{ fill: "none", stroke: "var(--n-500)" }}
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}
