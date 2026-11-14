import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { findBuildingStub } from "@/components/shell/building-stub";

// Every building screen: the top bar with the building's name, and the step rail.
export default async function BuildingLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const building = findBuildingStub(id);
  if (!building) notFound();
  return <AppShell building={building}>{children}</AppShell>;
}
