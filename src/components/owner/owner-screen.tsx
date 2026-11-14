"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { getMatterport } from "@/adapters/matterport";
import { BuildingScreen } from "@/components/shell/building-screen";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Building, FloorGraph, LevelManifest } from "@/domain";
import { BATCH_SEEDS } from "@/engine";
import { buildingHref } from "@/lib/building-href";
import { cn } from "@/lib/utils";
import { OwnerReady } from "./owner-ready";

export type OwnerBuilding = Pick<Building, "id" | "name" | "matterportModelId">;

/** The one line Owner Mode always shows (SPEC §13 guardrails). */
export const MADE_UP_LINE = "Made-up setup on a fixture building. Real setups stay on this device.";

/** The seed the board shows the setup on: the batch's first. */
export const OWNER_SEED = BATCH_SEEDS[0];

type Load =
  | { status: "loading" }
  | { status: "no-floor" }
  | { status: "error"; message: string }
  | { status: "ready"; floor: FloorGraph };

/**
 * The Owner screen (Owner Mode, SPEC §13, issue 128): the building's security
 * as the owner says it is, the AI crew's 50 attempts against it, the Chief's
 * one suggested change, and the batch again with it made. It loads the floor
 * in the browser (SPEC §4.5) and runs only on a fixture building: the setup
 * shown is made up, and says so.
 */
export function OwnerScreen({
  building,
  manifest,
  fixture,
  mission,
  heistMode,
}: {
  building: OwnerBuilding;
  manifest: LevelManifest | null;
  /** The building comes from the fixtures. Owner Mode runs on no other (SPEC §13). */
  fixture: boolean;
  /** The chosen mission (`?m=`), carried on the way back. */
  mission?: string | null;
  heistMode?: string;
}) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const debriefHref = buildingHref(building.id, "debrief", mission ?? null);

  useEffect(() => {
    if (!manifest || !fixture) return;
    let live = true;
    const fail = (error: unknown) => {
      if (live) setLoad({ status: "error", message: error instanceof Error ? error.message : String(error) });
    };
    getMatterport(heistMode)
      .adapter.loadFloor(building)
      .then((floor) => {
        if (!live) return;
        setLoad(floor ? { status: "ready", floor } : { status: "no-floor" });
      }, fail)
      .catch(fail);
    return () => {
      live = false;
    };
  }, [building, manifest, fixture, heistMode, attempt]);

  if (manifest && fixture && load.status === "ready") {
    return <OwnerReady building={building} manifest={manifest} floor={load.floor} debriefHref={debriefHref} />;
  }

  const blocked = !fixture
    ? {
        testId: "owner-not-fixture",
        label: "Fixture buildings only",
        title: "Owner Mode runs on fixture buildings only.",
        body: "A setup is entered by the building's owner and stays on their device. This build shows it on a fixture building with a made-up setup.",
      }
    : !manifest || load.status === "no-floor"
      ? {
          testId: "owner-no-floor",
          label: "No floor yet",
          title: "This building has no board to test on yet.",
          body: "Only Halvorsen Tower has a floor plan so far.",
        }
      : null;

  return (
    <BuildingScreen
      visualLabel="Owner board"
      visual={
        blocked || load.status === "error" ? (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div
              data-testid={blocked?.testId ?? "owner-error"}
              className="flex max-w-md flex-col gap-3 rounded-md border border-border bg-surface-1 p-6 shadow-e1"
            >
              <p className="label-caps text-text-3">{blocked?.label ?? "The floor didn't load"}</p>
              <h2 className="text-lg font-semibold text-text-1">{blocked?.title ?? "The Owner board couldn't be set up."}</h2>
              <p className="text-sm text-text-2">{blocked?.body ?? (load.status === "error" ? load.message : "")}</p>
              <div>
                {blocked ? (
                  <Link href={debriefHref} className={buttonVariants({ variant: "secondary" })}>
                    Back to the debrief
                  </Link>
                ) : (
                  <Button
                    onClick={() => {
                      setLoad({ status: "loading" });
                      setAttempt((a) => a + 1);
                    }}
                  >
                    Retry
                  </Button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <Skeleton data-testid="owner-skeleton" className="absolute inset-6 rounded-md bg-surface-1" />
        )
      }
      panel={
        <div className="flex flex-col gap-4">
          <OwnerHeading name={building.name} />
          {!blocked && load.status === "loading" ? (
            <div className="flex flex-col gap-4">
              <Skeleton className="h-24" />
              <Skeleton className="h-48" />
            </div>
          ) : null}
        </div>
      }
    />
  );
}

/** The panel's heading: the mode, the building, and the made-up line, always. */
export function OwnerHeading({ name, chip }: { name: string; chip?: ReactNode }) {
  return (
    <header className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <p className="label-caps text-text-3">Owner mode</p>
        {chip ? <span className="ml-auto">{chip}</span> : null}
      </div>
      <h1 className="text-xl font-semibold text-text-1">{name}</h1>
      <p
        data-testid="owner-made-up"
        className={cn("rounded-sm border border-border bg-surface-2 px-3 py-2 text-sm text-text-2")}
      >
        {MADE_UP_LINE}
      </p>
    </header>
  );
}
