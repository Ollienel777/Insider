import type { ReactNode } from "react";
import { connection } from "next/server";
import { modeChip, serviceModes } from "@/lib/mode";
import type { BuildingStub } from "./building-stub";
import { StepRail } from "./step-rail";
import { TopBar } from "./top-bar";

interface AppShellProps {
  children: ReactNode;
  /** On building screens: the building, which also turns the step rail on. */
  building?: BuildingStub;
}

/** The viewport-high frame every screen sits in: top bar, step rail on building screens, then content. */
export async function AppShell({ children, building }: AppShellProps) {
  // Read the mode per request, not at build time, so the chip reports how the
  // running server is configured.
  await connection();
  const chip = modeChip(serviceModes(process.env));
  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh">
      <TopBar chip={chip} building={building} />
      {building ? <StepRail buildingId={building.id} /> : null}
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
