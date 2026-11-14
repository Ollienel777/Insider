import { redirect } from "next/navigation";

// A building's address opens on its first step.
export default async function BuildingIndex({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/b/${encodeURIComponent(id)}/scout`);
}
