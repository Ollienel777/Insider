"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import { useMissionId } from "@/lib/use-mission-id";
import { StepRailView } from "./step-rail-view";

/**
 * The step rail under the top bar on `/b/[id]/*`; reads the current step and
 * mission from the route. A kit building is facts only until its level is
 * built for the mission in the address (`builtMissions`, #93).
 */
export function StepRail({
  buildingId,
  factsOnly = false,
  builtMissions = [],
}: {
  buildingId: string;
  factsOnly?: boolean;
  builtMissions?: string[];
}) {
  const segment = useSelectedLayoutSegment();
  const missionId = useMissionId();
  const built = missionId !== null && builtMissions.includes(missionId);
  return <StepRailView buildingId={buildingId} current={segment} missionId={missionId} factsOnly={factsOnly && !built} />;
}
