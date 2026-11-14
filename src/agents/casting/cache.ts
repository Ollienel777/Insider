// The cached shortlists (SPEC §4.4): `<missionId>.json`, a CastingResult
// with its trace. `npm run cast` writes them; GET /api/cast/[missionId]
// serves them, so beat 2 never waits on a model.
//
// Fake runs (fixtures and recorded model turns only) go to data/casting/,
// which is tracked. Anything else goes to `<HEIST_STATE_DIR>/casting/`,
// outside the tracked files: no kit record, nor anything derived from one, is
// ever committed (SPEC §4.5), and the writer refuses to put one in
// data/casting/.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { demoStateDir } from "@/lib/demo-epoch";
import { CastingResult } from "@/domain";

export const CASTING_DIR = path.join(process.cwd(), "data", "casting");

/** Where live shortlists go: `casting/` under `HEIST_STATE_DIR` (default `.heist/`, gitignored). */
export const liveCastingDir = (): string => path.join(demoStateDir(), "casting");

/** Mission ids are plain names: anything else could walk out of the directory. */
export const isMissionId = (id: string): boolean => /^[A-Za-z0-9_-]+$/.test(id);

const file = (dir: string, id: string) => path.join(dir, `${id}.json`);

/** A result whose data is the fixtures alone: the only kind data/casting/ may hold. */
export const isFixtureResult = (result: CastingResult): boolean =>
  result.source === "fixture" && result.trace.liveData !== true && result.finalists.every((c) => c.source === "fixture");

/**
 * The cached shortlist from the first directory that has one, `null` when
 * none does, or an error when a file fails its schema.
 */
export async function readCachedCasting(id: string, dirs: readonly string[] = [CASTING_DIR]): Promise<CastingResult | null> {
  if (!isMissionId(id)) return null;
  for (const dir of dirs) {
    let raw: string;
    try {
      raw = await readFile(file(dir, id), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const result = CastingResult.parse(JSON.parse(raw));
    if (result.missionId !== id) throw new Error(`${file(dir, id)} holds mission ${result.missionId}`);
    return result;
  }
  return null;
}

/** Writes a shortlist; returns its path. Refuses one that is not fixtures-only in data/casting/. */
export async function writeCachedCasting(result: CastingResult, dir: string = CASTING_DIR): Promise<string> {
  const id = result.missionId;
  if (!isMissionId(id)) throw new Error(`invalid mission id "${id}"`);
  const parsed = CastingResult.parse(result);
  if (path.resolve(/*turbopackIgnore: true*/ dir) === CASTING_DIR && !isFixtureResult(parsed)) {
    throw new Error(`${id}: a shortlist cast on live data never goes in data/casting/; write it to ${liveCastingDir()}`);
  }
  await mkdir(dir, { recursive: true });
  await writeFile(file(dir, id), `${JSON.stringify(parsed, null, 2)}\n`);
  return file(dir, id);
}
