// The rules table (SPEC §4.3, D12): CoStar's fields and Vexcel's entry tags,
// turned deterministically into the level's security profile, staging floor,
// zones and entries. Every output carries a provenance entry naming the
// layer, field and value it was read from and the rule that turned it into
// the output, which is what the dossier's Data → Level table and the Why card
// (#21) show. The Level Builder calls this as its `derive_security_profile`
// tool (#14), and the placer (#15) maps its roles onto the floor.
//
// Pure: no I/O, no clock, no randomness. The same building and aerial always
// give the same result, and the inputs are never mutated.
import type {
  Aerial,
  AerialEntry,
  AvailableSpace,
  Building,
  BuildingClass,
  CameraKind,
  EntryKind,
  Era,
  LevelEntry,
  LockKind,
  Provenance,
  SecurityProfile,
  Zone,
} from "@/domain";

/** What the rules table derives for one building. */
export interface SecurityDerivation {
  securityProfile: SecurityProfile;
  /** The floor the level is staged on. */
  stagingFloor: number;
  /** Quiet zones (available suites), one crowded zone (the occupied rest) and the secure zone. */
  zones: Zone[];
  /** Every Vexcel tag as an entry candidate, the dock and the roof first. */
  entries: LevelEntry[];
  /**
   * One or more entries for every output: `profile:<field>` for each
   * security-profile field, `level:stagingFloor`, `guard:G<n>`,
   * `camera:C<n>`, `zone:<id>` and `entry:<id>`.
   */
  provenance: Provenance[];
}

// ---- the table's values (initial values; D12 owns them) ---------------------

interface EraRule {
  era: Era;
  label: string;
  /** First year built that falls in this era. */
  from: number;
  lockKind: LockKind;
  lockRule: string;
  cameraKind: CameraKind;
  cameraRule: string;
  cameraCount: number;
  /** What guards the secure zone in this era. */
  secureRule: string;
}

/** Newest first, so the first rule whose `from` the year reaches is the era. */
const ERAS: readonly EraRule[] = [
  {
    era: "smart",
    label: "Smart era",
    from: 2015,
    lockKind: "badge-pin",
    lockRule: "badge plus PIN readers; doors held open raise an alarm",
    cameraKind: "ip-analytics",
    cameraRule: "IP cameras with analytics: a sighting raises the alarm one extra step",
    cameraCount: 5,
    secureRule: "badge plus PIN door with a door-held alarm",
  },
  {
    era: "networked",
    label: "Networked era",
    from: 2000,
    lockKind: "prox",
    lockRule: "prox badge readers",
    cameraKind: "fixed-ip",
    cameraRule: "fixed IP cameras",
    cameraCount: 4,
    secureRule: "prox reader door with motion sensors inside",
  },
  {
    era: "card",
    label: "Card and coax era",
    from: 1980,
    lockKind: "magstripe",
    lockRule: "magstripe readers: needs a cloned card, found in the level",
    cameraKind: "ptz",
    cameraRule: "PTZ cameras on a 3-turn cycle",
    cameraCount: 3,
    secureRule: "magstripe reader door",
  },
  {
    era: "analog",
    label: "Analog era",
    from: Number.NEGATIVE_INFINITY,
    lockKind: "key",
    lockRule: "key locks, pickable in 2 turns",
    cameraKind: "analog-sweep",
    cameraRule: "analog CCTV that sweeps, covering alternate halves each turn",
    cameraCount: 2,
    secureRule: "keyed door, pickable in 2 turns",
  },
];

interface ClassRule {
  guardCount: number;
  /** Turns per guard hop: 1 is the tightest round. */
  patrolTempo: number;
  tempoRule: string;
}

const CLASSES: Readonly<Record<BuildingClass, ClassRule>> = {
  A: { guardCount: 4, patrolTempo: 1, tempoRule: "tight rounds, one hop a turn" },
  B: { guardCount: 3, patrolTempo: 1, tempoRule: "tight rounds, one hop a turn" },
  C: { guardCount: 2, patrolTempo: 2, tempoRule: "slow rounds, one hop every 2 turns" },
};

/** Entry kinds the level always offers, in this order, ahead of the rest. */
const ALWAYS_OFFERED: readonly EntryKind[] = ["dock", "roof"];

/** The entries offered when no aerial tags any: the roof (always offered) and the street lobby. */
const NO_AERIAL_ENTRIES: readonly LevelEntry[] = [
  { id: "roof", kind: "roof", label: "Roof hatch" },
  { id: "lobby", kind: "lobby", label: "Street lobby" },
];

