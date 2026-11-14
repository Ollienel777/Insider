"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { getMatterport } from "@/adapters/matterport";
import { BoardView } from "@/components/run/board-view";
import { saveCrewPlan } from "@/components/run/crew-plan-store";
import { LensLegend, LensToggle, useLayerLens } from "@/components/run/layer-lens";
import { RUN_SEED, type RunBuilding } from "@/components/run/run-screen";
import { BuildingScreen } from "@/components/shell/building-screen";
import { buildingHref } from "@/lib/building-href";
import { useMissionId } from "@/lib/use-mission-id";
import { LayerDot } from "@/components/shell/layer-dot";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { LevelManifest } from "@/domain";
import { createRun } from "@/engine";
import { placeLevel, type PlacedLevel } from "@/level/placer";
import { validatePlan } from "@/level/validate-plan";
import { askCrew, crewRequest, EXAMPLE_ORDER, type CrewAnswer } from "./crew-request";
import { CrewReply, ghostOf } from "./crew-reply";

type Load =
  | { status: "loading" }
  | { status: "ready"; placed: PlacedLevel; live: boolean }
  | { status: "no-floor" }
  | { status: "error"; message: string };

type Ask =
  | { status: "idle" }
  | { status: "planning" }
  | { status: "answered"; answer: CrewAnswer }
  | { status: "error"; message: string };

const ORDER_MAX = 400;

/**
 * The Plan screen (SPEC §2 beat 4, DESIGN.md Plan): the board at reduced
 * emphasis, and a panel with the order box. The crew answers in zones; the
 * browser checks the answer on the board (validate-plan.ts) and draws it as a
 * ghost path, with the camera or guard that would see it and on which turn.
 */
