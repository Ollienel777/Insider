"use client";

import type { BatchResult, BatchSummary, DetectorFinding, OutcomeCell } from "@/domain";
import type { OwnerSetup } from "@/domain/owner-setup";
import type { FixAnswer } from "@/agents/chief/fix";
import type { ChiefZones } from "@/components/run/chief-request";
import { ProvenanceRow } from "@/components/run/why-card";
import { whyRows, whyTargets } from "@/components/run/why";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { PlacedLevel } from "@/level/placer";
import { cn } from "@/lib/utils";
import { MeasureChange, MeasureChips, MeasureLines } from "./measure-lines";
import { describeFix } from "./owner-edit";
import type { SetupMeasure } from "./setup-measure";

/** Coverage and open windows for the batch's setup, and for the setup after the Chief's fix once there is one. */
export interface BatchMeasures {
  before: SetupMeasure;
  after: SetupMeasure | null;
}
import type { OwnerBatch, OwnerFix } from "./use-owner-batch";

export type Side = "before" | "after";

const OUTCOME_CELL: Record<OutcomeCell["outcome"], string> = {
  escaped: "bg-danger",
  caught: "bg-n-600",
  timeout: "border border-n-500",
};

const OUTCOME_WORD: Record<OutcomeCell["outcome"], string> = { escaped: "got out", caught: "caught", timeout: "ran out of time" };

/** "Camera C2", "Guard G1", "Desk D1", "Noise". */
export function detectorName(d: Pick<DetectorFinding, "kind" | "id">): string {
  if (d.kind === "noise") return "A guard hearing noise";
  const kind = d.kind === "camera" ? "Camera" : d.kind === "guard" ? "Guard" : d.id?.startsWith("D") ? "Desk" : "Cleaner";
  return `${kind} ${d.id ?? ""}`.trim();
}

/** The rooms a route passes through, each once in a row, as words. */
export function routeRooms(nodes: readonly string[], placed: PlacedLevel): string[] {
  const { floor } = placed.level;
  const label = (id: string) => {
    const node = floor.nodes.find((n) => n.id === id);
    return floor.rooms.find((r) => r.id === node?.roomId)?.label ?? id;
  };
  return nodes.map(label).filter((l, i, all) => i === 0 || l !== all[i - 1]);
}

/** "Left out: roof-quiet (no roof entry on this floor)." The strategies a batch could not play, and why. */
export function leftOut(dropped: BatchResult["dropped"]): string {
  return `Left out: ${dropped.map((d) => `${d.strategyId} (${d.reason})`).join("; ")}.`;
}

/**
 * What the Chief's chip says about who wrote the fix, truthfully: whether a
 * model was called, whether its change stands, and the change left out when
 * it did not fit (the server's `dropped`).
 */
export function chiefNote(answer: FixAnswer, zoneName: (id: string) => string): { chip: string | null; title: string; dropped: string | null } {
  const why = answer.reason === "timeout" || answer.reason === "error" ? `the model didn't answer (${answer.reason})` : null;
  const notCalled = answer.reason ? `no model was called (${answer.reason})` : "no model was called";
  const left = answer.dropped ? `${describeFix({ change: answer.dropped.change, rationale: "" }, zoneName)} (${answer.dropped.reason})` : null;
  if (answer.source === "model") return { chip: null, title: "The model's fix.", dropped: null };
  if (!answer.recorded) {
    return {
      chip: "Rule-based",
      title: "A model was called, but its change didn't fit: the rule-based fix stands in.",
      dropped: left ? `The model suggested: ${left}. It didn't fit, so the rule-based fix stands in.` : null,
    };
  }
  const head = answer.source === "recorded" ? "Recorded fix" : "Rule-based fix";
  return {
    chip: answer.source === "recorded" ? "Recorded" : "Rule-based",
    title: `${head}: ${why ?? notCalled}.`,
    dropped: left ? `The recorded change, ${left}, didn't fit, so the rule-based fix stands in.` : null,
  };
}

