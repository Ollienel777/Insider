"use client";

import { BuildingScreen } from "@/components/shell/building-screen";
import { Button } from "@/components/ui/button";

/** The map when CoStar fails: what happened, and the one recovery action. */
export function MapError({ message }: { message: string }) {
  return (
    <BuildingScreen
      visualLabel="Map"
      visual={null}
      panel={
        <div data-testid="map-error" className="flex flex-col gap-2">
          <p className="label-caps text-danger">CoStar didn&apos;t answer</p>
          <h1 className="text-lg font-semibold text-text-1">The buildings couldn&apos;t load.</h1>
          <p className="font-mono text-sm break-words text-text-2">{message}</p>
        </div>
      }
      action={
        <Button variant="primary" onClick={() => window.location.reload()}>
          Retry
        </Button>
      }
    />
  );
}
