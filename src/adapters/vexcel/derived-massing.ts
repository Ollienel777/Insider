// A simple massing for a building with no hand-made one: a CoStar kit
// building has coordinates and a size but no fixture footprint, so live
// Vexcel would have nowhere to aim. The CoStar point is the centre, a
// north-up square wide enough for a slab of the typical floor's area is the
// footprint, and the stories give the height. Nothing in CoStar's data marks
// a dock or a door, so the massing pins only the two ways in every office
// building has, the level's own (issue 230): the roof hatch on the roof at
// the CoStar point, and the street lobby at ground level on the south face of
// the floor's own square. Each note says it is placed by rule, not seen on
// the aerial, and the level rules read them as theirs. It is only ever an aim
// for live Vexcel, inside `massingFor`: live answers carry `source: "vexcel"`,
// and a kit building with no imagery gets no aerial, so this massing (and its
// `source: "fixture"`) never reaches a screen, and fake mode is unchanged.
import { Aerial, type Building } from "@/domain";
import { M_PER_DEG_LAT, mPerDegLng } from "./mapping";

/** Square metres in a square foot. */
const M2_PER_SF = 0.09290304;
/** Metres per storey, floor to floor: a commercial building's typical 4 m. */
export const M_PER_STOREY = 4;
/**
 * How much wider than the floor's own square the footprint is. CoStar gives
 * no shape or heading, so the footprint spans the long side of a 3:1 slab of
 * the floor's area, whichever way it runs; the ortho then frames all of it.
 */
export const SHAPE_SLACK = Math.sqrt(3);
/**
 * The footprint's side is held between these, in metres, so one mis-entered
 * area (a typical floor holding the whole building's, or a few square feet)
 * cannot ask Vexcel for a kilometre-wide frame or a point.
 */
export const MIN_SIDE_M = 15;
export const MAX_SIDE_M = 300;

/** What the derivation reads, each possibly absent. */
export type MassingFacts = {
  [K in "lat" | "lng" | "stories" | "typicalFloorSf" | "rbaSf"]?: Building[K] | null;
};

const positive = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/**
 * The building's massing from its CoStar facts, or `null` when they cannot
 * place it: no coordinates, no stories, or no floor area. The footprint's
 * side is the square root of the typical floor's area (the building's area
 * over its stories when CoStar gives no typical floor), in metres, times
 * `SHAPE_SLACK` and held between `MIN_SIDE_M` and `MAX_SIDE_M`; the height is
 * the stories at `M_PER_STOREY` each. It is marked `derived`.
 */
export function deriveMassing(facts: MassingFacts): Aerial | null {
  const { lat, lng, stories, typicalFloorSf, rbaSf } = facts;
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) >= 90 || Math.abs(lng) > 180 || !positive(stories)) return null;
  const floorSf = positive(typicalFloorSf) ? typicalFloorSf : positive(rbaSf) ? rbaSf / stories : null;
  if (!floorSf) return null;

  const side = Math.min(MAX_SIDE_M, Math.max(MIN_SIDE_M, Math.sqrt(floorSf * M2_PER_SF) * SHAPE_SLACK));
  const half = side / 2;
  const dLng = half / mPerDegLng(lat);
  const dLat = half / M_PER_DEG_LAT;
  return Aerial.parse({
    // The views a massing is rendered at, as the fixtures have them; live Vexcel replaces them with its imagery.
    views: [
      { dir: "N", width: 1600, height: 1000 },
      { dir: "E", width: 1600, height: 1000 },
      { dir: "S", width: 1600, height: 1000 },
      { dir: "W", width: 1600, height: 1000 },
      { dir: "ortho", width: 1200, height: 1200 },
    ],
    entries: [
      {
        id: "roof",
        kind: "roof",
        label: "Roof hatch",
        view: "ortho",
        at: { lngLat: [lng, lat], elevM: stories * M_PER_STOREY },
        note: "Placed by rule, not seen on the aerial: every office building has a roof hatch, and the level offers it as a way in and out. Pinned at the building's CoStar point.",
      },
      {
        id: "lobby",
        kind: "lobby",
        label: "Street lobby",
        view: "ortho",
        at: { lngLat: [lng, lat - half / SHAPE_SLACK / M_PER_DEG_LAT], elevM: 0 },
        note: "Placed by rule, not seen on the aerial: every office building has a street lobby, with a desk guard. CoStar does not say which side faces the street, so it is pinned on the south face.",
      },
    ],
    footprint: [
      [lng - dLng, lat + dLat],
      [lng + dLng, lat + dLat],
      [lng + dLng, lat - dLat],
      [lng - dLng, lat - dLat],
    ],
    heightM: stories * M_PER_STOREY,
    source: "fixture",
    derived: true,
  });
}
