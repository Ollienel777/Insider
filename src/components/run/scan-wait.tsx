"use client";

// What the board says while a live scan loads (issue 145). The Run and Plan
// boards hold a skeleton until the floor is in, and a scan can take most of a
// minute on a slow connection (issue 141). The skeleton says what it is waiting
// for, and after a while offers the stand-in floor plan, by the same switch as
// the demo settings: Matterport on fixtures, for this session. So the screens
// that follow do not wait for a scan either. On fixtures there is nothing to
// wait for, and nothing is drawn.
import { useEffect, useState, useSyncExternalStore } from "react";
import { releaseScanFloor, visibleTimeout, willLoadLive } from "@/adapters/matterport";
import { Button } from "@/components/ui/button";
import type { Building } from "@/domain";
import { getServerStatus, getStatus, setForced, subscribeStatus } from "@/lib/demo-status";

/** How long a scan may load before the stand-in floor plan is offered. On a fast connection the board is up by then. */
export const STAND_IN_AFTER_MS = 15_000;

/**
 * Whether a load of `building`'s floor on this page waits on its live scan,
 * as the adapter says (`willLoadLive`). Undefined on the server and until the
 * browser has its demo status: only the browser knows what is forced to
 * fixtures or has failed over.
 */
export function useWaitsOnScan(building: Pick<Building, "id" | "matterportModelId">, heistMode?: string): boolean | undefined {
  // The status is what changes the adapter's answer (forced, failed over), so a change draws this again.
  const status = useSyncExternalStore(subscribeStatus, getStatus, getServerStatus);
  return status.ready ? willLoadLive(building, heistMode) : undefined;
}

/**
 * Calls `onSlow` once the scan has been loading for `ms` with the page
 * showing: the same clock as the scan's own deadlines (`visibleTimeout`), so
 * time in a hidden tab, where the player stalls, does not count against it.
 * Returns the cancel.
 */
export function offerStandInAfter(onSlow: () => void, ms: number = STAND_IN_AFTER_MS): () => void {
  return visibleTimeout(onSlow, ms);
}

/**
 * Takes the stand-in floor plan: Matterport goes to fixtures for the session,
 * the scan board the tab holds is let go (its read stopped), then `reload`
 * loads the floor again, which now comes from the fixture floor.
 */
export function takeStandIn(reload: () => void, force: typeof setForced = setForced, release: () => void = releaseScanFloor): void {
  force("matterport", true);
  release();
  reload();
}

/** What the panel says: nothing yet (`mounting`), that the scan is loading, or that it is slow, with the way out. */
export type ScanWaitState = "mounting" | "loading" | "slow";

/**
 * The words over the board's skeleton. The status region is on the page
 * before its words (`mounting`), so a screen reader announces "Loading the
 * scan" as a change to a region it already knows.
 */
export function ScanWaitPanel({ state, onStandIn }: { state: ScanWaitState; onStandIn: () => void }) {
  return (
    <div
      data-testid="scan-wait"
      className="absolute inset-x-6 inset-y-0 flex flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <div role="status" className="flex flex-col items-center gap-3">
        {state === "mounting" ? null : <p className="label-caps text-text-2">Loading the scan</p>}
        {state === "slow" ? (
          <p className="max-w-md text-sm text-text-2">
            The scan is taking a while. The stand-in floor plan is ready now. To switch the scan back on, open the demo
            settings with Shift+?.
          </p>
        ) : null}
      </div>
      {state === "slow" ? (
        <Button data-testid="use-stand-in" onClick={onStandIn}>
          Use the stand-in floor plan
        </Button>
      ) : null}
    </div>
  );
}

/** One wait on one scan: it is mounted when the wait starts, so its clock starts with it. */
function Waiting({ onStandIn }: { onStandIn: () => void }) {
  const [state, setState] = useState<ScanWaitState>("mounting");
  useEffect(() => {
    const said = setTimeout(() => setState((s) => (s === "mounting" ? "loading" : s)), 0);
    const stop = offerStandInAfter(() => setState("slow"));
    return () => {
      clearTimeout(said);
      stop();
    };
  }, []);
  return <ScanWaitPanel state={state} onStandIn={() => takeStandIn(onStandIn)} />;
}

/**
 * Over the board's skeleton while `building`'s floor loads. `onStandIn` loads
 * the floor again: by then Matterport is forced to fixtures, so it comes from
 * the fixture floor at once, and the caller gives up the scan still on its way.
 */
export function ScanWait({
  building,
  heistMode,
  onStandIn,
}: {
  building: Pick<Building, "id" | "matterportModelId">;
  heistMode?: string;
  onStandIn: () => void;
}) {
  const waiting = useWaitsOnScan(building, heistMode);
  // Keyed by the building, and unmounted while nothing waits on a scan: each wait has its own clock.
  return waiting ? <Waiting key={building.id} onStandIn={onStandIn} /> : null;
}
