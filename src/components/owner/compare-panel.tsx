"use client";

import type { FloorGraph } from "@/domain";
import type { OwnerSetup } from "@/domain/owner-setup";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { PlacedLevel } from "@/level/placer";
import { cn } from "@/lib/utils";
import { detectorName, leftOut, routeRooms, Strip } from "./batch-panel";
import type { DemoSetup } from "./demo-setups";
import { MeasureChange, MeasureChips } from "./measure-lines";
import type { SetupMeasure } from "./setup-measure";
import { setupChanges } from "./owner-edit";
import type { OwnerPair } from "./use-owner-compare";

export type PairId = "a" | "b";

/** A setup the compare can pick: a prepared one (made up) or one saved on this device. */
export interface CompareOption {
  /** `demo:<name>` or `saved:<name>`, so a saved copy of a prepared setup is its own option. */
  value: string;
  setup: OwnerSetup;
  madeUp: boolean;
}

/** The options in order: the prepared setups first, then the saved ones. */
export function compareOptions(demos: readonly DemoSetup[], saved: readonly OwnerSetup[]): CompareOption[] {
  return [
    ...demos.map((d) => ({ value: `demo:${d.setup.name}`, setup: d.setup, madeUp: true })),
    ...saved.map((s) => ({ value: `saved:${s.name}`, setup: s, madeUp: false })),
  ];
}

/** The pair the picker starts on: the first two options (the prepared pair on F1). */
export function defaultPick(options: readonly CompareOption[]): { a: string; b: string } {
  return { a: options[0]?.value ?? "", b: options[1]?.value ?? options[0]?.value ?? "" };
}

const MadeUpChip = () => (
  <span data-testid="owner-made-up-chip" className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 label-caps text-text-2">
    Made up
  </span>
);

