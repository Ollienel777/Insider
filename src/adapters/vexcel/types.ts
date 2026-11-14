// The one interface every Vexcel implementation exports (SPEC §4.5).
import type { Aerial, ViewDir } from "@/domain";

/** One view's image, held in memory only (SPEC §10). */
export interface AerialImage {
  bytes: ArrayBuffer;
  contentType: string;
}

export interface VexcelAdapter {
  /** The building's aerial: views, tagged entries, footprint and height; `null` for an unknown building. */
  getAerial(buildingId: string): Promise<Aerial | null>;
  /**
   * The image behind one of the aerial's views, for the image route to proxy;
   * `null` when that view has none (a massing is drawn, not fetched).
   */
  getImage(buildingId: string, dir: ViewDir): Promise<AerialImage | null>;
}
