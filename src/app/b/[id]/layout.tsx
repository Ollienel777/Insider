import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { findBuilding } from "@/lib/building";

// Every building screen: the top bar with the building's name (from the
// CoStar adapter), and the step rail.
export default async function BuildingLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const building = await findBuilding(id);
  if (!building) notFound();
  return <AppShell building={building}>{children}</AppShell>;
}
