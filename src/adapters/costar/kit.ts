// The CoStar data kit reader: streams the three `KIT_FILES` once, line by
// line, and keeps only the mapped `Building`s (a few hundred small records),
// never the raw records. The kit is ~400 MB; the property file alone is
// ~190 MB of JSON Lines, so it is never read whole. What each record means is
// mapping.ts's; this file only opens, splits and counts.
//
// Taste rule (SPEC §1): `openKit` is the only place a kit file is opened, and
// it refuses any path not in `KIT_FILES`, so location occupancy and company
// detail (tenants) are never opened.
import { open } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import type { AvailableSpace } from "@/domain";
import { KIT_FILES, type KitFile, type KitProperty, type SkipReason, scanColumns, toKitProperty, toListingSpaces, toScan, UNNAMED_SPACE } from "./mapping";

const ALLOWED: ReadonlySet<string> = new Set(Object.values(KIT_FILES));

/** The lines of one allowed kit file, numbered from 1. */
async function* kitLines(dir: string, file: KitFile): AsyncGenerator<[number, string]> {
  const relative = KIT_FILES[file];
  if (!ALLOWED.has(relative)) throw new Error(`CoStar kit: ${relative} is not a file the adapter may read`);
  const handle = await open(path.join(dir, relative), "r");
  try {
    const lines = createInterface({ input: handle.createReadStream({ encoding: "utf8" }), crlfDelay: Infinity });
    let n = 0;
    for await (const line of lines) {
      n += 1;
      if (line.trim()) yield [n, line];
    }
  } finally {
    await handle.close().catch(() => {});
  }
}

export interface KitStats {
  /** Property records read, staged or not (the kit's inventory size). */
  records: number;
  /** Properties staged as `Building`s. */
  indexed: number;
  /** Well-formed properties not staged, by reason. */
  skipped: Partial<Record<SkipReason, number>>;
  /** Records skipped because they could not be read, per file. */
  malformed: Record<KitFile, number>;
  /** Vacant spaces joined from the listings, and properties with a scan. */
  spaces: number;
  scanned: number;
  ms: number;
}

export interface KitIndex {
  properties: ReadonlyMap<string, KitProperty>;
  stats: KitStats;
}

/** At most this many malformed lines are logged per file; the rest are only counted. */
const LOG_LIMIT = 5;

/**
 * Reads the kit at `dir` once: the scan join, then the listings' vacant
 * spaces, then the properties, mapped. A malformed record is skipped,
 * counted and logged (file and line, never its content); a missing or
 * unreadable file rejects.
 */
export async function loadKitIndex(dir: string, log: Pick<Console, "warn"> = console): Promise<KitIndex> {
  const started = Date.now();
  const malformed: Record<KitFile, number> = { properties: 0, listings: 0, scans: 0 };
  const bad = (file: KitFile, line: number, error: unknown) => {
    malformed[file] += 1;
    if (malformed[file] <= LOG_LIMIT) {
      const why = error instanceof SyntaxError ? "invalid JSON" : error instanceof Error ? error.message : "unreadable";
      log.warn(`CoStar kit: skipped ${KIT_FILES[file]} line ${line} (${why})`);
    }
  };

  const scans = new Map<string, string[]>();
  let columns: [number, number] | null = null;
  for await (const [n, line] of kitLines(dir, "scans")) {
    if (!columns) {
      columns = scanColumns(line);
      continue;
    }
    try {
      const scan = toScan(line, columns);
      if (!scan) continue;
      const models = scans.get(scan[0]) ?? [];
      if (!models.includes(scan[1])) models.push(scan[1]);
      scans.set(scan[0], models);
    } catch (error) {
      bad("scans", n, error);
    }
  }

  const spaces = new Map<string, AvailableSpace[]>();
  let spaceCount = 0;
  for await (const [n, line] of kitLines(dir, "listings")) {
    try {
      for (const { propertyId, space: listed } of toListingSpaces(JSON.parse(line))) {
        const list = spaces.get(propertyId) ?? [];
        // A space with no suite name is numbered on its floor, never named by its kit id.
        const unnamed = listed.suite === UNNAMED_SPACE;
        const space = unnamed
          ? { ...listed, suite: `${UNNAMED_SPACE} ${list.filter((s) => s.floor === listed.floor && s.suite.startsWith(UNNAMED_SPACE)).length + 1}` }
          : listed;
        if (!unnamed && list.some((s) => s.floor === space.floor && s.suite === space.suite)) continue;
        list.push(space);
        spaces.set(propertyId, list);
        spaceCount += 1;
      }
    } catch (error) {
      bad("listings", n, error);
    }
  }

  const properties = new Map<string, KitProperty>();
  const skipped: Partial<Record<SkipReason, number>> = {};
  let records = 0;
  const join = {
    spaces: (id: string) => [...(spaces.get(id) ?? [])].sort((a, b) => a.floor - b.floor || a.suite.localeCompare(b.suite, "en", { numeric: true })),
    scans: (id: string) => scans.get(id) ?? [],
  };
  for await (const [n, line] of kitLines(dir, "properties")) {
    records += 1;
    try {
      const mapped = toKitProperty(JSON.parse(line), join);
      if (typeof mapped === "string") skipped[mapped] = (skipped[mapped] ?? 0) + 1;
      else properties.set(mapped.building.id, mapped);
    } catch (error) {
      bad("properties", n, error);
    }
  }

  return {
    properties,
    stats: {
      records,
      indexed: properties.size,
      skipped,
      malformed,
      spaces: spaceCount,
      scanned: [...properties.values()].filter((p) => p.building.layers.matterport).length,
      ms: Date.now() - started,
    },
  };
}
