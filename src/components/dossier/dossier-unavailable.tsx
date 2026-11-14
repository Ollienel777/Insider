import Link from "next/link";
import { BuildingScreen } from "@/components/shell/building-screen";
import { buttonVariants } from "@/components/ui/button";

interface DossierUnavailableProps {
  buildingId: string;
  missionId: string;
  name: string;
  /** `missing`: no cached level yet; `invalid`: the cached files fail their schema. */
  reason: "missing" | "invalid";
  detail?: string;
}

/** The dossier without a cached level: what happened, and the way to fix it or go on. */
export function DossierUnavailable({ buildingId, missionId, name, reason, detail }: DossierUnavailableProps) {
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
            {reason === "missing"
              ? "The Level Builder runs ahead of the demo, per building. Build this one, then reload."
              : "The cached manifest or trace in data/levels/ does not match the schema. Rebuild it, then reload."}
          </p>
          <code className="w-fit rounded-sm border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-text-1">
            {command}
          </code>
          {detail ? <p className="font-mono text-sm break-words text-text-2">{detail}</p> : null}
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
