// A floor and a ceiling for each level of a scan (issue 118). Pure.
//
// Drawn just behind the mesh's own floor and ceiling, they stop a hole the
// mesh still has from opening onto nothing, or onto the level below: what
// shows through it is a surface at the right height. Their heights come from
// the scan itself: the floor under each scan position and the ceiling over
// it. Scan positions whose floors are close are one level.

export interface LevelSample {
  x: number;
  z: number;
  /** The floor's height under the scan position. */
  floor: number;
  /** The ceiling's height over it; null where none was found. */
  ceiling: number | null;
}

export interface Level {
  /** The plane under the level's lowest floor, and over its highest ceiling. */
  floor: number;
  ceiling: number;
  /** The box the planes cover, x and z. */
  min: [number, number];
  max: [number, number];
}

export interface LevelOptions {
  /** Floors closer than this, metres, are one level. */
  gap: number;
  /** How far under the floor, and over the ceiling, the planes sit. */
  behind: number;
  /** How far past the outermost scan positions the planes reach. */
  margin: number;
  /** The ceiling's height over the floor when no ceiling was found. */
  room: number;
}

export const LEVEL_OPTIONS: LevelOptions = { gap: 0.6, behind: 0.06, margin: 4, room: 2.7 };

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * The levels of the scan positions in `samples`, lowest first. A level's
 * floor plane sits under its lowest floor; its ceiling plane over the
 * ceiling, taken as the median of those found (one tall atrium must not lift
 * the whole level's), and never below the highest floor plus the head room.
 */
export function fitLevels(samples: readonly LevelSample[], options: LevelOptions = LEVEL_OPTIONS): Level[] {
  const sorted = samples.filter((s) => Number.isFinite(s.floor)).sort((a, b) => a.floor - b.floor);
  const clusters: LevelSample[][] = [];
  for (const s of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && s.floor - last[last.length - 1].floor < options.gap) last.push(s);
    else clusters.push([s]);
  }
  return clusters.map((cluster) => {
    const floors = cluster.map((s) => s.floor);
    const low = Math.min(...floors);
    const high = Math.max(...floors);
    const ceilings = cluster.map((s) => s.ceiling).filter((c): c is number => c !== null && c > high + 1);
    const ceiling = Math.max(ceilings.length > 0 ? median(ceilings) : high + options.room, high + 1.9);
    const xs = cluster.map((s) => s.x);
    const zs = cluster.map((s) => s.z);
    return {
      floor: low - options.behind,
      ceiling: ceiling + options.behind,
      min: [Math.min(...xs) - options.margin, Math.min(...zs) - options.margin],
      max: [Math.max(...xs) + options.margin, Math.max(...zs) + options.margin],
    };
  });
}
