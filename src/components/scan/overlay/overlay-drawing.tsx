// The overlay's drawing (issue 108): the laid-out marks as SVG in the Inside
// view's frame. Pure: it draws what `layout` gave it and nothing else. Tokens
// only (DESIGN.md): guards and cleaners in the board's pawn neutrals, the
// watched floor in `--warning`, the legal hops in `--n-50` with the aimed one
// in the accent (the player's path), the objective's beacon in `--n-50` and
// the exit's in `--success`. An outline is a piece heard, not seen.
//
// The layer takes no pointer events except on guards, cleaners and cameras,
// whose click (or Enter) opens their Why card; dragging anywhere else reaches
// the player underneath.
import type { KeyboardEvent, MouseEvent } from "react";
import type { Drawn } from "./projection";

type Figure = Extract<Drawn, { kind: "figure" }>;
type CameraMark = Extract<Drawn, { kind: "camera" }>;
type Ring = Extract<Drawn, { kind: "ring" }>;
type Beacon = Extract<Drawn, { kind: "beacon" }>;

/** Opens the Why card for `key`, from the element clicked. */
export type Inspect = (key: string, from: Element) => void;

const r1 = (n: number) => Math.round(n * 10) / 10;
const LABEL_HALO = { stroke: "var(--n-950)", strokeWidth: 3, paintOrder: "stroke" } as const;

/** The props that make a piece a button opening its Why card. */
export function inspectProps(key: string, label: string, onInspect: Inspect) {
  return {
    role: "button",
    tabIndex: 0,
    "aria-label": label,
    "data-overlay-why": key,
    style: { pointerEvents: "all" as const, cursor: "pointer" },
    onClick: (event: MouseEvent<SVGGElement>) => onInspect(key, event.currentTarget),
    onKeyDown: (event: KeyboardEvent<SVGGElement>) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      onInspect(key, event.currentTarget);
    },
  };
}

export function OverlayDrawing({
  drawn,
  selected,
  beaconLabel,
  onInspect,
}: {
  drawn: readonly Drawn[];
  /** The key of the piece whose Why card is open. */
  selected: string | null;
  beaconLabel: (role: Beacon["role"], nodeId: string) => string;
  onInspect: Inspect;
}) {
  return (
    <svg
      data-testid="scan-overlay-drawing"
      aria-label="Guards, cameras and their sight over the scan"
      role="group"
      className="pointer-events-none absolute inset-0 size-full overflow-hidden select-none"
    >
      {drawn.map((d) => {
        switch (d.kind) {
          case "ring":
            return <RingShape key={d.key} ring={d} />;
          case "beacon":
            return <BeaconShape key={d.key} beacon={d} label={beaconLabel(d.role, d.nodeId)} />;
          case "camera":
            return <CameraShape key={d.key} camera={d} selected={selected === d.key} onInspect={onInspect} />;
          case "figure":
            return <FigureShape key={d.key} figure={d} selected={selected === d.key} onInspect={onInspect} />;
        }
      })}
    </svg>
  );
}

function RingShape({ ring }: { ring: Ring }) {
  const points = ring.points.map((p) => `${r1(p.x)},${r1(p.y)}`).join(" ");
  if (ring.role === "watch") {
    return (
      <polygon
        data-testid="overlay-watch"
        data-node={ring.nodeId}
        points={points}
        style={{ fill: "var(--warning)", stroke: "var(--warning)" }}
        fillOpacity={0.14}
        strokeOpacity={0.85}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    );
  }
  return (
    <polygon
      data-testid="overlay-hop"
      data-node={ring.nodeId}
      data-aimed={ring.aimed ? "true" : undefined}
      data-locked={ring.locked ? "true" : undefined}
      points={points}
      style={ring.aimed ? { fill: "var(--accent-wash)", stroke: "var(--accent)" } : { fill: "none", stroke: "var(--n-50)" }}
      strokeOpacity={ring.aimed ? 1 : 0.75}
      strokeWidth={ring.aimed ? 3 : 1.5}
      strokeDasharray={ring.locked ? "5 4" : undefined}
      strokeLinejoin="round"
    />
  );
}

function BeaconShape({ beacon, label }: { beacon: Beacon; label: string }) {
  const colour = beacon.role === "exit" ? "var(--success)" : "var(--n-50)";
  const solid = beacon.seen === "solid";
  const x = r1(beacon.x);
  const top = r1(beacon.top);
  const bottom = r1(beacon.bottom);
  const s = Math.max(5, Math.min(10, (beacon.bottom - beacon.top) * 0.08));
  return (
    <g data-testid="overlay-beacon" data-role={beacon.role} data-node={beacon.nodeId} data-seen={beacon.seen} opacity={solid ? 1 : 0.7}>
      <line x1={x} y1={bottom} x2={x} y2={top} style={{ stroke: colour }} strokeWidth={2} strokeDasharray={solid ? undefined : "4 4"} />
      <path
        d={`M ${x} ${r1(top - s)} L ${r1(x + s)} ${top} L ${x} ${r1(top + s)} L ${r1(x - s)} ${top} Z`}
        style={solid ? { fill: colour, stroke: "var(--n-950)" } : { fill: "none", stroke: colour }}
        strokeWidth={1.5}
      />
      <text x={x} y={r1(top - s - 6)} textAnchor="middle" className="font-mono" fontSize={12} fontWeight={500} letterSpacing="0.06em" style={{ fill: colour, ...LABEL_HALO }}>
        {label}
      </text>
    </g>
  );
}

