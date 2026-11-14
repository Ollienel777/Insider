// The cached levels in data/levels/ (SPEC §4.4): `<id>.json` is the
// manifest and `<id>.trace.json` the trace. `npm run build:levels` writes
// them; GET /api/levels/[id] serves them, so beat 3 never waits on a model.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BuildTrace, LevelManifest } from "@/domain";

export const LEVELS_DIR = path.join(process.cwd(), "data", "levels");

export interface CachedLevel {
  manifest: LevelManifest;
  trace: BuildTrace;
}

/** Building ids are plain names: anything else could walk out of the directory. */
export const isLevelId = (id: string): boolean => /^[A-Za-z0-9_-]+$/.test(id);

const files = (dir: string, id: string) => ({
  manifest: path.join(dir, `${id}.json`),
  trace: path.join(dir, `${id}.trace.json`),
});

/** The cached level, `null` when there is none, or an error when a file fails its schema. */
export async function readCachedLevel(id: string, dir: string = LEVELS_DIR): Promise<CachedLevel | null> {
  if (!isLevelId(id)) return null;
  const paths = files(dir, id);
  let raw: [string, string];
  try {
    raw = await Promise.all([readFile(paths.manifest, "utf8"), readFile(paths.trace, "utf8")]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return {
    manifest: LevelManifest.parse(JSON.parse(raw[0])),
    trace: BuildTrace.parse(JSON.parse(raw[1])),
  };
}

/** Writes a level's manifest and trace; returns the two paths. */
export async function writeCachedLevel(level: CachedLevel, dir: string = LEVELS_DIR): Promise<string[]> {
  const id = level.manifest.buildingId;
  if (!isLevelId(id)) throw new Error(`invalid building id "${id}"`);
  await mkdir(dir, { recursive: true });
  const paths = files(dir, id);
  const text = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(paths.manifest, text(LevelManifest.parse(level.manifest)));
  await writeFile(paths.trace, text(BuildTrace.parse(level.trace)));
  return [paths.manifest, paths.trace];
}