const ENTRY_RULES: Readonly<Record<EntryKind, string>> = {
  dock: "a loading dock is always offered as a way in and out",
  roof: "the roof is always offered as a way in and out",
  lobby: "the lobby is a way in, and it carries a desk guard from the guard force",
  garage: "a garage is a way in and out",
  service: "a service door is a way in and out",
};

// ---- helpers ----------------------------------------------------------------

const ordinal = (n: number): string => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
};

/** "3,412 sf". Grouped by hand, so the text does not depend on the runtime's locale data. */
const sf = (n: number): string => `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} sf`;

/** The era a year built falls in (SPEC §4.3: <1980, 1980–1999, 2000–2014, ≥2015). */
export function eraFor(yearBuilt: number): Era {
  return eraRule(yearBuilt).era;
}

function eraRule(yearBuilt: number): EraRule {
  // The last rule starts at -Infinity, so one always matches.
  return ERAS.find((rule) => yearBuilt >= rule.from) ?? ERAS[ERAS.length - 1];
}

function eraRange(rule: EraRule): string {
  const i = ERAS.indexOf(rule);
  const next = i > 0 ? ERAS[i - 1] : undefined;
  if (rule.from === Number.NEGATIVE_INFINITY) return `before ${next?.from}`;
  if (!next) return `${rule.from} or later`;
  return `${rule.from}–${next.from - 1}`;
}

interface FloorVacancy {
  floor: number;
  sf: number;
  suites: AvailableSpace[];
}

/**
 * The floor with the most available area. A tie goes to the lower floor, so
 * the result does not depend on the order CoStar lists the suites in.
 */
function quietestFloor(space: readonly AvailableSpace[]): FloorVacancy | null {
  const floors = new Map<number, FloorVacancy>();
  for (const suite of space) {
    const floor = floors.get(suite.floor) ?? { floor: suite.floor, sf: 0, suites: [] };
    floor.sf += suite.sf;
    floor.suites.push(suite);
    floors.set(suite.floor, floor);
  }
  let best: FloorVacancy | null = null;
  for (const floor of floors.values()) {
    if (!best || floor.sf > best.sf || (floor.sf === best.sf && floor.floor < best.floor)) best = floor;
  }
  return best;
}

// ---- the table --------------------------------------------------------------

/**
 * Derives the level's security from the building's CoStar record and its
 * Vexcel aerial (null when Vexcel has none, which offers no entries).
 */
