// A stand-in for the fixture buildings until the CoStar adapter and fixtures
// (#6) land: just enough for the top bar's building slot and the placeholder
// screens. Values are SPEC §7's fixture table. Replace the lookup with the
// adapter's, then delete this file.

export interface BuildingStub {
  id: string;
  name: string;
  city: "Los Angeles" | "Houston";
  neighbourhood: string;
  yearBuilt: number;
  buildingClass: "A" | "B" | "C";
  stories: number;
}

export const BUILDING_STUBS: readonly BuildingStub[] = [
  { id: "F1", name: "Halvorsen Tower", city: "Los Angeles", neighbourhood: "Bunker Hill", yearBuilt: 1974, buildingClass: "A", stories: 42 },
  { id: "F2", name: "Figueroa Exchange", city: "Los Angeles", neighbourhood: "Financial District", yearBuilt: 1989, buildingClass: "A", stories: 52 },
  { id: "F3", name: "Meridian on Wilshire", city: "Los Angeles", neighbourhood: "Westlake", yearBuilt: 2017, buildingClass: "A", stories: 30 },
  { id: "F4", name: "Smith Street Center", city: "Houston", neighbourhood: "Downtown", yearBuilt: 1983, buildingClass: "A", stories: 50 },
  { id: "F5", name: "Westchase Commons", city: "Houston", neighbourhood: "Westchase", yearBuilt: 2008, buildingClass: "B", stories: 6 },
];

export function findBuildingStub(id: string): BuildingStub | undefined {
  return BUILDING_STUBS.find((building) => building.id === id);
}
