import type { Building } from "@/domain";

/** What the map shows of a building: its CoStar record's map fields, and whether it can be played yet. */
export type MapBuilding = Pick<
  Building,
  "id" | "name" | "city" | "neighbourhood" | "lat" | "lng" | "yearBuilt" | "buildingClass" | "stories" | "layers" | "source"
> & {
  /** False until the building has a level (src/lib/levels.ts); the map shows it as "Level in prep" (a kit building: "Facts only"). */
  levelReady: boolean;
};

export function toMapBuilding(building: Building, levelReady: boolean): MapBuilding {
  const { id, name, city, neighbourhood, lat, lng, yearBuilt, buildingClass, stories, layers, source } = building;
  return { id, name, city, neighbourhood, lat, lng, yearBuilt, buildingClass, stories, layers, source, levelReady };
}
