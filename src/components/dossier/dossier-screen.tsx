"use client";

import { ExternalLink, RotateCcw, SkipForward } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayerDot } from "@/components/shell/layer-dot";
import { BuildingScreen } from "@/components/shell/building-screen";
import { buildingHref } from "@/lib/building-href";
import { Button, buttonVariants } from "@/components/ui/button";
import type { BriefedMission, BuildTrace } from "@/domain";
import type { DataToLevelRow } from "./data-to-level";
import { ProvenanceRow } from "./provenance-row";
import { recordedRunHeader, replaySchedule, traceBanner, traceView } from "./replay";
import { Reveal } from "./reveal";
import { TraceList } from "./trace-list";

/** The CoStar facts the dossier prints, as label and value. No tenant field exists to pick. */
export interface DossierFact {
  label: string;
  value: string;
}

export interface DossierScreenProps {
  buildingId: string;
  name: string;
  /** "Bunker Hill, Los Angeles". */
  place: string;
  facts: DossierFact[];
  rows: DataToLevelRow[];
  mission: BriefedMission;
  trace: BuildTrace;
  /** For a CoStar kit building: where its level comes from (`recordLabel`, #95). A fixture building has none. */
  recordLabel?: string | null;
  /** Start with everything shown, as Skip does. For tests and reduced motion. */
  startComplete?: boolean;
}

/** DESIGN.md, Data and copy voice: the briefing's disclaimer line. */
export const DISCLAIMER = "Security shown is game fiction derived from building class and era.";

/**
 * The Dossier (`/b/[id]/dossier`, SPEC §2 beat 3). The Level Builder's
 * recorded run replays in the side panel over about six seconds, and as its
 * tool calls return the reading column fills in order: the CoStar facts, the
 * Data → Level table, then the mission briefing. Skip shows everything at
 * once; Replay starts it again.
 */
