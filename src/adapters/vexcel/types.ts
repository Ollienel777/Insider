// The one interface every Vexcel implementation exports (SPEC §4.5).
import type { Aerial } from "@/domain";

export interface VexcelAdapter {
  /** The building's aerial: views, tagged entries, footprint and height; `null` for an unknown building. */
  getAerial(buildingId: string): Promise<Aerial | null>;
}
