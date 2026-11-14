// Who is on the drill floor, and where (SPEC §1, §2 beat 7): the headcount
// comes from CoStar's occupied area at 250 sf per person, and the occupants
// stand in the board's occupied rooms.
//
// Pure: no I/O, no clock, no randomness. The seed only rotates which of a
// room's nodes each occupant starts on.
import type { Building, FloorGraph, Provenance, Room } from "@/domain";
import { deriveSecurityProfile } from "@/level/rules";

/** Occupied floor area per person, in square feet (the ticket's headcount rule). */
export const SF_PER_PERSON = 250;

/**
 * Which floor the drill runs on: `"staged"` is the level's staged floor (the
 * one with the most available area, SPEC §4.3), `"busiest"` the floor with
 * the least available area (nearest the staged floor on a tie), or a floor
 * number.
 */
export type DrillFloorChoice = "staged" | "busiest" | number;

/**
 * The floor beat 7 drills. The spec's default is the staged floor; whether the
 * demo drills a busy floor instead is the builder's call, and switching is
 * this one line (`"busiest"`, or a floor number).
 */
export const DRILL_FLOOR: DrillFloorChoice = "staged";

/** A drill the inputs cannot describe: a floor the building does not have, a seed that is not an integer. */
export class DrillError extends Error {
  override name = "DrillError";
}

export interface Headcount {
  floor: number;
  /** How the floor was chosen. */
  choice: DrillFloorChoice;
  typicalFloorSf: number;
  /** Available (vacant) area CoStar lists on this floor. */
  availableSf: number;
  occupiedSf: number;
  sfPerPerson: number;
  /** `round(occupiedSf / sfPerPerson)`. */
  count: number;
  /** The sentence the report prints, with the numbers in it. */
  rule: string;
  provenance: readonly Provenance[];
}

const sf = (n: number) => `${Math.round(n).toLocaleString("en-US")} sf`;

function availableOn(building: Building, floor: number): number {
  return building.availableSpace.filter((s) => s.floor === floor).reduce((sum, s) => sum + s.sf, 0);
}

/** The floor number a choice names on this building. Throws `DrillError` on a floor it does not have. */
export function resolveDrillFloor(building: Building, choice: DrillFloorChoice): number {
  const staged = deriveSecurityProfile(building, null).stagingFloor;
  let floor: number;
  if (choice === "staged") floor = staged;
  else if (choice === "busiest") {
    floor = staged;
    let best = Infinity;
    for (let f = 1; f <= building.stories; f++) {
      const avail = availableOn(building, f);
      const nearer = Math.abs(f - staged) < Math.abs(floor - staged);
      if (avail < best || (avail === best && nearer)) {
        best = avail;
        floor = f;
      }
    }
  } else floor = choice;
  if (!Number.isInteger(floor) || floor < 1 || floor > building.stories) {
    throw new DrillError(`floor ${floor} is not a floor of ${building.name} (1–${building.stories})`);
  }
  return floor;
}

/** The headcount on a floor: its occupied area (typical floor less available) ÷ 250 sf, rounded. */
export function headcountFor(building: Building, choice: DrillFloorChoice = DRILL_FLOOR): Headcount {
  const floor = resolveDrillFloor(building, choice);
  const typicalFloorSf = building.typicalFloorSf;
  const availableSf = availableOn(building, floor);
  const occupiedSf = Math.max(0, typicalFloorSf - availableSf);
  const count = Math.round(occupiedSf / SF_PER_PERSON);
  const rule =
    `Floor ${floor}: a ${sf(typicalFloorSf)} floor with ${sf(availableSf)} available leaves ` +
    `${sf(occupiedSf)} occupied ÷ ${SF_PER_PERSON} sf per person = ${count} ${count === 1 ? "occupant" : "occupants"}`;
  const provenance: Provenance[] = [
    { elementRole: "drill:headcount", layer: "costar", field: "typicalFloorSf", value: typicalFloorSf, rule },
    { elementRole: "drill:headcount", layer: "costar", field: "availableSpace", value: availableSf, rule },
  ];
  return { floor, choice, typicalFloorSf, availableSf, occupiedSf, sfPerPerson: SF_PER_PERSON, count, rule, provenance };
}

// ---- where the occupants stand ---------------------------------------------

/** Rooms people pass through rather than work in: never given occupants. */
const CIRCULATION = /corridor|hall|lobby|stair|lift|elevator/i;
const SUITE_ROOM = /suite|office/i;

