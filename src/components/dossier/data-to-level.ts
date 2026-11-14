// The dossier's Data → Level table (SPEC §2 beat 3, DESIGN.md Dossier): one
// row per rule of the rules table that shaped this level, read from the
// cached manifest's provenance. Each row names the layer, the field and its
// value, the rule in plain words, and what the level got from it.
//
// Pure: the page computes the rows on the server and the screen only shows
// them. A row whose provenance the manifest lacks is left out, never invented.
import type { CameraKind, LevelManifest, LockKind, Provenance, ProvenanceLayer } from "@/domain";

export interface DataToLevelRow {
  /** Stable key, and the row's `data-rule`. */
  id: "era" | "guards" | "staging" | "crowded" | "dock";
  layer: Exclude<ProvenanceLayer, "fiction">;
  field: string;
  value: string;
  /** The rule's condition, in plain words. */
  rule: string;
  /** What the level got from it. */
  result: string;
}

const LOCKS: Readonly<Record<LockKind, string>> = {
  key: "key locks",
  magstripe: "magstripe readers",
  prox: "prox badge readers",
  "badge-pin": "badge plus PIN",
};

const CAMERAS: Readonly<Record<CameraKind, string>> = {
  "analog-sweep": "sweeping CCTV",
  ptz: "PTZ cameras",
  "fixed-ip": "fixed IP cameras",
  "ip-analytics": "IP cameras with analytics",
};

/** "24,850 sf". Grouped by hand, as the rules table does, so it is locale-free. */
const sf = (n: number): string => `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} sf`;

const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** The two halves of a provenance rule written as "condition → result". */
function halves(rule: string): [string, string] {
  const at = rule.indexOf(" → ");
  return at < 0 ? [rule, ""] : [rule.slice(0, at), rule.slice(at + 3)];
}

/** "2202–2210" for a run of consecutive suites, else the suites listed. */
export function suiteRange(suites: readonly string[]): string {
  const sorted = [...suites].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  if (sorted.length === 0) return "";
  if (sorted.length === 1) return sorted[0];
  const numeric = sorted.every((s) => /^\d+$/.test(s));
  const consecutive = numeric && sorted.every((s, i) => i === 0 || Number(s) === Number(sorted[i - 1]) + 1);
  return consecutive ? `${sorted[0]}–${sorted[sorted.length - 1]}` : sorted.join(", ");
}

/**
 * What an entry rule gave the level, from its recorded words: `The aerial
 * tags "Loading dock" (dock): a loading dock is always offered as a way in
 * and out` → "Always offered as a way in and out". The subject is dropped
 * because the row's rule already names the entry.
 */
export function entryEffect(rule: string): string {
  const at = rule.indexOf(": ");
  const tail = at < 0 ? rule : rule.slice(at + 2);
  const predicate = /^(?:an? |the )?[\w -]+? is (.+)$/.exec(tail)?.[1] ?? tail;
  return capitalise(predicate);
}

export function dataToLevelRows(manifest: LevelManifest): DataToLevelRow[] {
  const byRole = new Map<string, Provenance>();
  for (const p of manifest.provenance) if (!byRole.has(p.elementRole)) byRole.set(p.elementRole, p);
  const profile = manifest.securityProfile;
  const rows: DataToLevelRow[] = [];

  // Year built → era: locks and cameras.
  const era = byRole.get("profile:era");
  if (era) {
    const [condition, label] = halves(era.rule);
    const range = /\(([^)]+)\)/.exec(condition)?.[1] ?? condition;
    rows.push({
      id: "era",
      layer: "costar",
      field: era.field,
      value: String(era.value),
      rule: capitalise(range),
      result: `${label || capitalise(profile.era)}: ${LOCKS[profile.lockKind]}, ${CAMERAS[profile.cameraKind]}`,
    });
  }

  // Building class → guard force and tempo.
  const guards = byRole.get("profile:guardCount");
  if (guards) {
    const tempo = byRole.get("profile:patrolTempo");
    const tempoWords = tempo ? halves(tempo.rule)[1].split(",")[0] : "";
    rows.push({
      id: "guards",
      layer: "costar",
      field: guards.field,
      value: String(guards.value),
      rule: `Class ${guards.value} guard force`,
      result: [`${profile.guardCount} guards`, tempoWords].filter(Boolean).join(", "),
    });
  }

  // Available space → the staging floor and its quiet zones.
  const staging = byRole.get("level:stagingFloor");
  if (staging && staging.field === "availableSpace") {
    const [floorPart, detail] = String(staging.value).split(": ");
    const floor = /\d+/.exec(floorPart)?.[0] ?? floorPart;
    const quiet = manifest.zones.filter((z) => z.role === "quiet").map((z) => z.id.replace(/^quiet-/, ""));
    rows.push({
      id: "staging",
      layer: "costar",
      field: staging.field,
      value: floorPart,
      rule: detail ? `Most free space: ${detail}` : "Most free space of any floor",
      result:
        quiet.length > 0
          ? `Staged on ${floor}; ${quiet.length === 1 ? "suite" : "suites"} ${suiteRange(quiet)} are quiet zones`
          : `Staged on ${floor}`,
    });
  }

  // Floor area less the free space → the crowded zone.
  const crowdedZone = manifest.zones.find((z) => z.role === "crowded");
  const crowded = crowdedZone?.provenance[0];
  if (crowdedZone && crowded) {
    const occupied = /leaves (.+) occupied/.exec(halves(crowded.rule)[0])?.[1];
    const effect = crowdedZone.rule.split(": ").slice(1).join(": ") || crowdedZone.rule;
    rows.push({
      id: "crowded",
      layer: "costar",
      field: crowded.field,
      value: typeof crowded.value === "number" ? sf(crowded.value) : String(crowded.value),
      rule: occupied ? `${occupied} of it occupied` : "The occupied rest of the floor",
      result: `Crowded zone: ${effect.replace(/ if they see you$/, "")}`,
    });
  }

  // The aerial's dock tag → the way in and out. The level offers the other
  // tags too and the briefing names them; the table keeps to the five rules
  // that fit beside the briefing at 1440×900. The field and value are the
  // recorded provenance (`entries.kind` = `dock`), never the entry's id, and
  // the result is the recorded rule's own words.
  const dock = manifest.entries.find((e) => e.kind === "dock" && byRole.has(`entry:${e.id}`));
  const dockWhy = dock ? byRole.get(`entry:${dock.id}`) : undefined;
  if (dock && dockWhy) {
    rows.push({
      id: "dock",
      layer: "vexcel",
      field: dockWhy.field,
      value: String(dockWhy.value),
      rule: `${dock.label} on the aerial`,
      result: entryEffect(dockWhy.rule),
    });
  }

  return rows;
}