function CameraShape({ camera, selected, onInspect }: { camera: CameraMark; selected: boolean; onInspect: Inspect }) {
  const solid = camera.seen === "solid";
  const w = camera.size;
  const h = camera.size * 0.55;
  const x = r1(camera.x);
  const y = r1(camera.y);
  return (
    <g
      data-testid="overlay-camera"
      data-id={camera.id}
      data-seen={camera.seen}
      data-selected={selected ? "true" : undefined}
      {...inspectProps(camera.key, `Why is camera ${camera.id} here?`, onInspect)}
      transform={`translate(${x}, ${y})`}
    >
      <rect x={r1(-w / 2 - 8)} y={r1(-h / 2 - 8)} width={r1(w + 16)} height={r1(h + 16)} fill="transparent" />
      <rect
        x={r1(-w / 2)}
        y={r1(-h / 2)}
        width={r1(w)}
        height={r1(h)}
        rx={3}
        style={
          solid
            ? { fill: "var(--n-300)", stroke: selected ? "var(--accent)" : "var(--n-950)" }
            : { fill: "none", stroke: selected ? "var(--accent)" : "var(--n-300)" }
        }
        strokeWidth={selected ? 2 : 1.5}
        strokeDasharray={solid ? undefined : "4 3"}
      />
      <circle cx={r1(w / 2 - h / 2)} cy={0} r={r1(h * 0.28)} style={{ fill: solid ? "var(--n-800)" : "none", stroke: "var(--n-950)" }} strokeWidth={1} />
      <text x={r1(w / 2 + 6)} y={r1(-h / 2 - 4)} className="font-mono" fontSize={12} fontWeight={500} style={{ fill: "var(--text-1)", ...LABEL_HALO }}>
        {camera.id}
      </text>
    </g>
  );
}

function FigureShape({ figure, selected, onInspect }: { figure: Figure; selected: boolean; onInspect: Inspect }) {
  const solid = figure.seen === "solid";
  const h = figure.bottom - figure.top;
  const x = r1(figure.x);
  const y = r1(figure.bottom);
  const body = figure.who === "guard" ? "var(--n-200)" : "var(--n-400)";
  // An abstract pawn (DESIGN.md: no people are depicted), feet at the origin, `h` tall.
  const k = (n: number) => r1(n * h);
  const torso = `M ${k(-0.17)} 0 L ${k(-0.12)} ${k(-0.66)} Q 0 ${k(-0.72)} ${k(0.12)} ${k(-0.66)} L ${k(0.17)} 0 Z`;
  const paint = solid
    ? { fill: body, stroke: selected ? "var(--accent)" : "var(--n-950)" }
    : { fill: "none", stroke: selected ? "var(--accent)" : body };
  const label = figure.who === "guard" ? `Why is guard ${figure.id} here?` : `Why is cleaner ${figure.id} here?`;
  return (
    <g
      data-testid="overlay-figure"
      data-kind={figure.who}
      data-id={figure.id}
      data-node={figure.nodeId}
      data-seen={figure.seen}
      data-selected={selected ? "true" : undefined}
      {...inspectProps(figure.key, label, onInspect)}
      transform={`translate(${x}, ${y})`}
    >
      <rect x={k(-0.3)} y={k(-1.02)} width={k(0.6)} height={k(1.06)} fill="transparent" />
      {selected ? <ellipse cx={0} cy={0} rx={k(0.3)} ry={k(0.07)} fill="none" style={{ stroke: "var(--accent)" }} strokeWidth={2} /> : null}
      {solid ? <ellipse cx={0} cy={0} rx={k(0.22)} ry={k(0.05)} style={{ fill: "var(--n-950)" }} fillOpacity={0.5} /> : null}
      <path d={torso} style={paint} strokeWidth={selected ? 2 : 1.5} strokeDasharray={solid ? undefined : "4 3"} strokeLinejoin="round" />
      <circle cx={0} cy={k(-0.83)} r={k(0.1)} style={paint} strokeWidth={selected ? 2 : 1.5} strokeDasharray={solid ? undefined : "4 3"} />
      <text x={0} y={r1(-h - 6)} textAnchor="middle" className="font-mono" fontSize={12} fontWeight={500} style={{ fill: solid ? "var(--text-1)" : "var(--text-2)", ...LABEL_HALO }}>
        {figure.id}
      </text>
    </g>
  );
}
