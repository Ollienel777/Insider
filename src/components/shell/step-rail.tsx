"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import { StepRailView } from "./step-rail-view";

/** The step rail under the top bar on `/b/[id]/*`; reads the current step from the route. */
export function StepRail({ buildingId }: { buildingId: string }) {
  const segment = useSelectedLayoutSegment();
  return <StepRailView buildingId={buildingId} current={segment} />;
}
