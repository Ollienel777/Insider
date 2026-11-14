import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { BuildingScreen } from "@/components/shell/building-screen";
import { BUILDING_STUBS } from "@/components/shell/building-stub";
import { LayerDot } from "@/components/shell/layer-dot";
import { buttonVariants } from "@/components/ui/button";

// A stand-in for the Map until its ticket replaces this page: the shell, and
// the buildings as rows so the building screens can be reached. The demo
// building is the selected row.
export default function Home() {
  const demo = BUILDING_STUBS[0];
  return (
    <AppShell>
      <BuildingScreen
        visualLabel="Map"
        visual={
          <div className="flex h-full items-center justify-center p-6">
            <p className="label-caps text-text-3">Map view</p>
          </div>
        }
        panel={
          <div className="flex flex-col gap-4">
            <h1 className="text-lg font-semibold text-text-1">Buildings</h1>
            <ul className="-mx-4 flex flex-col">
              {BUILDING_STUBS.map((building) => (
                <li key={building.id}>
                  <Link
                    href={`/b/${building.id}/scout`}
                    aria-current={building.id === demo.id ? "true" : undefined}
                    className="relative flex min-h-10 items-center gap-3 px-4 py-3 transition-colors duration-fast hover:bg-surface-3 aria-[current]:bg-accent-wash aria-[current]:before:absolute aria-[current]:before:inset-y-0 aria-[current]:before:left-0 aria-[current]:before:w-0.5 aria-[current]:before:bg-accent"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-text-1">{building.name}</span>
                      <span className="block truncate text-sm text-text-2">
                        {building.neighbourhood} · {building.yearBuilt} · Class {building.buildingClass}
                      </span>
                    </span>
                    <span className="flex gap-1">
                      <LayerDot layer="costar" />
                      <LayerDot layer="vexcel" />
                      <LayerDot layer="matterport" />
                    </span>
                    <ChevronRight aria-hidden className="size-4 stroke-[1.5] text-text-3" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        }
        action={
          <Link href={`/b/${demo.id}/scout`} className={buttonVariants({ variant: "primary" })}>
            Scout this building
          </Link>
        }
      />
    </AppShell>
  );
}
