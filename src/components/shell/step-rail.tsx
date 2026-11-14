"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import { useMissionId } from "@/lib/use-mission-id";
import { StepRailView } from "./step-rail-view";

/** The step rail under the top bar on `/b/[id]/*`; reads the current step from the route. */
export function StepRail({ buildingId, factsOnly = false }: { buildingId: string; factsOnly?: boolean }) {
  const segment = useSelectedLayoutSegment();
  return <StepRailView buildingId={buildingId} current={segment} missionId={useMissionId()} factsOnly={factsOnly} />;
}
