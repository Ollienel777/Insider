import { redirect } from "next/navigation";
import { buildingHref } from "@/lib/building-href";

// A building's address opens on its first step, keeping the chosen mission.
export default async function BuildingIndex({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ m?: string | string[] }>;
}) {
  const { id } = await params;
  const { m } = await searchParams;
  redirect(buildingHref(id, "scout", typeof m === "string" ? m : null));
}
