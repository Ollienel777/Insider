import type { ReactNode } from "react";
import { connection } from "next/server";
import { getCoStar } from "@/adapters/costar";
import { getVexcel } from "@/adapters/vexcel";
import { demoEpochScript, syncDemoEpoch } from "@/lib/demo-epoch";
import type { Fallback } from "@/lib/fallback";
import { forcedServices } from "@/lib/forced-server";
import { configuredModes, SERVICE_IDS, type Service } from "@/lib/mode";
import type { Building } from "@/domain";
import type { ServerStatus } from "@/lib/demo-status";
import { DemoSafety } from "./demo-safety";
import { StepRail } from "./step-rail";
import { isFactsOnly } from "./steps";
import { TopBar } from "./top-bar";

interface AppShellProps {
  children: ReactNode;
  /** On building screens: the building, which also turns the step rail on. */
  building?: Pick<Building, "id" | "name" | "city"> & Partial<Pick<Building, "source">>;
}

/**
 * What the server serves for each service right now: the environment's
 * configuration (keys included), with CoStar and Vexcel as their adapters
 * stand after any live failure in this process (a route handler's included),
 * and the services forced to fixtures.
 */
export function serverStatus(forced: ReadonlySet<Service>): ServerStatus {
  const costar = getCoStar();
  const vexcel = getVexcel();
  const configured = { ...configuredModes(process.env), costar: costar.mode, vexcel: vexcel.mode };
  const fallbacks = [costar.fallback, vexcel.fallback].filter((f): f is Fallback => Boolean(f));
  return { configured, forced: SERVICE_IDS.filter((s) => forced.has(s)), fallbacks, heistMode: process.env.HEIST_MODE };
}

/** The viewport-high frame every screen sits in: top bar, step rail on building screens, then content. */
export async function AppShell({ children, building }: AppShellProps) {
  // Read the mode per request, not at build time, so the chip reports how the
  // running server is configured.
  await connection();
  const epoch = syncDemoEpoch();
  const status = serverStatus(await forcedServices());
  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh">
      {epoch ? <script dangerouslySetInnerHTML={{ __html: demoEpochScript(epoch) }} /> : null}
      <TopBar status={status} building={building} />
      {building ? <StepRail buildingId={building.id} factsOnly={isFactsOnly(building.source)} /> : null}
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      <DemoSafety status={status} />
    </div>
  );
}
