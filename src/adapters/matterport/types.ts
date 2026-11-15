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
   *
   * `signal` aborts when the caller stops waiting (it left the screen, or took
   * the stand-in floor plan). The call then rejects; that is not a failure of
   * the scan, and nothing reports it as one. A live read under way goes on for
   * the next screen to take; taking the stand-in floor plan stops it.
   */
  loadFloor(building: Pick<Building, "id" | "matterportModelId">, signal?: AbortSignal): Promise<FloorGraph | null>;
}
