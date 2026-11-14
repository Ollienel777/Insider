import Link from "next/link";
import { BuildingScreen } from "@/components/shell/building-screen";
import { buttonVariants } from "@/components/ui/button";
import type { Building } from "@/domain";
import { FACTS_ONLY_NOTE } from "@/components/shell/steps";
import type { DossierFact } from "./dossier-screen";

interface DossierUnavailableProps {
  buildingId: string;
  /** Null when the building was opened with no mission (a kit building from the map): no command then. */
  missionId: string | null;
  name: string;
  /** `missing`: no cached level yet; `invalid`: the cached files fail their schema. */
  reason: "missing" | "invalid";
  detail?: string;
  /** The building's CoStar facts, shown while its level is not built yet. */
  facts?: DossierFact[];
  /**
   * Where the building came from. A kit building (`costar`) gets no build
   * command: `build:levels` writes into the tracked data/levels/, and nothing
   * derived from the kit may ever be committed.
   */
  source?: Building["source"];
}

/** The dossier without a cached level: what happened, and the way to fix it or go on. */
export function DossierUnavailable({ buildingId, missionId, name, reason, detail, facts, source }: DossierUnavailableProps) {
  const kit = source === "costar";
  const command = `npm run build:levels -- ${buildingId}:${missionId}`;
  return (
    <BuildingScreen
      visualLabel="Dossier"
      visual={
        <div data-testid="dossier-unavailable" className="mx-auto flex h-full max-w-[720px] flex-col justify-center gap-3 px-6 py-8">
          <p className="label-caps text-text-3">Dossier · {buildingId}</p>
          <h1 className="text-xl font-semibold text-text-1">
            {reason === "missing" ? `${name} has no level built yet` : `${name}'s cached level failed its check`}
          </h1>
          <p className="text-base text-text-2">
            {kit
              ? `${FACTS_ONLY_NOTE} It comes from the CoStar data kit, whose data stays out of the repository.`
              : reason === "missing"
                ? "The Level Builder runs ahead of the demo, per building. Build this one, then reload."
                : "The cached manifest or trace in data/levels/ does not match the schema. Rebuild it, then reload."}
          </p>
          {kit || !missionId ? null : (
            <code className="w-fit rounded-sm border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-text-1">
              {command}
            </code>
          )}
          {detail ? <p className="font-mono text-sm break-words text-text-2">{detail}</p> : null}
          {facts?.length ? (
            <dl data-testid="costar-facts" className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-5">
              {facts.map((fact) => (
                <div key={fact.label} className="rounded-sm border border-border bg-surface-1 px-3 py-2">
                  <dt className="label-caps text-text-3">{fact.label}</dt>
                  <dd className="mt-1 font-mono text-sm text-text-1">{fact.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      }
      panel={
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-text-1">Level Builder</h2>
          <p className="text-sm text-text-2">No recorded run to replay for this building.</p>
        </div>
      }
      action={
        <Link href="/map" className={buttonVariants({ variant: "primary" })}>
          Pick another building
        </Link>
      }
    />
  );
}