export function PlanScreen({
  building,
  manifest,
  heistMode,
}: {
  building: RunBuilding;
  manifest: LevelManifest | null;
  heistMode?: string;
}) {
  const [loaded, setLoad] = useState<Load>({ status: "loading" });
  const [order, setOrder] = useState("");
  const [ask, setAsk] = useState<Ask>({ status: "idle" });
  const [lens, toggleLens] = useLayerLens();
  const missionId = useMissionId();
  const pending = useRef<AbortController | null>(null);
  const orderId = useId();

  useEffect(() => {
    if (!manifest) return;
    let live = true;
    const matterport = getMatterport(heistMode);
    const fail = (error: unknown) => {
      if (live) setLoad({ status: "error", message: error instanceof Error ? error.message : String(error) });
    };
    matterport.adapter
      .loadFloor(building)
      .then((floor) => {
        if (!live) return;
        if (!floor) return setLoad({ status: "no-floor" });
        setLoad({ status: "ready", placed: placeLevel(manifest, floor, RUN_SEED), live: floor.source === "matterport" });
      }, fail)
      .catch(fail);
    return () => {
      live = false;
    };
  }, [building, manifest, heistMode]);

  useEffect(() => () => pending.current?.abort(), []);

  // The crew's answer is the beat: bring it to the top of the panel when it lands.
  const replyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (ask.status !== "answered") return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    replyRef.current?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }, [ask]);

  const load: Load = manifest ? loaded : { status: "no-floor" };
  const placed = load.status === "ready" ? load.placed : null;
  const run = useMemo(() => (placed ? createRun(placed.level) : null), [placed]);
  const answer = ask.status === "answered" ? ask.answer : null;
  const checked = useMemo(() => (placed && answer ? validatePlan(placed, answer.plan) : null), [placed, answer]);

  async function brief(event?: FormEvent) {
    event?.preventDefault();
    const text = order.trim();
    if (!text || ask.status === "planning") return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setAsk({ status: "planning" });
    try {
      const reply = await askCrew(crewRequest(building.id, text, missionId), { signal: controller.signal });
      if (!controller.signal.aborted) {
        setAsk({ status: "answered", answer: reply });
        // The run follows the briefed plan (beat 4 into beat 5).
        saveCrewPlan(building.id, { plan: reply.plan, recorded: reply.recorded }, undefined, missionId);
      }
    } catch (error) {
      if (!controller.signal.aborted) setAsk({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  function onOrderKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void brief();
    }
  }

  const ready = placed !== null && run !== null;

  return (
    <BuildingScreen
      visualLabel="Plan board"
      visual={
        <div className="absolute inset-0 flex flex-col">
          <div className="flex h-14 shrink-0 items-center gap-3 px-6">
            <span className="flex items-center gap-2 label-caps text-text-2">
              <LayerDot layer="matterport" decorative />
              Matterport
              <span className="max-md:hidden">
                {load.status === "ready" && load.live ? " · floor plan from the scan" : " · floor plan from fixtures"}
              </span>
            </span>
            <span aria-hidden className="h-4 w-px bg-border" />
            <span className="truncate text-sm text-text-1">{manifest?.mission.title}</span>
            <div className="ml-auto">
              <LensToggle on={lens} onToggle={toggleLens} disabled={!ready} />
            </div>
          </div>
          <div className="relative min-h-0 flex-1">
            {load.status === "loading" ? (
              <Skeleton data-testid="board-skeleton" className="absolute inset-x-6 inset-y-0 rounded-md bg-surface-1" />
            ) : load.status === "no-floor" ? (
              <BoardMessage
                testId="board-empty"
                label="No floor yet"
                title="This building's level isn't ready yet."
                body="Only Halvorsen Tower has a board so far. Pick it on the map to plan the job."
                action={
                  <Link href="/" className={buttonVariants({ variant: "secondary" })}>
                    Back to the map
                  </Link>
                }
              />
            ) : load.status === "error" ? (
              <BoardMessage
                testId="board-error"
                label="The level didn't place"
                title="The board couldn't be set up."
                body={load.message}
                action={null}
              />
            ) : ready ? (
              <BoardView
                testId="plan-board"
                placed={placed}
                run={run}
                choices={[]}
                onChoose={() => {}}
                // The lens is a look at the board itself, so it lifts the reduced emphasis while it is on.
                reduced={!lens}
                lens={lens}
                ghost={checked ? ghostOf(checked) : null}
              />
            ) : null}
          </div>
          {lens && ready ? <LensLegend placed={placed} locked={run.locked} /> : null}
          <div className="flex h-16 shrink-0 items-center gap-6 px-6 text-sm text-text-2">
            {checked ? (
              <>
                <Legend swatch={<span className="h-1 w-6 rounded-sm bg-accent opacity-50" />}>The crew&apos;s plan</Legend>
                {checked.warnings.some((w) => w.by) ? (
                  <Legend swatch={<span className="size-3 rounded-full border-2 border-warning" />}>Where it&apos;s seen</Legend>
                ) : null}
                {checked.advice?.waits.length ? (
                  <Legend swatch={<span className="size-3 rounded-full border-2 border-dashed border-n-100" />}>
                    Where to wait
                  </Legend>
                ) : null}
              </>
            ) : (
              <p>The guards and cameras as they stand at turn 0. Brief the crew to see the plan on the board.</p>
            )}
          </div>
        </div>
      }
      panel={
        <div className="flex flex-col gap-6">
          <header className="flex flex-col gap-1">
            <p className="label-caps text-text-3">Brief the crew</p>
            <h1 className="text-xl font-semibold text-text-1">{manifest?.mission.title ?? building.name}</h1>
            {manifest ? <p className="text-sm text-text-2">{manifest.mission.objective}.</p> : null}
          </header>

          <form onSubmit={brief} className="flex flex-col gap-2" aria-busy={ask.status === "planning"}>
            <label htmlFor={orderId} className="label-caps text-text-3">
              Your order
            </label>
            <textarea
              id={orderId}
              data-testid="crew-order"
              value={order}
              maxLength={ORDER_MAX}
              rows={3}
              onChange={(e) => setOrder(e.target.value)}
              onKeyDown={onOrderKey}
              disabled={!ready}
              placeholder="Tell the crew how you want to play it"
              className="min-h-24 resize-none rounded-sm border border-border bg-surface-2 px-3 py-2 text-base text-text-1 placeholder:text-text-3 hover:border-border-strong focus-visible:border-accent disabled:opacity-50"
            />
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={!ready || !order.trim() || ask.status === "planning"}>
                {ask.status === "planning" ? "Crew is planning…" : "Brief the crew"}
              </Button>
              <span className="text-xs text-text-2">Enter to send</span>
            </div>
            {!order ? (
              <button
                type="button"
                onClick={() => setOrder(EXAMPLE_ORDER)}
                disabled={!ready}
                className="min-h-10 self-start rounded-sm text-left text-sm text-text-2 underline decoration-n-500 underline-offset-4 hover:text-text-1"
              >
                Try: “{EXAMPLE_ORDER}”
              </button>
            ) : null}
          </form>

          <div aria-live="polite" ref={replyRef} className="scroll-mt-4">
            {ask.status === "planning" ? (
              <div data-testid="crew-planning" className="flex flex-col gap-3">
                <p className="label-caps text-text-3">Crew is planning…</p>
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-9" />
                ))}
                <Skeleton className="h-16" />
              </div>
            ) : ask.status === "error" ? (
              <div data-testid="crew-error" className="flex flex-col items-start gap-2 rounded-r-sm border-l-2 border-danger bg-surface-2 py-3 pr-4 pl-3">
                <p className="label-caps text-danger">The crew didn&apos;t answer</p>
                <p className="text-sm text-text-1">{ask.message}</p>
                <Button onClick={() => void brief()}>Retry</Button>
              </div>
            ) : answer && checked ? (
              <CrewReply answer={answer} checked={checked} />
            ) : null}
          </div>

          <p className="text-sm text-text-2">Security shown is game fiction derived from building class and era.</p>
        </div>
      }
      action={
        <Link href={buildingHref(building.id, "run", missionId)} className={buttonVariants({ variant: "primary" })}>
          Start the run
        </Link>
      }
    />
  );
}

function Legend({ swatch, children }: { swatch: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      {swatch}
      {children}
    </span>
  );
}

function BoardMessage({
  testId,
  label,
  title,
  body,
  action,
}: {
  testId: string;
  label: string;
  title: string;
  body: string;
  action: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className="absolute inset-x-6 inset-y-0 flex flex-col items-center justify-center gap-3 rounded-md border border-border bg-surface-1 p-6 text-center"
    >
      <p className="label-caps text-text-3">{label}</p>
      <p className="text-lg font-semibold text-text-1">{title}</p>
      <p className="max-w-md text-sm break-words text-text-2">{body}</p>
      {action}
    </div>
  );
}
