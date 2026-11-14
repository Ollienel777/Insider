import { notFound, redirect } from "next/navigation";
import { defaultMissionId, findMission } from "@/agents/builder/missions";
import { buildingHref } from "@/lib/building-href";
import { firstM } from "@/lib/mission-param";

// A building's address opens on its first step, keeping the chosen mission.
export default async function BuildingIndex({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ m?: string | string[] }>;
}) {
  const { id } = await params;
  const m = firstM((await searchParams).m);
  // Checked here, so an unknown mission is a 404 at the first hop, not after the redirect.
  if (m && !findMission(m)) notFound();
  const missionId = m ?? defaultMissionId(id);
  if (!missionId) notFound();
  redirect(buildingHref(id, "scout", missionId));
}
