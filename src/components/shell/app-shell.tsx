import type { ReactNode } from "react";
import { connection } from "next/server";
import { getCoStar } from "@/adapters/costar";
import { getVexcel } from "@/adapters/vexcel";
import { builtMissions } from "@/agents/builder/live-levels";
import { demoEpochScript, syncDemoEpoch } from "@/lib/demo-epoch";
import type { Fallback } from "@/lib/fallback";
import { forcedServices } from "@/lib/forced-server";
import { configuredModes, SERVICE_IDS, type Service } from "@/lib/mode";
import type { Building } from "@/domain";
import type { ServerStatus } from "@/lib/demo-status";
import { CaseCover } from "./case-cover";
import { DemoSafety } from "./demo-safety";
import { StepRail } from "./step-rail";
import { StepRailView } from "./step-rail-view";
import { isFactsOnly } from "./steps";
import { TopBar } from "./top-bar";

interface AppShellProps {
  children: ReactNode;
  /** On building screens: the building, which also turns the step rail on. */
  building?: Pick<Building, "id" | "name" | "city"> & Partial<Pick<Building, "source">>;
  /** Off building screens: which tab is current, the mission picker's or the cast screen's (issue 166). */
  tab?: "missions" | "cast";
  /** On the cast screen: the mission being cast, which its tab links to. */
  missionId?: string;
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

/**
 * The desk every screen sits on (issue 166): the game's card and the mode chip
 * along the top, the folder's tabs under them, then the open case file, which
 * holds the screen. Run keeps them too: the mode chip and the way back stay in sight.
 */
export async function AppShell({ children, building, tab = "missions", missionId }: AppShellProps) {
  // Read the mode per request, not at build time, so the chip reports how the
  // running server is configured.
  await connection();
  const epoch = syncDemoEpoch();
  const status = serverStatus(await forcedServices());
  return (
    <div data-desk className="relative flex min-h-dvh flex-col gap-2 px-3 pt-2 pb-4 md:px-6 lg:h-dvh">
      {epoch ? <script dangerouslySetInnerHTML={{ __html: demoEpochScript(epoch) }} /> : null}
      <TopBar status={status} building={building} />
      {/* The tab row: the folder's tabs on building screens; the stamp docks at its right end (BuildingScreen). */}
      <div data-chrome className="flex h-12 shrink-0 items-end pr-[230px] max-lg:pr-0">
        {building ? (
          <StepRail
            buildingId={building.id}
            factsOnly={isFactsOnly(building.source)}
            builtMissions={isFactsOnly(building.source) ? builtMissions(building.id) : undefined}
          />
        ) : (
          <StepRailView current={tab} missionId={missionId ?? null} />
        )}
      </div>
      <main
        data-folder
        className="relative flex min-h-0 flex-1 flex-col rounded-[4px_18px_18px_18px] border-[3px] border-border-strong bg-manila p-3 shadow-[0_8px_0_var(--manila-2),0_8px_0_3px_var(--ink-shadow),10px_22px_30px_rgb(0_0_0/0.42)]"
      >
        {children}
      </main>
      <CaseCover />
      <DemoSafety status={status} />
    </div>
  );
}
