import Link from "next/link";
import { BuildingScreen } from "@/components/shell/building-screen";
import { buttonVariants } from "@/components/ui/button";

interface LevelUnavailableProps {
  buildingId: string;
  name: string;
  /** The screen that could not open: its visual's name and the label above the heading. */
  step: "Plan" | "Run" | "Debrief";
  /** The error's message: a schema failure, bad JSON or a read error. */
  detail?: string;
}

/**
 * Plan, Run or Debrief on a cached level that fails its check (as the Dossier
 * shows it): what happened, the command that fixes it, and the way on. A
 * missing level is each screen's own empty state; this is the error state.
 */
export function LevelUnavailable({ buildingId, name, step, detail }: LevelUnavailableProps) {
  return (
    <BuildingScreen
      visualLabel={step}
      visual={
        <div data-testid="level-unavailable" className="mx-auto flex h-full max-w-[720px] flex-col justify-center gap-3 px-6 py-8">
          <p className="label-caps text-text-3">
            {step} · {buildingId}
          </p>
          <h1 className="text-xl font-semibold text-text-1">{`${name}'s cached level failed its check`}</h1>
          <p className="text-base text-text-2">
            The cached manifest or trace in data/levels/ could not be read, or does not match the schema, so there is no board to show. Rebuild it,
            then reload.
          </p>
          <code className="w-fit rounded-sm border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-text-1">
            {`npm run build:levels -- ${buildingId}`}
          </code>
          {detail ? <p className="font-mono text-sm break-words text-text-2">{detail}</p> : null}
        </div>
      }
      panel={
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-text-1">Rebuild the level</h2>
          <p className="text-sm text-text-2">Nothing to play on this building until its level is rebuilt.</p>
        </div>
      }
      action={
        <Link href="/" className={buttonVariants({ variant: "primary" })}>
          Pick another building
        </Link>
      }
    />
  );
}
