import type { Building } from "@/domain";
import type { DossierFact } from "./dossier-screen";

const grouped = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * The CoStar facts the dossier prints, picked field by field: the record's
 * physical facts only, so nothing about who occupies the building can reach
 * the screen (SPEC §1 taste rule; the Building type has no tenant fields).
 */
export function dossierFacts(building: Building): DossierFact[] {
  const available = building.availableSpace.reduce((sum, s) => sum + s.sf, 0);
  return [
    { label: "Built", value: String(building.yearBuilt) },
    { label: "Class", value: building.buildingClass },
    { label: "Stories", value: String(building.stories) },
    { label: "Floor", value: `${grouped(building.typicalFloorSf)} sf` },
    { label: "Available", value: `${grouped(available)} sf` },
  ];
}