/** The prepared setups, each with a Load button: a demo is an ordinary setup, loaded in plain sight. */
export function DemoList({ demos, onLoad }: { demos: readonly DemoSetup[]; onLoad: (name: string) => void }) {
  if (demos.length === 0) return null;
  return (
    <section aria-labelledby="owner-demo-label" className="flex flex-col gap-2" data-testid="owner-demos">
      <h2 id="owner-demo-label" className="label-caps text-text-3">
        Prepared for the demo
      </h2>
      <ul className="flex flex-col">
        {demos.map((d) => (
          <li key={d.setup.name} className="flex items-center gap-3 border-b border-border py-2 last:border-b-0">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="min-w-0 truncate text-sm text-text-1">{d.setup.name}</span>
                <MadeUpChip />
              </div>
              <p className="text-sm text-text-2">{d.note}</p>
            </div>
            <Button variant="secondary" data-testid="owner-demo-load" data-name={d.setup.name} onClick={() => onLoad(d.setup.name)}>
              Load
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Two selects and a Compare button: any two setups, prepared or saved. */
export function ComparePicker({
  options,
  pick,
  planning,
  onPick,
  onCompare,
}: {
  options: readonly CompareOption[];
  pick: { a: string; b: string };
  planning: boolean;
  onPick: (pick: { a: string; b: string }) => void;
  onCompare: () => void;
}) {
  const same = pick.a === pick.b;
  const enough = options.length >= 2;
  const select = (id: PairId) => (
    <label className="flex min-w-0 items-center gap-3">
      <span className="label-caps w-4 shrink-0 text-text-3">{id.toUpperCase()}</span>
      <select
        data-testid={`owner-pair-pick-${id}`}
        aria-label={`Setup ${id.toUpperCase()}`}
        value={pick[id]}
        onChange={(e) => onPick({ ...pick, [id]: e.target.value })}
        className="h-10 min-w-0 flex-1 rounded-sm border border-border bg-surface-2 px-2 text-sm text-text-1"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.madeUp ? `${o.setup.name} (made up)` : o.setup.name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <section aria-labelledby="owner-pair-label" className="flex flex-col gap-2" data-testid="owner-pair-picker">
      <h2 id="owner-pair-label" className="label-caps text-text-3">
        Compare two setups
      </h2>
      {enough ? (
        <>
          <div className="flex flex-col gap-2">
            {select("a")}
            {select("b")}
          </div>
          <div className="flex items-center gap-3">
            <Button variant="secondary" data-testid="owner-pair-run" onClick={onCompare} disabled={same || planning}>
              {planning ? "The crew is planning…" : "Compare"}
            </Button>
            <p className="text-sm text-text-2">{same ? "Pick two different setups." : "Both play the same strategies on the same nights."}</p>
          </div>
        </>
      ) : (
        <p data-testid="owner-pair-empty" className="text-sm text-text-2">
          Save two setups on this device to compare them.
        </p>
      )}
    </section>
  );
}

/** How many attempts each side played, from the batches themselves: a strategy left out plays none. */
export function attemptsLine(a: number, b: number): string {
  return a === b
    ? `Same crew strategies, same ten nights: ${a} attempts on each.`
    : `Same ten nights, but not the same strategies: ${a} attempts on A, ${b} on B.`;
}

/** "7 → 1 of 50: 6 fewer got out.", or each side's own total when the two played different numbers. */
export function deltaLine(a: { escaped: number; total: number }, b: { escaped: number; total: number }): string {
  const delta = a.escaped - b.escaped;
  const counts = a.total === b.total ? `${a.escaped} → ${b.escaped} of ${b.total}` : `${a.escaped} of ${a.total} → ${b.escaped} of ${b.total}`;
  return `${counts}: ${delta > 0 ? `${delta} fewer got out` : delta < 0 ? `${-delta} more got out` : "no change"}.`;
}

/**
 * The two setups side by side (issue 31): for each, the count and the outcome
 * strip, the way most got out and what noticed the crew first; then what
 * changed from A to B. Choosing a side draws its way out on the board.
 */
export function ComparePanel({
  pair,
  floor,
  boards,
  madeUp,
  side,
  measures = null,
  onSide,
  onRetry,
  onBack,
}: {
  pair: OwnerPair;
  /** Each side's coverage and open windows, from the floor plan (issue 120). */
  measures?: [SetupMeasure, SetupMeasure] | null;
  floor: FloorGraph;
  /** Each side's setup on the board, for room names along its route. */
  boards: [PlacedLevel, PlacedLevel] | null;
  /** Which sides are prepared (made-up) setups. */
  madeUp: [boolean, boolean];
  side: PairId;
  onSide: (side: PairId) => void;
  onRetry: () => void;
  onBack: () => void;
}) {
  const back = (
    <Button variant="ghost" data-testid="owner-pair-back" className="self-start" onClick={onBack}>
      Back to the editor
    </Button>
  );
  if (pair.status === "idle" || pair.status === "planning") {
    return (
      <div className="flex flex-col gap-4" data-testid="owner-pair" data-state="planning">
        <p className="text-sm text-text-2">The crew is planning its ways in…</p>
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-24" />
      </div>
    );
  }
  if (pair.status === "error") {
    return (
      <div className="flex flex-col gap-3" data-testid="owner-pair" data-state="error">
        <p className="label-caps text-danger">The crew didn&apos;t plan</p>
        <p className="text-sm text-text-1">{pair.message}</p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onRetry}>
            Retry
          </Button>
          {back}
        </div>
      </div>
    );
  }

  const [a, b] = pair.sides;
  const changes = setupChanges(a.setup, b.setup, floor);
  const delta = a.summary.escaped - b.summary.escaped;
  const ids: PairId[] = ["a", "b"];

  return (
    <div className="flex flex-col gap-6" data-testid="owner-pair" data-state="done">
      <section aria-labelledby="owner-pair-head" className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 id="owner-pair-head" className="label-caps text-text-3">
            Two setups, side by side
          </h2>
          {pair.recorded ? (
            <span
              data-testid="owner-pair-recorded"
              title={pair.reason ?? "Recorded strategies: no model was called."}
              className="ml-auto rounded-sm border border-border px-1.5 py-0.5 label-caps text-text-2"
            >
              Recorded
            </span>
          ) : null}
        </div>
        <p data-testid="owner-pair-attempts" className="text-sm text-text-2">
          {attemptsLine(a.summary.total, b.summary.total)}
        </p>
        <div className="grid grid-cols-2 gap-3">
          {pair.sides.map((s, i) => {
            const id = ids[i];
            const selected = side === id;
            return (
              <div
                key={id}
                data-testid={`owner-pair-${id}`}
                data-selected={selected}
                className={cn(
                  "flex min-w-0 flex-col gap-2 rounded-md border bg-surface-2 p-3 transition-colors duration-fast",
                  selected ? "border-border-strong shadow-[inset_0_2px_0_var(--accent)]" : "border-border",
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="label-caps text-text-3">{id.toUpperCase()}</span>
                  {madeUp[i] ? <MadeUpChip /> : null}
                </span>
                <span data-testid={`owner-pair-${id}-name`} className="line-clamp-2 min-h-10 text-sm text-text-1">
                  {s.setup.name}
                </span>
                <span
                  data-testid={`owner-pair-${id}-count`}
                  data-escaped={s.summary.escaped}
                  data-total={s.summary.total}
                  className={cn("text-xl font-semibold tabular-nums", s.summary.escaped > 0 ? "text-danger" : "text-text-1")}
                >
                  {s.summary.escaped}
                  <span className="text-text-2"> / {s.summary.total}</span>
                </span>
                <Strip summary={s.summary} testId={`owner-pair-${id}-strip`} small />
                {measures ? <MeasureChips measure={measures[i]} testId={`owner-pair-${id}-measure`} /> : null}
                <Button
                  variant={selected ? "secondary" : "ghost"}
                  data-testid={`owner-pair-show-${id}`}
                  aria-pressed={selected}
                  className="h-auto min-h-10 w-full min-w-0 py-1.5 text-center whitespace-normal"
                  onClick={() => onSide(id)}
                >
                  {selected ? "On the board" : "Show on the board"}
                </Button>
              </div>
            );
          })}
        </div>
        {pair.sides.map((s, i) =>
          s.result.dropped.length > 0 ? (
            <p key={ids[i]} data-testid={`owner-pair-${ids[i]}-dropped`} className="flex gap-3 text-sm text-text-2">
              <span className="label-caps w-4 shrink-0 pt-0.5 text-text-3">{ids[i].toUpperCase()}</span>
              <span className="min-w-0">{leftOut(s.result.dropped)}</span>
            </p>
          ) : null,
        )}
      </section>

      <section aria-labelledby="owner-pair-changed-label" className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-4">
        <h2 id="owner-pair-changed-label" className="label-caps text-text-3">
          What changed, A to B
        </h2>
        {changes.length > 0 ? (
          <ul data-testid="owner-pair-changes" className="flex flex-col gap-1">
            {changes.map((line) => (
              <li key={line} data-testid="owner-pair-change" className="font-mono text-sm text-text-1">
                {line}
              </li>
            ))}
          </ul>
        ) : (
          <p data-testid="owner-pair-changes-none" className="text-sm text-text-1">
            Nothing: the two set the same security.
          </p>
        )}
        <p data-testid="owner-pair-delta" data-delta={delta} className="text-sm text-text-1">
          <span className="font-mono tabular-nums">{deltaLine(a.summary, b.summary)}</span>
        </p>
        {measures ? <MeasureChange from={measures[0]} to={measures[1]} testId="owner-pair-measure-change" /> : null}
      </section>

      <section aria-labelledby="owner-pair-route-label" className="flex flex-col gap-2">
        <h2 id="owner-pair-route-label" className="label-caps text-text-3">
          The way most got out
        </h2>
        <ul className="flex flex-col">
          {pair.sides.map((s, i) => {
            const id = ids[i];
            const route = s.summary.topRoute;
            return (
              <li
                key={id}
                data-testid={`owner-pair-${id}-route`}
                data-count={route?.count ?? 0}
                className={cn("flex gap-3 border-b border-border py-2 last:border-b-0", side === id ? "text-text-1" : "text-text-2")}
              >
                <span className="label-caps w-4 shrink-0 pt-0.5 text-text-3">{id.toUpperCase()}</span>
                <p className="min-w-0 text-sm">
                  {route && boards ? (
                    <>
                      <span className="font-mono tabular-nums">
                        {route.count} of {s.summary.escaped}
                      </span>{" "}
                      went {routeRooms(route.nodes, boards[i]).join(" → ")}.{side === id ? " It is drawn on the board." : ""}
                    </>
                  ) : (
                    "No crew got out, so there is no way out to draw."
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="owner-pair-detector-label" className="flex flex-col gap-2">
        <h2 id="owner-pair-detector-label" className="label-caps text-text-3">
          Noticed the crew first most often
        </h2>
        <ul className="flex flex-col">
          {pair.sides.map((s, i) => {
            const id = ids[i];
            const top = s.summary.detectors[0];
            return (
              <li
                key={id}
                data-testid={`owner-pair-${id}-detector`}
                data-detector={top ? `${top.kind}:${top.id ?? ""}` : ""}
                className={cn("flex gap-3 border-b border-border py-2 last:border-b-0", side === id ? "text-text-1" : "text-text-2")}
              >
                <span className="label-caps w-4 shrink-0 pt-0.5 text-text-3">{id.toUpperCase()}</span>
                <p className="min-w-0 text-sm">
                  {top ? (
                    <>
                      <span className="font-mono">{detectorName(top)}</span>, first in{" "}
                      <span className="font-mono tabular-nums">
                        {top.count} of {s.summary.total}
                      </span>
                      .{side === id ? " It is ringed on the board." : ""}
                    </>
                  ) : (
                    "Nothing noticed the crew."
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      </section>

      {back}
    </div>
  );
}
