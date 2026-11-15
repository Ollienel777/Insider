"use client";

// What the board says while a live scan loads (issue 145). The Run and Plan
// boards hold a skeleton until the floor is in, and a scan can take most of a
// minute on a slow connection (issue 141). The skeleton says what it is waiting
// for, and after a while offers the stand-in floor plan, by the same switch as
// the demo settings: Matterport on fixtures, for this session. So the screens
// that follow do not wait for a scan either. On fixtures there is nothing to
// wait for, and nothing is drawn.
import { useEffect, useState, useSyncExternalStore } from "react";
import { getMatterport, scanModelId } from "@/adapters/matterport";
import { Button } from "@/components/ui/button";
import type { Building } from "@/domain";
import { getServerStatus, getStatus, setForced, subscribeStatus, type DemoStatus } from "@/lib/demo-status";
import type { ServiceMode } from "@/lib/mode";

/** How long a scan may load before the stand-in floor plan is offered. On a fast connection the board is up by then. */
export const STAND_IN_AFTER_MS = 15_000;

/**
 * Whether a floor that is loading is the building's live scan: this browser
 * has its demo status, Matterport is live on the page and has not fallen
 * back, and the building has a scan. Forced to fixtures, `mode` is not live.
 */
export function waitsOnScan(status: Pick<DemoStatus, "ready" | "fellBack">, mode: ServiceMode, modelId: string | undefined): boolean {
  return status.ready && mode === "live" && !status.fellBack.has("matterport") && Boolean(modelId);
}

/**
 * Whether a load of `building`'s floor on this page waits on its live scan.
 * False on the server, and until the browser has its demo status.
 */
export function useWaitsOnScan(building: Pick<Building, "id" | "matterportModelId">, heistMode?: string): boolean {
  const status = useSyncExternalStore(subscribeStatus, getStatus, getServerStatus);
  // The adapter is asked only once the browser has its status: on the server there is nothing to wait for.
  return status.ready && waitsOnScan(status, getMatterport(heistMode).mode, scanModelId(building));
}

/** The words over the board's skeleton: what it is waiting for and, once the wait is `slow`, the way out. */
export function ScanWaitPanel({ slow, onStandIn }: { slow: boolean; onStandIn: () => void }) {
  return (
    <div
      data-testid="scan-wait"
      className="absolute inset-x-6 inset-y-0 flex flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <div role="status" className="flex flex-col items-center gap-3">
        <p className="label-caps text-text-2">Loading the scan</p>
        {slow ? (
          <p className="max-w-md text-sm text-text-2">
            The scan is taking a while. The stand-in floor plan is ready now. To switch the scan back on, open the demo
            settings with Shift+?.
          </p>
        ) : null}
      </div>
      {slow ? (
        <Button data-testid="use-stand-in" onClick={onStandIn}>
          Use the stand-in floor plan
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Over the board's skeleton while `building`'s floor loads. `onStandIn` loads
 * the floor again: by then Matterport is forced to fixtures, so it comes from
 * the fixture floor at once, and the scan still on its way is left behind.
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
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), STAND_IN_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!waiting) return null;
  return (
    <ScanWaitPanel
      slow={slow}
      onStandIn={() => {
        setForced("matterport", true);
        onStandIn();
      }}
    />
  );
}
