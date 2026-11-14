import { notFound } from "next/navigation";
import { getCoStar } from "@/adapters/costar";
import { FIXTURE_INVENTORY } from "@/adapters/costar/fake";
import { FIXTURE_AERIALS } from "@/adapters/vexcel/fake";
import { MISSIONS } from "@/agents/builder/missions";
import { CASTING_DIR, CastingReadError, liveCastingDir, readCachedCasting } from "@/agents/casting/cache";
import { CastScreen } from "@/components/cast/cast-screen";
import { CastUnavailable } from "@/components/cast/cast-unavailable";
import { castPins } from "@/components/cast/pins";
import { castThumbnails, clientTrace } from "@/components/cast/props";
import { AppShell } from "@/components/shell/app-shell";
import { FallbackReport } from "@/components/shell/demo-safety";
import type { CastingResult } from "@/domain";
import { findBuilding } from "@/lib/building";
import { forcedServices } from "@/lib/forced-server";
import { showcaseCast } from "@/lib/showcase-cast";

// The cast screen (SPEC §2 beat 2): the mission's cached shortlist and the
// trace the Casting Director recorded, read the way GET /api/cast/[missionId]
// reads it (a live shortlist first when CoStar is live, falling through to
// data/casting/ when the state dir cannot be read), so this beat never waits
// on a model. The pins and which filter drops each are worked out here, so
// the inventory never reaches the browser. An unknown mission is a 404.
export default async function CastPage({ params }: { params: Promise<{ missionId: string }> }) {
  const { missionId } = await params;
  const mission = MISSIONS.find((m) => m.id === missionId);
  if (!mission) notFound();
  return <AppShell>{await Cast({ mission })}</AppShell>;
}

async function readShortlist(missionId: string, live: boolean): Promise<CastingResult | null> {
  if (live) {
    try {
      const result = await readCachedCasting(missionId, [liveCastingDir()]);
      if (result) return result;
    } catch (error) {
      if (!(error instanceof CastingReadError)) throw error;
      console.error(`/m/${missionId}/cast: the live shortlist cannot be read (${error.code}); using data/casting/`);
    }
  }
  return readCachedCasting(missionId, [CASTING_DIR]);
}

async function Cast({ mission }: { mission: (typeof MISSIONS)[number] }) {
  const forced = (await forcedServices()).has("costar");
  const costar = getCoStar({ forced });
  const fallback = <FallbackReport fallback={costar.fallback} />;

  let result: CastingResult | null;
  try {
    result = await readShortlist(mission.id, costar.mode === "live");
  } catch (error) {
    console.error(`/m/${mission.id}/cast: ${error instanceof Error ? error.message : String(error)}`);
    const reason = error instanceof CastingReadError || error instanceof SyntaxError ? "unreadable" : "invalid";
    return (
      <>
        {fallback}
        <CastUnavailable missionId={mission.id} title={mission.title} reason={reason} />
      </>
    );
  }
  if (!result) {
    return (
      <>
        {fallback}
        <CastUnavailable missionId={mission.id} title={mission.title} reason="missing" />
      </>
    );
  }

  const { pins } = castPins(result, mission, result.source === "fixture" ? FIXTURE_INVENTORY : []);
  // A finalist can be scouted when it has building pages: the five fixture
  // buildings today. The others show their card and "Level in prep" (SPEC §7).
  const scoutable = (
    await Promise.all(result.finalists.map(async (c) => ((await findBuilding(c.id).catch(() => null)) ? c.id : null)))
  ).filter((id): id is string => id !== null);
  // Live, a mission on the showcase list is cast onto its kit building (issue 103).
  const showcase = await showcaseCast(mission, { forced });

  return (
    <>
      {fallback}
      <CastScreen
        mission={{ id: mission.id, title: mission.title, city: mission.city, type: mission.type }}
        result={{ ...result, trace: clientTrace(result.trace) }}
        pins={pins}
        scoutable={scoutable}
        thumbnails={castThumbnails(result.finalists, FIXTURE_AERIALS)}
        showcase={showcase}
      />
    </>
  );
}
