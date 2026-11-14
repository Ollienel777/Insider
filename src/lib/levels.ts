// Which buildings have a playable level yet (issue #10, spec review R1-M1).
// Server only: it reads the repository's fixture floors from disk.
//
// A level needs a board, and a board is a floor: until the F2–F5 floor
// tickets land, only F1 has one (fixtures/floors/F1.json). The map disables
// every other pin and marks it "level in prep". A floor file added under
// fixtures/floors/ enables its building with no code change. When the cached
// manifests arrive (data/levels/, the Level Builder ticket), this is the one
// place to also require one.
import { readdirSync } from "node:fs";
import path from "node:path";

const FLOORS = path.join(process.cwd(), "fixtures", "floors");

/** Ids of the buildings with a floor fixture, read once per call. */
export function buildingsWithLevel(dir: string = FLOORS): Set<string> {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return new Set();
  }
  return new Set(names.filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -".json".length)));
}