/**
 * The batch's side of the Owner screen (issue 127's view, issue 128's compare):
 * the count, the 50-cell strip, each strategy's count, the way most crews got
 * out, what noticed them first most often, and the Chief's one change, then
 * the batch before and after it side by side.
 */
export function BatchPanel({
  batch,
  fix,
  zones,
  generated,
  setupName,
  stale,
  fixedSaved,
  side = "after",
  board,
  measures = null,
  onEdit,
  onRetry,
  onOpenFixed,
}: {
  batch: OwnerBatch;
  fix: OwnerFix;
  zones: ChiefZones;
  /** The batch's setup on the board: its Why rows explain each element still as generated. */
  generated: PlacedLevel;
  /** The batch's setup's name, null for the untouched starting point. */
  setupName: string | null;
  stale: boolean;
  fixedSaved: { ok: boolean; setup: OwnerSetup } | null;
  /** The side the board shows once a fix is applied; the route and detector cards follow it. */
  side?: Side;
  /** The level the board draws (the after level on the After side); `generated` by default. */
  board?: PlacedLevel;
  /** What the floor plan says about the setup (issue 120), beside the count. */
  measures?: BatchMeasures | null;
  onEdit: () => void;
  onRetry: () => void;
  onOpenFixed: () => void;
}) {
  const back = (
    <Button variant="ghost" data-testid="owner-edit" className="self-start" onClick={onEdit}>
      Edit the setup
    </Button>
  );
  if (batch.status === "planning" || batch.status === "idle") {
    return (
      <div className="flex flex-col gap-4" data-testid="owner-batch" data-state="planning">
        <p className="text-sm text-text-2">The crew is planning its ways in…</p>
        <Skeleton className="h-20" />
        <Skeleton className="h-10" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (batch.status === "error") {
    return (
      <div className="flex flex-col gap-3" data-testid="owner-batch" data-state="error">
        <p className="label-caps text-danger">The crew didn&apos;t plan</p>
        <p className="text-sm text-text-1">{batch.message}</p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onRetry}>
            Retry
          </Button>
          {back}
        </div>
      </div>
    );
  }

  const { summary, result } = batch;
  const nameOf = (id: string) => result.strategies.find((s) => s.id === id)?.name ?? id;
  const zoneName = (id: string) => zones.zones.find((z) => z.id === id)?.name.toLowerCase() ?? id;
  // The route and detector cards describe the batch the board beside them shows.
  const compared = fix.status === "applied" && !fix.rerun.dropped;
  const shownSide: Side | null = compared ? side : null;
  const shown = shownSide === "after" && fix.status === "applied" ? fix.rerun.after : summary;
  const shownLevel = shownSide === "after" ? (board ?? generated) : generated;
  const lead = shownSide === "after" ? "After the fix: " : shownSide === "before" ? "Before the fix: " : "";
  const top = shown.detectors[0] ?? null;
  // Who placed an element with no data rows. On the After side that is the Chief's fix for the element it
  // changed, and the fixed setup for the rest: never the rules table, whose elements carry their rows.
  const placedBy = (finding: DetectorFinding): string => {
    if (shownSide === "after" && fix.status === "applied") {
      const { change } = fix.rerun.fix;
      if (change.kind !== "lock-door" && finding.id === change.elementId) {
        return `Placed by the Security Chief's fix: ${describeFix(fix.answer.fix, zoneName)}.`;
      }
      if (fix.rerun.fixed) return `Placed by the fixed setup "${fix.rerun.fixed.name}".`;
    }
    return setupName ? `Placed by the owner's setup "${setupName}".` : "Placed by the rules table.";
  };

  return (
    <div className="flex flex-col gap-6" data-testid="owner-batch" data-state="done">
      <section aria-labelledby="owner-count-label" className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 id="owner-count-label" className="label-caps text-text-3">
            The crew&apos;s {summary.total} attempts
          </h2>
          {batch.recorded ? (
            <span
              data-testid="owner-crew-recorded"
              title={batch.reason ?? "Recorded strategies: no model was called."}
              className="ml-auto rounded-sm border border-border px-1.5 py-0.5 label-caps text-text-2"
            >
              Recorded
            </span>
          ) : null}
        </div>
        <p className="text-sm text-text-2">
          On {setupName ? <span className="text-text-1">{setupName}</span> : "the generated starting point"}
          {stale ? <span data-testid="owner-stale"> (since changed: run it again)</span> : null}.
        </p>
        <Count summary={summary} testId="owner-count" big />
        <Strip summary={summary} testId="owner-strip" />
        {measures ? <MeasureLines measure={measures.before} testId="owner-measure" /> : null}
      </section>

      <section aria-labelledby="owner-strategies-label" className="flex flex-col gap-2">
        <h2 id="owner-strategies-label" className="label-caps text-text-3">
          By strategy
        </h2>
        <ul className="flex flex-col">
          {summary.byStrategy.map((s) => (
            <li
              key={s.strategyId}
              data-testid="owner-strategy"
              data-strategy={s.strategyId}
              data-escaped={s.escaped}
              className="flex items-center gap-3 border-b border-border py-2 last:border-b-0"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-text-1">{nameOf(s.strategyId)}</span>
              <span aria-hidden className="flex gap-0.5">
                {Array.from({ length: s.runs }, (_, i) => (
                  <span key={i} className={cn("size-1.5 rounded-[1px]", i < s.escaped ? "bg-danger" : "bg-n-700")} />
                ))}
              </span>
              <span className="w-12 text-right font-mono text-sm text-text-1 tabular-nums">
                {s.escaped}/{s.runs}
              </span>
            </li>
          ))}
        </ul>
        {result.dropped.length > 0 ? (
          <p data-testid="owner-dropped" className="text-sm text-text-2">
            {leftOut(result.dropped)}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="owner-route-label" className="flex flex-col gap-2">
        <h2 id="owner-route-label" className="label-caps text-text-3">
          {lead}The way most got out
        </h2>
        {shown.topRoute ? (
          <p data-testid="owner-route" data-side={shownSide ?? ""} data-count={shown.topRoute.count} className="text-sm text-text-1">
            <span className="font-mono tabular-nums">
              {shown.topRoute.count} of {shown.escaped}
            </span>{" "}
            went {routeRooms(shown.topRoute.nodes, shownLevel).join(" → ")}. It is drawn on the board.
          </p>
        ) : (
          <p data-testid="owner-route" data-side={shownSide ?? ""} data-count={0} className="text-sm text-text-2">
            No crew got out, so there is no way out to draw.
          </p>
        )}
      </section>

      {top ? (
        <DetectorCard finding={top} total={shown.total} generated={shownLevel} placedBy={placedBy(top)} lead={lead} side={shownSide} />
      ) : shownSide === "after" ? (
        <p data-testid="owner-detector-none" className="text-sm text-text-2">
          After the fix, nothing noticed the crew.
        </p>
      ) : null}

      <ChiefSection
        fix={fix}
        zoneName={zoneName}
        fixedSaved={fixedSaved}
        measures={measures}
        onOpenFixed={onOpenFixed}
      />

      {back}
    </div>
  );
}

function Count({ summary, testId, big = false }: { summary: BatchSummary; testId: string; big?: boolean }) {
  return (
    <div data-testid={testId} data-escaped={summary.escaped} data-total={summary.total} className="flex items-baseline gap-3">
      <p className={cn("font-semibold tabular-nums", big ? "text-3xl" : "text-xl", summary.escaped > 0 ? "text-danger" : "text-text-1")}>
        {summary.escaped}
        <span className="text-text-2"> / {summary.total}</span>
      </p>
      <p className="text-sm text-text-2">got out with the objective</p>
    </div>
  );
}

export function Strip({ summary, testId, small = false }: { summary: BatchSummary; testId: string; small?: boolean }) {
  return (
    <div
      data-testid={testId}
      data-escaped={summary.strip.filter((c) => c.outcome === "escaped").length}
      role="img"
      aria-label={`${summary.escaped} of ${summary.total} attempts got out`}
      className="grid grid-cols-[repeat(25,minmax(0,1fr))] gap-0.5"
    >
      {summary.strip.map((cell) => (
        <span
          key={`${cell.strategyId}-${cell.seed}`}
          data-outcome={cell.outcome}
          title={`${cell.strategyId}, night ${cell.seed}: ${OUTCOME_WORD[cell.outcome]}`}
          className={cn("rounded-[2px]", small ? "h-2" : "h-3", OUTCOME_CELL[cell.outcome])}
        />
      ))}
    </div>
  );
}

function DetectorCard({
  finding,
  total,
  generated,
  placedBy,
  lead,
  side = null,
}: {
  finding: DetectorFinding;
  total: number;
  generated: PlacedLevel | null;
  /** The line shown when the element has no data rows: who placed it. */
  placedBy: string;
  lead: string;
  /** The side of the Chief's rerun the board shows, null before any fix. */
  side?: Side | null;
}) {
  const target = generated && finding.id ? whyTargets(generated).find((t) => t.key === `${finding.kind}:${finding.id}`) : undefined;
  const rows = target ? whyRows(target) : [];
  return (
    <section
      data-testid="owner-detector"
      data-detector={`${finding.kind}:${finding.id ?? ""}`}
      data-count={finding.count}
      data-side={side ?? ""}
      aria-labelledby="owner-detector-label"
      className="flex flex-col gap-3 rounded-md border border-border bg-surface-2 p-4 shadow-e1"
    >
      <div className="flex items-baseline gap-2">
        <h2 id="owner-detector-label" className="label-caps text-text-3">
          {lead}Noticed the crew first most often
        </h2>
      </div>
      <p className="text-base text-text-1">
        <span className="font-mono">{detectorName(finding)}</span> was first to notice the crew in{" "}
        <span className="font-mono tabular-nums">
          {finding.count} of {total}
        </span>{" "}
        attempts, on {finding.turns.length === 1 ? "turn" : "turns"}{" "}
        <span className="font-mono tabular-nums">{finding.turns.slice(0, 8).join(", ")}</span>
        {finding.turns.length > 8 ? " and later" : ""}. It is ringed on the board.
      </p>
      {rows.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <p className="label-caps text-text-3">Why it is there</p>
          {rows.map((row, i) => (
            <ProvenanceRow key={i} row={row} />
          ))}
        </div>
      ) : (
        <p className="border-t border-border pt-3 text-sm text-text-2">
          {placedBy}
        </p>
      )}
    </section>
  );
}

function ChiefSection({
  fix,
  zoneName,
  fixedSaved,
  measures,
  onOpenFixed,
}: {
  fix: OwnerFix;
  zoneName: (id: string) => string;
  fixedSaved: { ok: boolean; setup: OwnerSetup } | null;
  measures: BatchMeasures | null;
  onOpenFixed: () => void;
}) {
  const answer = fix.status === "suggested" || fix.status === "applied" ? fix.answer : null;
  const note = answer ? chiefNote(answer, zoneName) : null;
  return (
    <section data-testid="owner-chief" data-state={fix.status} aria-labelledby="owner-chief-label" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 id="owner-chief-label" className="label-caps text-text-3">
          Security Chief
        </h2>
        {note?.chip ? (
          <span
            data-testid="owner-fix-recorded"
            title={note.title}
            className="ml-auto rounded-sm border border-border px-1.5 py-0.5 label-caps text-text-2"
          >
            {note.chip}
          </span>
        ) : null}
      </div>
      {fix.status === "idle" ? (
        <p className="text-sm text-text-2">
          The Chief reads the batch (counts, zones and ids, never the floor) and suggests one change to the setup.
        </p>
      ) : fix.status === "asking" ? (
        <div className="flex flex-col gap-2" data-testid="owner-chief-asking">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-12" />
        </div>
      ) : fix.status === "error" ? (
        <p data-testid="owner-chief-error" role="alert" className="border-l-2 border-danger pl-3 text-sm text-text-1">
          The Chief didn&apos;t answer: {fix.message}. Ask again.
        </p>
      ) : null}
      {answer ? (
        <>
          <p data-testid="owner-fix" data-kind={answer.fix.change.kind} className="font-mono text-sm text-text-1">
            {describeFix(answer.fix, zoneName)}
          </p>
          <p data-testid="owner-fix-rationale" className="text-base text-text-1">
            {answer.fix.rationale}
          </p>
          {note?.dropped ? (
            <p data-testid="owner-fix-left-out" className="border-l-2 border-border pl-3 text-sm text-text-2">
              {note.dropped}
            </p>
          ) : null}
        </>
      ) : null}
      {fix.status === "applied" ? (
        <BeforeAfter fix={fix} zoneName={zoneName} fixedSaved={fixedSaved} measures={measures} onOpenFixed={onOpenFixed} />
      ) : null}
    </section>
  );
}

function BeforeAfter({
  fix,
  zoneName,
  fixedSaved,
  measures,
  onOpenFixed,
}: {
  fix: Extract<OwnerFix, { status: "applied" }>;
  zoneName: (id: string) => string;
  fixedSaved: { ok: boolean; setup: OwnerSetup } | null;
  measures: BatchMeasures | null;
  onOpenFixed: () => void;
}) {
  const { before, after, dropped } = fix.rerun;
  const delta = before.escaped - after.escaped;
  // A dropped change ran the setup unchanged, so the after side measures the same as the before.
  const measureOf = (id: Side) => (!measures ? null : id === "before" || dropped ? measures.before : measures.after);
  return (
    <div data-testid="owner-compare" className="flex flex-col gap-3 rounded-md border border-border bg-surface-2 p-4">
      <div className="grid grid-cols-2 gap-4">
        {(
          [
            ["before", "Before", before],
            ["after", "After", after],
          ] as const
        ).map(([id, label, summary]) => (
          <div key={id} className="flex min-w-0 flex-col gap-2">
            <p className="label-caps text-text-3">{label}</p>
            <p
              data-testid={`owner-${id}-count`}
              data-escaped={summary.escaped}
              data-total={summary.total}
              className={cn("text-xl font-semibold tabular-nums", summary.escaped > 0 ? "text-danger" : "text-text-1")}
            >
              {summary.escaped}
              <span className="text-text-2"> / {summary.total}</span>
            </p>
            <Strip summary={summary} testId={`owner-${id}-strip`} small />
            {measureOf(id) ? <MeasureChips measure={measureOf(id)!} testId={`owner-${id}-measure`} /> : null}
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1 border-t border-border pt-3">
        <p className="label-caps text-text-3">What changed</p>
        {dropped ? (
          <p data-testid="owner-fix-dropped" className="text-sm text-text-1">
            The change didn&apos;t fit this setup ({dropped}), so the batch ran unchanged.
          </p>
        ) : (
          <p data-testid="owner-changed" className="text-sm text-text-1">
            {describeFix(fix.answer.fix, zoneName)}. Same strategies, same ten nights:{" "}
            <span className="font-mono tabular-nums">{delta > 0 ? `${delta} fewer got out` : delta < 0 ? `${-delta} more got out` : "no change"}</span>.
          </p>
        )}
        {measures?.after && !dropped ? <MeasureChange from={measures.before} to={measures.after} testId="owner-measure-change" /> : null}
      </div>
      {fixedSaved ? (
        fixedSaved.ok ? (
          <div className="flex items-center gap-3">
            <p data-testid="owner-fixed-saved" className="min-w-0 flex-1 text-sm text-text-2">
              Saved as &ldquo;{fixedSaved.setup.name}&rdquo; on this device.
            </p>
            <Button variant="secondary" data-testid="owner-open-fixed" onClick={onOpenFixed}>
              Open it
            </Button>
          </div>
        ) : (
          <p data-testid="owner-fixed-save-failed" role="alert" className="text-sm text-danger">
            This browser didn&apos;t keep it: site data is blocked or full.
          </p>
        )
      ) : null}
    </div>
  );
}