/** Suite units a room label names: "Suites 2202–2205" names units 2 to 5 (the last two digits). */
function unitsIn(label: string): number[] {
  const units = new Set<number>();
  for (const m of label.matchAll(/(\d+)(?:\s*[–-]\s*(\d+))?/g)) {
    const lo = Number(m[1]);
    const hi = Number(m[2] ?? m[1]);
    for (let n = lo; n <= hi && n - lo < 100; n++) units.add(n % 100);
  }
  return [...units].sort((a, b) => a - b);
}

export interface OccupiedRoom {
  roomId: string;
  label: string;
  /** Share of the room counted as occupied: its area times the fraction of its suites not available. */
  weight: number;
  count: number;
}

export interface Placement {
  /** Which rooms took the occupants: the occupied suites, or (with none on the board) the other non-circulation rooms. */
  basis: "occupied suites" | "other rooms" | "none";
  rooms: readonly OccupiedRoom[];
  occupants: readonly { id: string; roomId: string; nodeId: string }[];
  /** Occupants with no room to stand in (the board has no occupied room). */
  unplaced: readonly string[];
}

/**
 * The floor's occupied rooms and their share of the headcount. A suite room is
 * occupied in proportion to the suites it names that CoStar does not list as
 * available on the drill floor (units match by their last two digits, so one
 * typical-floor board serves every floor). With no occupied suite on the
 * board, the occupied area is the rest of the floor: the rooms that are
 * neither suites nor circulation.
 */
export function occupiedRooms(
  building: Building,
  floor: FloorGraph,
  floorNumber: number,
): { basis: Placement["basis"]; rooms: { room: Room; weight: number }[] } {
  const available = new Set(
    building.availableSpace
      .filter((s) => s.floor === floorNumber && /^\d+$/.test(s.suite))
      .map((s) => Number(s.suite) % 100),
  );
  const withNodes = new Set(floor.nodes.map((n) => n.roomId));
  const area = (r: Room) => r.rect.w * r.rect.h;
  const candidates = floor.rooms.filter((r) => withNodes.has(r.id) && !CIRCULATION.test(r.label));

  const suites = candidates
    .filter((r) => SUITE_ROOM.test(r.label))
    .map((room) => {
      const units = unitsIn(room.label);
      const occupied = units.length === 0 ? 1 : units.filter((u) => !available.has(u)).length / units.length;
      return { room, weight: area(room) * occupied };
    })
    .filter((r) => r.weight > 0);
  if (suites.length > 0) return { basis: "occupied suites", rooms: suites };

  const others = candidates.filter((r) => !SUITE_ROOM.test(r.label)).map((room) => ({ room, weight: area(room) }));
  if (others.length > 0) return { basis: "other rooms", rooms: others };
  return { basis: "none", rooms: [] };
}

/** FNV-1a over the seed and a key, then an avalanche: a stable 32-bit number. */
function hash(seed: number, key: string): number {
  let h = 0x811c9dc5 ^ (seed | 0);
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

/**
 * Splits `count` occupants over the occupied rooms by weight (largest
 * remainder, ties to the room listed first), then spreads each room's share
 * round the room's nodes, starting at a node the seed picks.
 */
export function placeOccupants(
  building: Building,
  floor: FloorGraph,
  floorNumber: number,
  count: number,
  seed: number,
): Placement {
  const { basis, rooms } = occupiedRooms(building, floor, floorNumber);
  const ids = Array.from({ length: count }, (_, i) => `P${String(i + 1).padStart(count >= 100 ? 3 : 2, "0")}`);
  if (rooms.length === 0) return { basis, rooms: [], occupants: [], unplaced: ids };

  const total = rooms.reduce((s, r) => s + r.weight, 0);
  const shares = rooms.map((r, i) => {
    const exact = (count * r.weight) / total;
    return { i, base: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  let left = count - shares.reduce((s, x) => s + x.base, 0);
  for (const x of [...shares].sort((a, b) => b.rest - a.rest || a.i - b.i)) {
    if (left-- <= 0) break;
    x.base += 1;
  }

  const occupants: { id: string; roomId: string; nodeId: string }[] = [];
  const placedRooms: OccupiedRoom[] = [];
  let next = 0;
  rooms.forEach(({ room, weight }, i) => {
    const n = shares[i].base;
    placedRooms.push({ roomId: room.id, label: room.label, weight, count: n });
    const nodes = floor.nodes.filter((node) => node.roomId === room.id).map((node) => node.id).sort();
    const offset = hash(seed, room.id) % nodes.length;
    for (let k = 0; k < n; k++) {
      occupants.push({ id: ids[next++], roomId: room.id, nodeId: nodes[(offset + k) % nodes.length] });
    }
  });
  return { basis, rooms: placedRooms, occupants, unplaced: [] };
}