export function deriveSecurityProfile(building: Building, aerial: Aerial | null): SecurityDerivation {
  const provenance: Provenance[] = [];
  const costar = (elementRole: string, field: string, value: Provenance["value"], rule: string): Provenance => {
    const entry: Provenance = { elementRole, layer: "costar", field, value, rule };
    provenance.push(entry);
    return entry;
  };

  // Era, from year built: locks, cameras and their number.
  const year = building.yearBuilt;
  const era = eraRule(year);
  const eraWhy = `Built ${year} (${eraRange(era)}) → ${era.label}`;
  costar("profile:era", "yearBuilt", year, eraWhy);
  costar("profile:lockKind", "yearBuilt", year, `${eraWhy}: ${era.lockRule}`);
  costar("profile:cameraKind", "yearBuilt", year, `${eraWhy}: ${era.cameraRule}`);
  costar("profile:cameraCount", "yearBuilt", year, `${eraWhy}: ${era.cameraCount} cameras on the staged floor`);
  for (let n = 1; n <= era.cameraCount; n++) {
    costar(`camera:C${n}`, "yearBuilt", year, `${eraWhy}: camera ${n} of ${era.cameraCount}, ${era.cameraRule}`);
  }

  // Guard force, from building class.
  const cls = building.buildingClass;
  const force = CLASSES[cls];
  const classWhy = `Class ${cls}`;
  costar("profile:guardCount", "buildingClass", cls, `${classWhy} → ${force.guardCount} guards`);
  costar("profile:patrolTempo", "buildingClass", cls, `${classWhy} → ${force.tempoRule}`);
  for (let n = 1; n <= force.guardCount; n++) {
    costar(
      `guard:G${n}`,
      "buildingClass",
      cls,
      `${classWhy} → ${force.guardCount} guards; the ${ordinal(n)} guard comes from Class ${cls}`,
    );
  }

  // Staging floor, from available space across floors.
  const quiet = quietestFloor(building.availableSpace);
  const stagingFloor = quiet ? quiet.floor : Math.ceil(building.stories / 2);
  if (quiet) {
    costar(
      "level:stagingFloor",
      "availableSpace",
      `floor ${quiet.floor}: ${sf(quiet.sf)} in ${quiet.suites.length} suites`,
      `Floor ${quiet.floor} has the most available area, so it is the quietest night: the level is staged there`,
    );
  } else {
    costar(
      "level:stagingFloor",
      "stories",
      building.stories,
      `No space is available, so the level is staged on the middle floor of ${building.stories}`,
    );
  }

  // Zones on the staging floor: each available suite is quiet, the rest is crowded.
  const zones: Zone[] = [];
  const suites = [...(quiet?.suites ?? [])].sort((a, b) => a.suite.localeCompare(b.suite, "en", { numeric: true }));
  for (const suite of suites) {
    const id = `quiet-${suite.suite}`;
    const rule = "Available suite: dark, unpatrolled, sound carries 1 node further";
    zones.push({
      id,
      name: `Suite ${suite.suite} (vacant)`,
      role: "quiet",
      rule,
      provenance: [
        costar(
          `zone:${id}`,
          "availableSpace",
          `suite ${suite.suite}, ${sf(suite.sf)}`,
          `Suite ${suite.suite} on floor ${suite.floor} is available → quiet zone: ${rule.toLowerCase()}`,
        ),
      ],
    });
  }

  const occupiedSf = building.typicalFloorSf - (quiet?.sf ?? 0);
  if (occupiedSf > 0) {
    const id = `crowded-${stagingFloor}`;
    const rule = "Occupied space: night cleaners raise Suspicious if they see you";
    zones.push({
      id,
      name: `Occupied floor ${stagingFloor}`,
      role: "crowded",
      rule,
      provenance: [
        costar(
          `zone:${id}`,
          "typicalFloorSf",
          building.typicalFloorSf,
          `A ${sf(building.typicalFloorSf)} floor with ${sf(quiet?.sf ?? 0)} available leaves ${sf(occupiedSf)} occupied → crowded zone: night cleaners raise Suspicious if they see you`,
        ),
      ],
    });
  }

  zones.push({
    id: "secure",
    name: "Secure room",
    role: "secure",
    rule: `${era.label}: ${era.secureRule}`,
    provenance: [costar("zone:secure", "yearBuilt", year, `${eraWhy}: the secure room has a ${era.secureRule}`)],
  });

  // Entries, from the aerial's tags: the dock and the roof first, then the rest as tagged.
  const tags: readonly AerialEntry[] = aerial?.entries ?? [];
  const rank = (kind: EntryKind): number => {
    const i = ALWAYS_OFFERED.indexOf(kind);
    return i === -1 ? ALWAYS_OFFERED.length : i;
  };
  const entries: LevelEntry[] = tags
    .map((tag, i) => ({ tag, i }))
    .sort((a, b) => rank(a.tag.kind) - rank(b.tag.kind) || a.i - b.i)
    .map(({ tag }) => {
      provenance.push({
        elementRole: `entry:${tag.id}`,
        layer: "vexcel",
        field: "entries.kind",
        value: tag.kind,
        rule: `The aerial tags "${tag.label}" (${tag.kind}): ${ENTRY_RULES[tag.kind]}`,
      });
      return { id: tag.id, kind: tag.kind, label: tag.label };
    });
  // No tagged entries on a CoStar kit building (#93): it has no aerial when
  // Vexcel has no coverage, and live imagery aimed from a massing derived
  // from its CoStar facts (`derived`) tags none, since nothing in them marks
  // a dock. A level needs a way in, so the rules offer the two every office
  // building has, the roof and the street lobby. Only then: a fixture always
  // has its hand-made massing, and a degraded live aerial for one must still
  // fail the build.
  const untagged = aerial ? aerial.derived === true : building.source === "costar";
  if (entries.length === 0 && untagged) {
    for (const entry of NO_AERIAL_ENTRIES) {
      provenance.push({
        elementRole: `entry:${entry.id}`,
        layer: "fiction",
        field: "entries.kind",
        value: entry.kind,
        rule: `${aerial ? "Nothing in CoStar's facts marks a way in" : "No Vexcel aerial answered with this building's ways in"}, so the rules offer its ${entry.label.toLowerCase()}: ${ENTRY_RULES[entry.kind]}`,
      });
      entries.push({ ...entry });
    }
  }

  const securityProfile: SecurityProfile = {
    era: era.era,
    guardCount: force.guardCount,
    patrolTempo: force.patrolTempo,
    cameraKind: era.cameraKind,
    cameraCount: era.cameraCount,
    lockKind: era.lockKind,
  };

  return { securityProfile, stagingFloor, zones, entries, provenance };
}
