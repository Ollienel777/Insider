import { getCoStar } from "@/adapters/costar";
import { FIXTURE_INVENTORY } from "@/adapters/costar/fake";
import { MISSIONS } from "@/agents/builder/missions";
import { CASTING_DIR, liveCastingDir, readCachedCasting } from "@/agents/casting/cache";
import { CastScreen } from "@/components/cast/cast-screen";
import { CastUnavailable } from "@/components/cast/cast-unavailable";
import { castPins } from "@/components/cast/pins";
import { AppShell } from "@/components/shell/app-shell";
import type { CastingResult } from "@/domain";
import { findBuilding } from "@/lib/building";
import { forcedServices } from "@/lib/forced-server";

// The cast screen (SPEC §2 beat 2): the mission's cached shortlist and the
// trace the Casting Director recorded, read straight from the cache GET
// /api/cast/[missionId] serves (a live shortlist first when CoStar is live),
// so this beat never waits on a model. The pins and which filter drops each
// are worked out here, so the inventory never reaches the browser.
export default async function CastPage({ params }: { params: Promise<{ missionId: string }> }) {
  const { missionId } = await params;
  return <AppShell>{await Cast({ missionId })}</AppShell>;
}

async function Cast({ missionId }: { missionId: string }) {
  const mission = MISSIONS.find((m) => m.id === missionId);
  if (!mission) return <CastUnavailable missionId={missionId} reason="unknown" />;

  const forced = (await forcedServices()).has("costar");
  const dirs = getCoStar({ forced }).mode === "live" ? [liveCastingDir(), CASTING_DIR] : [CASTING_DIR];
  let result: CastingResult | null;
  try {
    result = await readCachedCasting(mission.id, dirs);
  } catch (error) {
    console.error(`/m/${mission.id}/cast: ${error instanceof Error ? error.message : String(error)}`);
    return <CastUnavailable missionId={mission.id} title={mission.title} reason="invalid" />;
  }
  if (!result) return <CastUnavailable missionId={mission.id} title={mission.title} reason="missing" />;

  const { pins } = castPins(result, mission, result.source === "fixture" ? FIXTURE_INVENTORY : []);
  // A finalist can be scouted when it has building pages: the five fixture
  // buildings today. The others show their card and "Level in prep" (SPEC §7).
  const scoutable = (
    await Promise.all(result.finalists.map(async (c) => ((await findBuilding(c.id).catch(() => null)) ? c.id : null)))
  ).filter((id): id is string => id !== null);
  // The browser needs the trace's rows, not what each tool read and returned.
  const events = result.trace.events.map(({ atMs, kind, agent, label, status, durationMs }) =>
    durationMs === undefined ? { atMs, kind, agent, label, status } : { atMs, kind, agent, label, status, durationMs },
  );
  const trace = { ...result.trace, events };

  return (
    <CastScreen
      mission={{ id: mission.id, title: mission.title, city: mission.city, type: mission.type }}
      result={{ ...result, trace }}
      pins={pins}
      scoutable={scoutable}
    />
  );
}
