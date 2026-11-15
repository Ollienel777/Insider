"use client";

// The folder tabs remember how far you got (issue 166): once you have opened a
// tab for a mission and its building, it stays open, so you can go back to any
// tab, even from the mission picker, which on its own knows no mission or
// building. The memory lives in this module only, like a kit building's crew
// plan (#95): it carries over every move between tabs, nothing is stored, and a
// full reload starts the tabs over. Picking another mission or building starts
// them over too.
import { useEffect, useState } from "react";
import { RAIL_TABS, reachedIndex, StepRailView } from "./step-rail-view";

export interface RailProgress {
  missionId: string | null;
  buildingId: string | null;
  factsOnly: boolean;
  /** The furthest tab opened, as its index in RAIL_TABS. */
  reached: number;
}

let progress: RailProgress | null = null;

/** Records the tab on screen and returns the progress so far. Only a tab of the rail counts: Owner Mode and Drill don't. */
export function recordTab(at: {
  current: string | null;
  missionId: string | null;
  buildingId: string | null;
  factsOnly: boolean;
}): RailProgress | null {
  if (!RAIL_TABS.some((t) => t.tab === at.current)) return progress;
  const reached = reachedIndex(at.current, at.buildingId);
  const sameMission = at.missionId === null || at.missionId === progress?.missionId;
  const sameBuilding = at.buildingId === null || at.buildingId === progress?.buildingId;
  if (!progress || !sameMission) {
    progress = { missionId: at.missionId, buildingId: at.buildingId, factsOnly: at.factsOnly, reached };
  } else if (!sameBuilding) {
    progress = { ...progress, buildingId: at.buildingId, factsOnly: at.factsOnly, reached };
  } else {
    progress = {
      ...progress,
      ...(at.buildingId !== null && { factsOnly: at.factsOnly }),
      reached: Math.max(progress.reached, reached),
    };
  }
  return progress;
}

/** For tests: forget the progress. */
export function forgetTabs(): void {
  progress = null;
}

/**
 * `StepRailView` with the tabs you have opened kept open. The first paint is
 * the screen's own tabs, as the server drew them; the remembered ones open
 * right after.
 */
export function RememberedRailView({
  buildingId = null,
  current,
  missionId = null,
  factsOnly = false,
}: {
  buildingId?: string | null;
  current: string | null;
  missionId?: string | null;
  factsOnly?: boolean;
}) {
  const [memory, setMemory] = useState<RailProgress | null>(null);
  useEffect(() => {
    setMemory(recordTab({ current, missionId, buildingId, factsOnly }));
  }, [current, missionId, buildingId, factsOnly]);
  // Use the memory only where it is about this mission and building.
  const fits = memory && (missionId === null || missionId === memory.missionId) && (buildingId === null || buildingId === memory.buildingId);
  if (!fits) return <StepRailView buildingId={buildingId} current={current} missionId={missionId} factsOnly={factsOnly} />;
  return (
    <StepRailView
      buildingId={buildingId ?? memory.buildingId}
      current={current}
      missionId={missionId ?? memory.missionId}
      factsOnly={buildingId !== null ? factsOnly : memory.factsOnly}
      reachedAtLeast={memory.reached}
    />
  );
}
