// Why this building was cast for this mission: the first row of the
// dossier's Data → Level table (SPEC §2 beat 4, #119). Server only.
//
// The reason is a finalist's, the `Candidate` the Casting Director writes in
// its shortlist (SPEC §4.1). `castingResult` is the one seam for that
// shortlist: it reads the cached result where the Casting Director writes it
// in fake mode (`data/casting/<missionId>.json`, SPEC §4.4). Until that agent
// lands (#117) no shortlist exists, and the finalist is derived here instead,
// deterministically, from the fixture inventory and the mission's casting
// filters; the row says so. A shortlist that is unreadable, or that does not
// list this building, falls back to the derived reason too: the dossier never
// breaks on it. Once the Casting Director's reader is on main (PR 141,
// `readCachedCasting` in src/agents/casting/cache.ts), `castingResult` becomes
// a call to it, and nothing else here changes.
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  type Candidate,
  CastingResult,
  type CastingEntryKind,
  Inventory,
  type InventoryProperty,
  type Mission,
  type VacantFloor,
} from "@/domain";
import raw from "../../fixtures/inventory.json";

/** Where the fake-mode shortlists are cached (SPEC §4.4); named apart from the Casting Director's own constant. */
export const SHORTLIST_DIR = path.join(process.cwd(), "data", "casting");

export interface CastFinalist {
  candidate: Candidate;
  /** `shortlist`: the Casting Director's own; `derived`: worked out from the mission's filters, no agent involved. */
  source: "shortlist" | "derived";
}

/** The cached shortlist for a mission, or null when none is cached. The seam for #117. */
export async function castingResult(missionId: string, dir: string = SHORTLIST_DIR): Promise<CastingResult | null> {
  if (!/^[\w-]+$/.test(missionId)) return null;
  try {
    return CastingResult.parse(JSON.parse(await readFile(path.join(dir, `${missionId}.json`), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

let inventory: Inventory | undefined;
const fixtureInventory = (): Inventory => (inventory ??= Inventory.parse(raw));

/** The floor with the most available space (SPEC §4.3's staging floor), ties to the lower floor. */
function largestVacantFloor(p: InventoryProperty): VacantFloor | null {
  const floors = new Map<number, VacantFloor>();
  for (const s of p.availableSpace) {
    const f = floors.get(s.floor) ?? { floor: s.floor, sf: 0, suites: [] };
    floors.set(s.floor, { ...f, sf: f.sf + s.sf, suites: [...f.suites, s.suite] });
  }
  return [...floors.values()].sort((a, b) => b.sf - a.sf || a.floor - b.floor)[0] ?? null;
}

/** "built 1974, Class A, floor 22 on the market, dock on the aerial" (SPEC §2 beat 4). */
export function castReason(p: Pick<Candidate, "yearBuilt" | "buildingClass" | "vacantFloor">, entry: string | null): string {
  return [
    `built ${p.yearBuilt}`,
    `Class ${p.buildingClass}`,
    `floor ${p.vacantFloor.floor} on the market`,
    ...(entry ? [`${entry} on the aerial`] : []),
  ].join(", ");
}

/** The finalist a property would be for a mission, derived from its casting filters; null without a vacant floor. */
export function deriveCandidate(p: InventoryProperty, mission: Mission): Candidate | null {
  const vacantFloor = largestVacantFloor(p);
  if (!vacantFloor) return null;
  const wanted = mission.casting.find((f) => f.kind === "needsEntry")?.needsEntry ?? [];
  const entry: CastingEntryKind | null = wanted.find((kind) => p.entries.includes(kind)) ?? null;
  const fit = mission.casting.map((f) => {
    switch (f.kind) {
      case "city":
        return { criterion: f.label, value: p.city };
      case "yearBuilt":
        return { criterion: f.label, value: p.yearBuilt };
      case "buildingClass":
        return { criterion: f.label, value: p.buildingClass };
      case "propertyTypes":
        return { criterion: f.label, value: p.propertyType };
      case "minVacantFloorSf":
        return { criterion: f.label, value: vacantFloor.sf };
      case "needsScan":
        return { criterion: f.label, value: p.layers.matterport };
      case "needsEntry":
        return { criterion: f.label, value: entry ?? false };
    }
  });
  const { id, name, city, neighbourhood, lat, lng, yearBuilt, buildingClass, propertyType, stories, layers, source } = p;
  return {
    ...{ id, name, city, neighbourhood, lat, lng, yearBuilt, buildingClass, propertyType, stories, layers, source },
    vacantFloor,
    fit,
    reason: castReason({ yearBuilt, buildingClass, vacantFloor }, entry),
  };
}

/**
 * Why `buildingId` was cast for `mission`: the shortlist's finalist when a
 * cached shortlist lists it, else derived; null when neither can say.
 */
export async function castFinalist(mission: Mission, buildingId: string, dir?: string): Promise<CastFinalist | null> {
  let result: CastingResult | null = null;
  try {
    result = await castingResult(mission.id, dir);
  } catch (error) {
    console.error(`cast-because: the shortlist for ${mission.id} is unreadable; deriving the reason instead:`, error);
  }
  const listed = result?.finalists.find((c) => c.id === buildingId);
  if (listed) return { candidate: listed, source: "shortlist" };
  const property = fixtureInventory().find((p) => p.id === buildingId);
  const candidate = property ? deriveCandidate(property, mission) : null;
  return candidate ? { candidate, source: "derived" } : null;
}
