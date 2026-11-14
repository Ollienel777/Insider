// The cached levels in data/levels/ (SPEC §4.4), keyed by building and
// mission (SPEC §4.1, #119): `<buildingId>.<missionId>.json` is the manifest
// and `<buildingId>.<missionId>.trace.json` the trace. `npm run build:levels`
// writes them; GET /api/levels/[id]?m=… serves them, so beat 4 never waits on
// a model.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { FIXTURE_BUILDINGS } from "@/adapters/costar/fake";
import { briefingProblems, BuildTrace, LevelManifest } from "@/domain";

export const LEVELS_DIR = path.join(process.cwd(), "data", "levels");

export interface CachedLevel {
  manifest: LevelManifest;
  trace: BuildTrace;
}

/** Building and mission ids are plain names: anything else could walk out of the directory. */
export const isLevelId = (id: string): boolean => /^[A-Za-z0-9_-]+$/.test(id);

/** The file stem of a level: neither id holds a dot, so the pair reads back unambiguously. */
export const levelKey = (buildingId: string, missionId: string): string => `${buildingId}.${missionId}`;

const files = (dir: string, buildingId: string, missionId: string) => ({
  manifest: path.join(dir, `${levelKey(buildingId, missionId)}.json`),
  trace: path.join(dir, `${levelKey(buildingId, missionId)}.trace.json`),
});

/**
 * The cached level of `buildingId` built for `missionId`, read whatever its
 * briefing (the briefing rules are checked on write), `null` when there
 * is none, or an error when a file fails its schema or holds another pair.
 */
export async function readCachedLevel(
  buildingId: string,
  missionId: string,
  dir: string = LEVELS_DIR,
): Promise<CachedLevel | null> {
  if (!isLevelId(buildingId) || !isLevelId(missionId)) return null;
  const paths = files(dir, buildingId, missionId);
  let raw: [string, string];
  try {
    raw = await Promise.all([readFile(paths.manifest, "utf8"), readFile(paths.trace, "utf8")]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const manifest = LevelManifest.parse(JSON.parse(raw[0]));
  if (manifest.buildingId !== buildingId || manifest.missionId !== missionId) {
    throw new Error(`level file ${levelKey(buildingId, missionId)} holds ${levelKey(manifest.buildingId, manifest.missionId)}`);
  }
  return { manifest, trace: BuildTrace.parse(JSON.parse(raw[1])) };
}

/**
 * Whether a level may be written for `buildingId`: only for a fixture
 * building. Every directory a level is written to is tracked, and a level
 * built from a CoStar kit building is derived from a kit record, which never
 * enters the repository.
 */
export const isFixtureBuilding = (buildingId: string): boolean => FIXTURE_BUILDINGS.some((b) => b.id === buildingId);

/** Writes a level's manifest and trace under its building and mission; returns the two paths. */
export async function writeCachedLevel(level: CachedLevel, dir: string = LEVELS_DIR): Promise<string[]> {
  const { buildingId, missionId } = level.manifest;
  if (!isLevelId(buildingId)) throw new Error(`invalid building id "${buildingId}"`);
  if (!isFixtureBuilding(buildingId)) {
    throw new Error(`not writing ${buildingId}: only fixture buildings get a cached level; a CoStar kit building's level would be kit-derived data`);
  }
  if (!isLevelId(missionId)) throw new Error(`invalid mission id "${missionId}"`);
  // The briefing rules hold on write; reading stays tolerant, so an older level never breaks a page.
  const problems = briefingProblems(level.manifest.mission.briefing);
  if (problems.length > 0) throw new Error(`not writing ${levelKey(buildingId, missionId)}: ${problems.join("; ")}`);
  await mkdir(dir, { recursive: true });
  const paths = files(dir, buildingId, missionId);
  const text = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(paths.manifest, text(LevelManifest.parse(level.manifest)));
  await writeFile(paths.trace, text(BuildTrace.parse(level.trace)));
  return [paths.manifest, paths.trace];
}
