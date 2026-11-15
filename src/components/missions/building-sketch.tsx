// A building sketched for a case file's snapshot (issue 166): an isometric box
// with rows of windows, drawn in the era a mission needs. Fiction for the
// picker: the real building is cast on the next screen.
type Era = "tower70" | "block80" | "glass15" | "tower00" | "lab19";

const LOOK: Record<Era, { h: number; w: number; d: number; face: string; side: string; win: string; rows: number; cols: number }> = {
  tower70: { h: 118, w: 40, d: 30, face: "var(--manila)", side: "var(--manila-2)", win: "var(--walnut-2)", rows: 13, cols: 3 },
  block80: { h: 70, w: 58, d: 40, face: "var(--n-800)", side: "var(--n-700)", win: "var(--walnut-2)", rows: 6, cols: 5 },
  glass15: { h: 110, w: 46, d: 34, face: "var(--n-700)", side: "var(--n-600)", win: "var(--n-950)", rows: 13, cols: 4 },
  tower00: { h: 124, w: 42, d: 32, face: "var(--n-800)", side: "var(--n-600)", win: "var(--n-300)", rows: 15, cols: 3 },
  lab19: { h: 56, w: 70, d: 44, face: "var(--n-850)", side: "var(--n-700)", win: "var(--success)", rows: 4, cols: 6 },
};

/** The sketch's style for the era a mission needs, read from its "built …" filter. */
export function eraStyle(eraNeeded: string): Era {
  const year = Number(eraNeeded.match(/\d{4}/)?.[0] ?? 0);
  if (/later/.test(eraNeeded)) return "glass15";
  if (/\d{4}s/.test(eraNeeded)) return "block80";
  if (year && year < 1980) return "tower70";
  if (year && year <= 2005) return "tower00";
  return "lab19";
}

export function BuildingSketch({ era, label }: { era: Era; label: string }) {
  const L0 = LOOK[era];
  const cx = 80, base = 112, { h, w, d } = L0;
  const Lp = [cx - w, base - w / 2], F = [cx, base], R = [cx + d, base - d / 2], B = [cx - w + d, base - w / 2 - d / 2];
  const pt = (p: number[], dy = 0) => `${p[0]},${p[1] - dy}`;
  const windows: { x: number; y: number }[] = [];
  for (let r = 0; r < L0.rows; r++) {
    for (let c = 0; c < L0.cols; c++) {
      const t = (c + 0.5) / L0.cols;
      const y = 8 + r * ((h - 14) / L0.rows);
      windows.push({ x: Lp[0] + (F[0] - Lp[0]) * t, y: Lp[1] + (F[1] - Lp[1]) * t - h + y });
    }
  }
  return (
    <svg viewBox="0 0 160 130" role="img" aria-label={label} className="block h-auto w-full border border-border-strong bg-n-850">
      <ellipse cx="80" cy="118" rx="70" ry="10" className="fill-n-700 stroke-border-strong" strokeWidth="2" />
      <polygon points={`${pt(Lp)} ${pt(F)} ${pt(F, h)} ${pt(Lp, h)}`} fill={L0.face} className="stroke-border-strong" strokeWidth="2.5" strokeLinejoin="round" />
      <polygon points={`${pt(F)} ${pt(R)} ${pt(R, h)} ${pt(F, h)}`} fill={L0.side} className="stroke-border-strong" strokeWidth="2.5" strokeLinejoin="round" />
      <polygon points={`${pt(Lp, h)} ${pt(F, h)} ${pt(R, h)} ${pt(B, h)}`} className="fill-n-950 stroke-border-strong" strokeWidth="2.5" strokeLinejoin="round" />
      {windows.map((p, i) => (
        <rect key={i} x={(p.x - 3).toFixed(1)} y={p.y.toFixed(1)} width="5" height="4" fill={L0.win} transform={`skewY(26)`} transform-origin={`${p.x} ${p.y}`} />
      ))}
    </svg>
  );
}
