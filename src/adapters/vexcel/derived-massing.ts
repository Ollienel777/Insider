// A simple massing for a building with no hand-made one: a CoStar kit
// building has coordinates and a size but no fixture footprint, so live
// Vexcel would have nowhere to aim. The CoStar point is the centre, a
// north-up square of the typical floor's area is the footprint, and the
// stories give the height. Nothing in CoStar's data marks a dock or a door,
// so the massing tags no entries. It is only ever an aim for live Vexcel:
// the building is never drawn from it, so fake mode is unchanged.
import { Aerial, type Building } from "@/domain";

/** Square metres in a square foot. */
const M2_PER_SF = 0.09290304;
/** Metres per storey, floor to floor: a commercial building's typical 4 m. */
export const M_PER_STOREY = 4;

const M_PER_DEG_LAT = 111_132;
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

/** What the derivation reads, each possibly absent. */
export type MassingFacts = {
  [K in "lat" | "lng" | "stories" | "typicalFloorSf" | "rbaSf"]?: Building[K] | null;
};

const positive = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/**
 * The building's massing from its CoStar facts, or `null` when they cannot
 * place it: no coordinates, no stories, or no floor area. The footprint's
 * side is the square root of the typical floor's area (the building's area
 * over its stories when CoStar gives no typical floor), in metres; the
 * height is the stories at `M_PER_STOREY` each.
 */
export function deriveMassing(facts: MassingFacts): Aerial | null {
  const { lat, lng, stories, typicalFloorSf, rbaSf } = facts;
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) >= 90 || Math.abs(lng) > 180 || !positive(stories)) return null;
  const floorSf = positive(typicalFloorSf) ? typicalFloorSf : positive(rbaSf) ? rbaSf / stories : null;
  if (!floorSf) return null;

  const half = Math.sqrt(floorSf * M2_PER_SF) / 2;
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
    entries: [],
    footprint: [
      [lng - dLng, lat + dLat],
      [lng + dLng, lat + dLat],
      [lng + dLng, lat - dLat],
      [lng - dLng, lat - dLat],
    ],
    heightM: stories * M_PER_STOREY,
    source: "fixture",
  });
}
