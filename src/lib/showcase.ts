// The showcase: the CoStar kit buildings the demo shows, each paired with the
// mission it stages (#93). Set on the demo server, never in the repository:
//
//   SHOWCASE_LEVELS=52227:romaine-1974,254167:sunset-1986
//
// With a list, live CoStar shows only these kit buildings (beside the
// fixtures), each opens on its own mission like F1–F5 do, and the server
// builds their levels in memory when it starts. Without one, every kit
// building shows and builds on demand. Server only: the variable is not
// `NEXT_PUBLIC_`, so in the browser the list is empty.

export interface ShowcaseEntry {
  buildingId: string;
  missionId: string;
}

type Env = Record<string, string | undefined>;

const PLAIN = /^[A-Za-z0-9_-]+$/;

/** The pairs in a `SHOWCASE_LEVELS` value; a malformed pair is skipped with a warning. */
export function parseShowcase(value: string | undefined): ShowcaseEntry[] {
  const entries: ShowcaseEntry[] = [];
  for (const raw of (value ?? "").split(",")) {
    const pair = raw.trim();
    if (!pair) continue;
    const [buildingId, missionId, ...rest] = pair.split(":").map((s) => s.trim());
    if (!buildingId || !missionId || rest.length > 0 || !PLAIN.test(buildingId) || !PLAIN.test(missionId)) {
      console.warn(`SHOWCASE_LEVELS: skipping "${pair}"; write building:mission, for example 52227:romaine-1974`);
      continue;
    }
    entries.push({ buildingId, missionId });
  }
  return entries;
}

const parsed = new Map<string, ShowcaseEntry[]>();

/** This server's showcase, parsed once per value, so a malformed pair warns once. */
export function showcase(env: Env = process.env): ShowcaseEntry[] {
  const value = env.SHOWCASE_LEVELS ?? "";
  let entries = parsed.get(value);
  if (!entries) {
    entries = parseShowcase(value);
    parsed.set(value, entries);
  }
  return entries;
}

/** The ids of the showcase's buildings, or null when there is no list (every kit building shows). */
export function showcaseIds(env: Env = process.env): Set<string> | null {
  const entries = showcase(env);
  return entries.length > 0 ? new Set(entries.map((e) => e.buildingId)) : null;
}

/** The mission a showcase building stages, or null when it is not on the list. */
export function showcaseMission(buildingId: string, env: Env = process.env): string | null {
  return showcase(env).find((e) => e.buildingId === buildingId)?.missionId ?? null;
}

/**
 * The showcase building a mission is cast onto (#103): the first pair on the
 * list that names the mission, or null when none does. The list is the whole
 * source; nothing searches the kit for one.
 */
export function showcaseBuilding(missionId: string, env: Env = process.env): string | null {
  return showcase(env).find((e) => e.missionId === missionId)?.buildingId ?? null;
}
