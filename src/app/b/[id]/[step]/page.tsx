import Link from "next/link";
import { notFound } from "next/navigation";
import { BuildingScreen } from "@/components/shell/building-screen";
import { findBuildingStub } from "@/components/shell/building-stub";
import { isStepSegment, nextStep, STEPS } from "@/components/shell/steps";
import { buttonVariants } from "@/components/ui/button";

// A stand-in for each building screen until its own ticket adds
// `src/app/b/[id]/<step>/page.tsx`, which takes precedence over this dynamic
// segment. It shows the screen's frame and its primary action, so the shell
// can be walked end to end.

const PRIMARY_ACTION: Record<string, string> = {
  scout: "Plan the job",
  dossier: "Brief the crew",
  plan: "Start the run",
  run: "See the debrief",
  debrief: "Run the drill",
};

export default async function StepPlaceholder({ params }: { params: Promise<{ id: string; step: string }> }) {
  const { id, step } = await params;
  const building = findBuildingStub(id);
  if (!building || !isStepSegment(step)) notFound();
  const label = STEPS.find((s) => s.segment === step)!.label;
  const next = nextStep(step);
  const action = PRIMARY_ACTION[step];

  return (
    <BuildingScreen
      visualLabel={`${label} view`}
      visual={
        <div className="flex h-full items-center justify-center p-6">
          <p className="label-caps text-text-3">{label} view</p>
        </div>
      }
      panel={
        <div className="flex flex-col gap-2">
          <p className="label-caps text-text-3">{label}</p>
          <h1 className="text-2xl font-semibold text-text-1">{building.name}</h1>
          <p className="text-sm text-text-2">
            {building.neighbourhood}, {building.city}
          </p>
          <dl className="mt-4 grid grid-cols-3 gap-2">
            {[
              ["Built", building.yearBuilt],
              ["Class", building.buildingClass],
              ["Stories", building.stories],
            ].map(([term, value]) => (
              <div key={term} className="rounded-sm border border-border bg-surface-2 px-3 py-2">
                <dt className="label-caps text-text-3">{term}</dt>
                <dd className="font-mono text-sm text-text-1">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      }
      action={
        next && action ? (
          <Link href={`/b/${building.id}/${next.segment}`} className={buttonVariants({ variant: "primary" })}>
            {action}
          </Link>
        ) : null
      }
    />
  );
}
