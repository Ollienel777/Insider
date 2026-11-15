// The one interface every Matterport implementation exports (SPEC §4.5).
// Browser only: import it from client components, never from server code
// (client-only.test.ts enforces this).
import type { Building, FloorGraph } from "@/domain";

export interface MatterportAdapter {
  /**
   * The board for `building`, or `null` when the building has no floor (no
   * fixture floor in fake mode, no `matterportModelId` in live mode).
   *
   * Live, the graph is read from the Showcase SDK once per scan and tab and
   * kept in the tab's memory (floor-hold.ts), and otherwise held only by the
   * caller: never sent to the server, persisted, or given to a model (SPEC §4.5).
   */
  loadFloor(building: Pick<Building, "id" | "matterportModelId">): Promise<FloorGraph | null>;
}