export function DossierScreen(props: DossierScreenProps) {
  const { buildingId, name, place, facts, rows, mission, trace, recordLabel = null, startComplete = false } = props;
  const schedule = useMemo(() => replaySchedule(trace, rows.length), [trace, rows.length]);
  const [elapsed, setElapsed] = useState(startComplete ? Number.POSITIVE_INFINITY : 0);
  const [runId, setRunId] = useState(0);
  const done = elapsed >= schedule.end;
  const factsShown = elapsed >= schedule.facts;
  const briefingShown = elapsed >= schedule.briefing;
  const frame = useRef<number | null>(null);

  // The replay clock: one animation frame at a time until the schedule ends.
  // Under reduced motion the first frame shows everything (DESIGN.md, Motion:
  // streams appear whole).
  useEffect(() => {
    if (startComplete && runId === 0) return;
    const whole = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const start = performance.now();
    const tick = (now: number) => {
      const t = whole ? Number.POSITIVE_INFINITY : now - start;
      setElapsed(t);
      frame.current = t < schedule.end ? requestAnimationFrame(tick) : null;
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [runId, schedule.end, startComplete]);

  const skip = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setElapsed(Number.POSITIVE_INFINITY);
  }, []);
  // Replay starts the reading column again from its top, so the header and
  // the CoStar record replay in view rather than under the scrolled briefing.
  const column = useRef<HTMLDivElement>(null);
  const replay = useCallback(() => {
    column.current?.scrollTo?.({ top: 0, behavior: "auto" });
    setElapsed(0);
    setRunId((n) => n + 1);
  }, []);

  // As the briefing fills, bring it into view: at 1440×900 the column runs
  // past the fold, and the table stays on screen above it.
  useEffect(() => {
    const el = column.current;
    if (!briefingShown || !el || (startComplete && runId === 0)) return;
    const smooth = !(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
    el.scrollTo?.({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, [briefingShown, runId, startComplete]);

  const view = traceView(trace, (i) => elapsed >= schedule.events[i]);

  const control = done ? (
    <Button variant="ghost" onClick={replay} data-testid="replay">
      <RotateCcw aria-hidden />
      Replay
    </Button>
  ) : (
    <Button variant="ghost" onClick={skip} data-testid="skip">
      <SkipForward aria-hidden />
      Skip
    </Button>
  );

  return (
    <BuildingScreen
      visualLabel="Dossier"
      visual={
        <div ref={column} data-testid="dossier" data-done={done} className="h-full overflow-y-auto">
          <article className="mx-auto flex max-w-[720px] min-w-0 flex-col gap-6 px-4 py-6 md:px-6">
            <header>
              <p className="label-caps text-text-3">Dossier · {buildingId}</p>
              <h1 className="mt-2 text-2xl font-semibold text-text-1">{name}</h1>
              <p className="mt-1 text-sm text-text-2">{place}</p>
              {recordLabel ? (
                <p data-testid="record-label" className="mt-3 inline-block rounded-sm border border-border px-1.5 py-0.5 label-caps text-text-2">
                  {recordLabel}
                </p>
              ) : null}
            </header>

            <section aria-labelledby="facts-title">
              <h2 id="facts-title" className="label-caps flex items-center gap-2 text-text-3">
                <LayerDot layer="costar" decorative />
                CoStar record
              </h2>
              <dl data-testid="costar-facts" data-shown={factsShown} className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
                {facts.map((fact) => (
                  <div key={fact.label} className="rounded-sm border border-border bg-surface-1 px-3 py-2">
                    <dt className="label-caps text-text-3">{fact.label}</dt>
                    <dd className="mt-1">
                      <Reveal shown={factsShown} skeleton="bar">
                        <span className="font-mono text-sm text-text-1">{fact.value}</span>
                      </Reveal>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            <section aria-labelledby="data-level-title" className="min-w-0">
              <h2 id="data-level-title" className="label-caps text-text-3">
                Data → Level
              </h2>
              <div className="mt-3 overflow-x-auto rounded-md border border-border bg-surface-1 shadow-e-1">
                <table data-testid="data-to-level" className="w-full min-w-[560px] table-fixed text-left">
                  <colgroup>
                    <col className="w-[104px]" />
                    {/* Wide enough for a 14-letter field id in 14px mono, so none breaks mid-word. */}
                    <col className="w-[152px]" />
                    <col className="w-[112px]" />
                    <col />
                  </colgroup>
                  <thead>
                    <tr className="label-caps text-text-3">
                      <th scope="col" className="py-2 pr-3 pl-4 font-normal">
                        Source
                      </th>
                      <th scope="col" className="py-2 pr-3 font-normal">
                        Field
                      </th>
                      <th scope="col" className="py-2 pr-3 font-normal">
                        Value
                      </th>
                      <th scope="col" className="py-2 pr-4 font-normal">
                        Rule → level
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <ProvenanceRow key={row.id} row={row} shown={elapsed >= schedule.rows[i]} />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section aria-labelledby="briefing-title" data-testid="briefing" data-shown={briefingShown}>
              <p className="label-caps text-text-3">Mission briefing · {mission.type === "heist" ? "Heist" : "Prevent"}</p>
              <Reveal shown={briefingShown} skeleton="lines" className="mt-2">
                <h2 id="briefing-title" className="text-xl font-semibold text-text-1">
                  {mission.title}
                </h2>
                {mission.inspiredBy ? (
                  <p className="mt-1 text-sm text-text-2">
                    Inspired by {mission.inspiredBy.event},{" "}
                    <span className="font-mono text-text-1">{mission.inspiredBy.date}</span>
                    {" · "}
                    <a
                      href={mission.inspiredBy.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      data-testid="source-link"
                      className="inline-flex items-center gap-1 text-text-1 underline decoration-border-strong underline-offset-4 hover:decoration-text-2"
                    >
                      Source: {new URL(mission.inspiredBy.sourceUrl).hostname.replace(/^www\./, "")}
                      <ExternalLink aria-hidden className="size-4 stroke-[1.5]" />
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-text-2">Fictional mission, written for the game.</p>
                )}
                <p className="mt-4 text-base text-text-1">{mission.briefing}</p>
                <p className="mt-3 text-sm text-text-2"><span className="text-text-1">Objective</span> {mission.objective}</p>
                <p data-testid="disclaimer" className="mt-4 text-sm text-text-2">
                  {DISCLAIMER}
                </p>
              </Reveal>
            </section>
          </article>
        </div>
      }
      panel={
        <TraceList
          view={view}
          header={recordedRunHeader(trace)}
          control={control}
          banner={traceBanner(trace)}
          subagents={trace.subagents}
        />
      }
      action={
        <Link href={buildingHref(buildingId, "plan", mission.id)} className={buttonVariants({ variant: "primary" })}>
          Brief the crew
        </Link>
      }
    />
  );
}
