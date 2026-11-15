"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { getMatterport } from "@/adapters/matterport";
import { placeOrFixture } from "@/components/run/scan-fallback";
import { BuildingScreen } from "@/components/shell/building-screen";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Building, FloorGraph, LevelManifest } from "@/domain";
import { BATCH_SEEDS } from "@/engine";
import { placeLevel } from "@/level/placer";
import { buildingHref } from "@/lib/building-href";
import { cn } from "@/lib/utils";
import { OwnerReady } from "./owner-ready";

export type OwnerBuilding = Pick<Building, "id" | "name" | "matterportModelId">;

/** The one line Owner Mode always shows (SPEC §13 guardrails). */
export const MADE_UP_LINE = "Made-up setup on a fixture building. Real setups stay on this device.";

/** On a showcase building (issue 205), whose board is the real building's scan: the setup is made up, and says so. */
export const SHOWCASE_MADE_UP_LINE = "A made-up setup for the demo, not this building's real security.";

/** The scan view's own line (SPEC §1), kept beside it: the generated security is game fiction. */
export const SHOWCASE_FICTION_LINE = "The building is the real scan. Security shown is game fiction. Setups here stay in this tab.";

/**
 * Where Owner Mode runs (SPEC §13): a fixture building, or a showcase kit
 * building (issue 205, Nelson's call for the demo, past SPEC §1's "on a
 * fixture building"). Null for any other building.
 */
export type OwnerScope = "fixture" | "showcase" | null;

/** The floor Owner Mode plays on: a scan's with every door able to take a lock (the owner's call), any other as it is. */
export function ownerFloor(floor: FloorGraph): FloorGraph {
  if (floor.source !== "matterport") return floor;
  return { ...floor, edges: floor.edges.map((e) => (e.door && !e.door.lockable ? { ...e, door: { ...e.door, lockable: true } } : e)) };
}

/** The seed the board shows the setup on: the batch's first. */
export const OWNER_SEED = BATCH_SEEDS[0];

type Load =
  | { status: "loading" }
  | { status: "no-floor" }
  | { status: "error"; message: string }
  | { status: "ready"; floor: FloorGraph; live: boolean };

/**
 * The Owner screen (Owner Mode, SPEC §13, issue 128): the building's security
 * as the owner says it is, the AI crew's 50 attempts against it, the Chief's
 * one suggested change, and the batch again with it made. It loads the floor
 * in the browser (SPEC §4.5) and runs only on a fixture building or a showcase
 * building: the setup shown is made up, and says so. On a showcase building
 * the floor is the live scan, and a setup stays in this tab's memory.
 */
export function OwnerScreen({
  building,
  manifest,
  scope,
  mission,
  heistMode,
}: {
  building: OwnerBuilding;
  manifest: LevelManifest | null;
  /** Where Owner Mode runs: a fixture building or a showcase building, on no other (SPEC §13, issue 205). */
  scope: OwnerScope;
  /** The chosen mission (`?m=`), carried on the way back. */
  mission?: string | null;
  heistMode?: string;
}) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const debriefHref = buildingHref(building.id, "debrief", mission ?? null);

  useEffect(() => {
    if (!manifest || !scope) return;
    let live = true;
    const abandon = new AbortController();
    const fail = (error: unknown) => {
      if (live) setLoad({ status: "error", message: error instanceof Error ? error.message : String(error) });
    };
    getMatterport(heistMode)
      .adapter.loadFloor(building, abandon.signal)
      .then(async (floor) => {
        if (!live) return;
        if (!floor) return setLoad({ status: "no-floor" });
        // A scan the level can't be placed on falls back to the fixture floor, as on Run, and the chip says so.
        // A scan's doors come in unlockable (which lock is game fiction), but here the owner says which
        // doors lock: on a scan every door can take one, so the generated locks are the owner's to keep and
        // the Chief can lock a door the placer didn't. The placer's own locks come out the same. A fixture
        // floor is kept as it is.
        const on = await placeOrFixture(building, floor, (f) => (placeLevel(manifest, f, OWNER_SEED), ownerFloor(f)));
        if (!live) return;
        setLoad(on ? { status: "ready", floor: on, live: on.source === "matterport" } : { status: "no-floor" });
      }, fail)
      .catch(fail);
    return () => {
      live = false;
      abandon.abort();
    };
  }, [building, manifest, scope, heistMode, attempt]);

  if (manifest && scope && load.status === "ready") {
    return (
      <OwnerReady
        building={building}
        manifest={manifest}
        floor={load.floor}
        debriefHref={debriefHref}
        showcase={scope === "showcase"}
        // A kit building's level and a scan's board stay out of browser storage (SPEC §4.5), as Run keeps its runs.
        inMemory={scope === "showcase" || load.live}
      />
    );
  }

  const blocked = !scope
    ? {
        testId: "owner-not-fixture",
        label: "Not on this building",
        title: "Owner Mode runs on the fixture buildings and the showcase only.",
        body: "A setup is entered by the building's owner and stays on their device. This build shows it with a made-up setup, on a fixture building or the demo's showcase building.",
      }
    : !manifest && scope === "showcase"
      ? {
          testId: "owner-no-floor",
          label: "No level yet",
          title: "This building's level is still being built.",
          body: "The server builds the showcase's level when it starts. Open the Dossier, then come back.",
        }
      : !manifest || load.status === "no-floor"
      ? {
          testId: "owner-no-floor",
          label: "No floor yet",
          title: "This building has no board to test on yet.",
          body: "Only the Los Angeles buildings have a floor plan so far.",
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
          <OwnerHeading name={building.name} showcase={scope === "showcase"} />
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

/** The panel's heading: the mode, the building, and the made-up line, always (on a showcase building, with the game-fiction line). */
export function OwnerHeading({ name, chip, showcase = false }: { name: string; chip?: ReactNode; showcase?: boolean }) {
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
        {showcase ? SHOWCASE_MADE_UP_LINE : MADE_UP_LINE}
      </p>
      {showcase ? (
        <p data-testid="owner-fiction" className="text-sm text-text-2">
          {SHOWCASE_FICTION_LINE}
        </p>
      ) : null}
    </header>
  );
}
