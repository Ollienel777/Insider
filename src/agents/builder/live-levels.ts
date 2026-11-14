// Levels for CoStar kit buildings, built on demand and kept in memory (#93).
//
// A fixture building's level is built ahead of the demo and committed under
// data/levels/. A kit building's cannot be: it is derived from a kit record,
// and nothing from the kit may enter the repository (`writeCachedLevel`
// refuses it). So the Level Builder runs for it when a player asks, on the
// server, and the level lives here, in this process's memory, until the
// server stops. Nothing here touches the disk.
//
// This module holds the store only, so every screen can read it without
// loading the Builder; `build-on-demand.ts` runs the Builder (route only).
//
// The Builder reads CoStar and Vexcel only. The Matterport scan is loaded in
// the browser at Plan and Run, and the level is placed on it there, so no scan
// data reaches the model (SPEC §4.5).
import { missionsFor } from "./missions";
import { readCachedLevel, type CachedLevel } from "./cache";
import { FIXTURE_BUILDINGS } from "@/adapters/costar/fake";
import type { Building } from "@/domain";

const isFixtureBuilding = (id: string): boolean => FIXTURE_BUILDINGS.some((b) => b.id === id);
export const levelKey = (buildingId: string, missionId: string): string => `${buildingId}.${missionId}`;

export type Entry =
  | { status: "building"; promise: Promise<CachedLevel> }
  | { status: "built"; level: CachedLevel }
  | { status: "failed"; error: string };

// On globalThis, so a dev server's module reload keeps what was built.
const globalStore = globalThis as typeof globalThis & { __heistKitLevels?: Map<string, Entry> };
/** The on-demand levels by `<building>.<mission>`; `build-on-demand.ts` fills it. */
export const store: Map<string, Entry> = (globalStore.__heistKitLevels ??= new Map());

/** Whether `building` takes an on-demand level: a kit building, never a fixture. */
export function buildsOnDemand(building: Pick<Building, "id" | "source">): boolean {
  return building.source === "costar" && !isFixtureBuilding(building.id);
}

/** Whether `missionId` is one `building` can be built for: a mission staged in its city. */
export function canBuildFor(building: Pick<Building, "city">, missionId: string): boolean {
  return missionsFor(building.city).some((m) => m.id === missionId);
}

/**
 * The level a building screen reads: a fixture building's cached level from
 * data/levels/, or a kit building's from memory (null until it is built).
 */
export async function levelFor(building: Pick<Building, "id" | "source">, missionId: string): Promise<CachedLevel | null> {
  if (!buildsOnDemand(building)) return readCachedLevel(building.id, missionId);
  const entry = store.get(levelKey(building.id, missionId));
  return entry?.status === "built" ? entry.level : null;
}

/**
 * The level for a building and mission by id alone, for the agents behind the
 * screens (Crew, Chief, strategies): an on-demand level from memory, else the
 * committed one under `dir`. Fixture ids and kit ids never collide.
 */
export async function readLevel(buildingId: string, missionId: string, dir?: string): Promise<CachedLevel | null> {
  const entry = store.get(levelKey(buildingId, missionId));
  if (entry?.status === "built") return entry.level;
  return dir === undefined ? readCachedLevel(buildingId, missionId) : readCachedLevel(buildingId, missionId, dir);
}

/** The missions a kit building has a level for in memory, for the step rail. */
export function builtMissions(buildingId: string): string[] {
  const prefix = `${buildingId}.`;
  return [...store.entries()]
    .filter(([key, entry]) => key.startsWith(prefix) && entry.status === "built")
    .map(([key]) => key.slice(prefix.length));
}

/** Where a kit building's level stands: none, building, built, or failed with why. */
export function buildState(buildingId: string, missionId: string): { status: "none" } | { status: "building" | "built" } | { status: "failed"; error: string } {
  const entry = store.get(levelKey(buildingId, missionId));
  if (!entry) return { status: "none" };
  return entry.status === "failed" ? { status: "failed", error: entry.error } : { status: entry.status };
}

/** Forgets every on-demand level; for tests. */
export function clearKitLevels(): void {
  store.clear();
}
