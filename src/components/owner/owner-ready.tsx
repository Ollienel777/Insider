"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { BatchSummary, FloorGraph, LevelManifest } from "@/domain";
import type { OwnerSetup } from "@/domain/owner-setup";
import { deleteOwnerSetup, loadOwnerSetups, saveOwnerSetup } from "@/components/run/owner-setup-store";
import { BuildingScreen } from "@/components/shell/building-screen";
import { Button, buttonVariants } from "@/components/ui/button";
import { placeLevel, type PlacedLevel } from "@/level/placer";
import { cn } from "@/lib/utils";
import { BatchPanel, type BatchMeasures, type Side } from "./batch-panel";
import { measureSetup, type SetupMeasure } from "./setup-measure";
import { compareOptions, ComparePanel, ComparePicker, defaultPick, DemoList, type PairId } from "./compare-panel";
import { demoSetups, isDemoSetup } from "./demo-setups";
import { ownerZones } from "./owner-batch";
import { OwnerBoard, type Selection } from "./owner-board";
import {
  addCamera,
  addCleaner,
  addGuard,
  boardOf,
  extendCleanerRound,
  extendRound,
  moveCleaner,
  moveGuard,
  playable,
  problemsOf,
  setupFromPlaced,
  toggleDesk,
  updateCamera,
} from "./owner-edit";
import { OWNER_SEED, OwnerHeading, type OwnerBuilding } from "./owner-screen";
import { SetupPanel, type Draft, type Tool } from "./setup-panel";
import { useOwnerBatch } from "./use-owner-batch";
import { useOwnerCompare } from "./use-owner-compare";

/** The board's caption over a batch: how many got out, and what the board draws. */
export function boardCaption(summary: BatchSummary, side: Side | null): string {
  const lead = side === "after" ? "After the fix: " : side === "before" ? "Before: " : "";
  const out = `${summary.escaped} of ${summary.total} got out`;
  return summary.topRoute ? `${lead}${out}. The way most got out is drawn.` : `${lead}${out}. No way out to draw.`;
}

/** The board's caption over one side of a compare: "A, Demo: night shift: 7 of 50 got out. The way most got out is drawn.". */
export function pairCaption(side: PairId, name: string, summary: BatchSummary): string {
  return `${side.toUpperCase()}, ${name}: ${boardCaption(summary, null)}`;
}

/** The board header's two-way switch: before and after a fix, or the two sides of a compare. */
function SideToggle({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly (readonly [string, string, string])[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div role="group" aria-label={label} className="ml-auto flex shrink-0 rounded-sm border border-border">
      {options.map(([v, text, testId]) => (
        <button
          key={v}
          type="button"
          data-testid={testId}
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "h-8 px-3 label-caps transition-colors duration-fast",
            value === v ? "bg-surface-3 text-text-1" : "text-text-2 hover:text-text-1",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** The key of the untouched starting point. */
export const GENERATED_KEY = "generated";

/** The setup as the batch keys it: the generated level while untouched, else everything but the name. */
export const setupKey = (draft: Pick<Draft, "setup" | "pristine">) =>
  draft.pristine ? GENERATED_KEY : JSON.stringify({ ...draft.setup, name: "" });

export function OwnerReady({
  building,
  manifest,
  floor,
  debriefHref,
}: {
  building: OwnerBuilding;
  manifest: LevelManifest;
  floor: FloorGraph;
  debriefHref: string;
}) {
  const generated = useMemo(() => placeLevel(manifest, floor, OWNER_SEED), [manifest, floor]);
  // Mounted only once the floor has loaded in the browser, so storage is read here, never on the server.
  const [saved, setSaved] = useState<OwnerSetup[]>(() => loadOwnerSetups(manifest.buildingId));
  const [draft, setDraft] = useState<Draft>(() => ({ setup: setupFromPlaced(generated), pristine: true, state: "untouched" }));
  const [selection, setSelection] = useState<Selection>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [view, setView] = useState<"setup" | "results" | "compare">("setup");
  const [side, setSide] = useState<Side>("after");
  const [fixedSaved, setFixedSaved] = useState<{ key: string; ok: boolean; setup: OwnerSetup } | null>(null);
  const { batch, fix, run, suggest, apply } = useOwnerBatch(manifest, floor);
  const { pair, compare } = useOwnerCompare(manifest, floor);
  const [pairSide, setPairSide] = useState<PairId>("a");

  // The prepared demo setups (F1's pair), offered only when they fit this floor.
  const demos = useMemo(
    () => demoSetups(manifest.buildingId).filter((d) => problemsOf(d.setup, floor).all.length === 0),
    [manifest.buildingId, floor],
  );
  const options = useMemo(() => compareOptions(demos, saved), [demos, saved]);
  const [picked, setPicked] = useState<{ a: string; b: string } | null>(null);
  const valid = (v: string | undefined) => options.some((o) => o.value === v);
  const fallback = defaultPick(options);
  const pick = { a: valid(picked?.a) ? picked!.a : fallback.a, b: valid(picked?.b) ? picked!.b : fallback.b };
  const optionOf = (value: string) => options.find((o) => o.value === value) ?? null;
  // Each compared side's setup on the board, the selected one drawn with its way out.
  const pairBoards = useMemo<[PlacedLevel, PlacedLevel] | null>(() => {
    if (pair.status !== "done") return null;
    const [a, b] = pair.sides.map((s) => boardOf(manifest, floor, s.setup, OWNER_SEED) ?? generated);
    return [a, b];
  }, [pair, manifest, floor, generated]);

  const problems = useMemo(() => problemsOf(draft.setup, floor), [draft.setup, floor]);
  const key = setupKey(draft);
  const fresh = batch.status === "done" && batch.key === key;

  // The board: the setup as it stands (its problems left off), or the batch's, before or after the fix.
  const editBoard = useMemo<PlacedLevel>(
    () => boardOf(manifest, floor, playable(draft.setup, floor), OWNER_SEED) ?? generated,
    [draft, generated, manifest, floor],
  );
  // The batch's setup on the board: its Why rows are the data's for what is still generated.
  const batchBefore = useMemo<PlacedLevel | null>(
    () => (batch.status === "done" ? (boardOf(manifest, floor, batch.setup, OWNER_SEED) ?? generated) : null),
    [batch, manifest, floor, generated],
  );
  // After the fix, the board draws the setup the After batch played: the one "Save the fixed setup" stores.
  const batchBoard = useMemo<PlacedLevel | null>(() => {
    if (!batchBefore) return null;
    if (fix.status !== "applied" || side === "before" || fix.rerun.dropped || !fix.rerun.fixed) return batchBefore;
    return boardOf(manifest, floor, fix.rerun.fixed, OWNER_SEED) ?? batchBefore;
  }, [batchBefore, fix, side, manifest, floor]);

  // Coverage and open windows (issue 120): measured on each setup's board, so they follow every edit with no batch.
  const editMeasure = useMemo(() => measureSetup(editBoard), [editBoard]);
  const batchMeasures = useMemo<BatchMeasures | null>(() => {
    if (!batchBefore) return null;
    const fixed = fix.status === "applied" && !fix.rerun.dropped && fix.rerun.fixed ? boardOf(manifest, floor, fix.rerun.fixed, OWNER_SEED) : null;
    return { before: measureSetup(batchBefore), after: fixed ? measureSetup(fixed) : null };
  }, [batchBefore, fix, manifest, floor]);
  const pairMeasures = useMemo<[SetupMeasure, SetupMeasure] | null>(
    () => (pairBoards ? [measureSetup(pairBoards[0]), measureSetup(pairBoards[1])] : null),
    [pairBoards],
  );

  // An edit that changed nothing (the same object back) leaves the draft as it was.
  const edit = (next: OwnerSetup) => {
    if (next !== draft.setup) setDraft({ setup: next, pristine: false, state: "editing" });
  };

  // The side the board shows: only once a fix is applied and fitted. The caption, the
  // board's route and ring, and the panel's route and detector cards all describe it.
  const shownSide: Side | null = fix.status === "applied" && !fix.rerun.dropped ? side : null;
  const shownSummary: BatchSummary | null =
    batch.status !== "done" ? null : shownSide === "after" && fix.status === "applied" ? fix.rerun.after : batch.summary;

  const save = () => {
    const ok = saveOwnerSetup(draft.setup);
    if (ok) setSaved(loadOwnerSetups(manifest.buildingId));
    setDraft((d) => ({ ...d, state: ok ? "saved" : "save-failed" }));
  };
  const load = (name: string) => {
    const setup = saved.find((s) => s.name === name);
    if (!setup) return;
    setDraft({ setup, pristine: false, state: "saved" });
    setSelection(null);
    setTool("select");
  };
  const loadDemo = (name: string) => {
    const demo = demos.find((d) => d.setup.name === name);
    if (!demo) return;
    setDraft({ setup: demo.setup, pristine: false, state: "preset" });
    setSelection(null);
    setTool("select");
  };
  const runCompare = () => {
    const a = optionOf(pick.a);
    const b = optionOf(pick.b);
    if (!a || !b || a.value === b.value) return;
    compare(a.setup, b.setup);
    setPairSide("a");
    setView("compare");
  };
  const remove = (name: string) => {
    if (deleteOwnerSetup(manifest.buildingId, name)) setSaved(loadOwnerSetups(manifest.buildingId));
  };
  const reset = () => {
    setDraft({ setup: setupFromPlaced(generated), pristine: true, state: "untouched" });
    setSelection(null);
    setTool("select");
  };
  const runBatch = () => {
    run(draft.setup, key);
    setSide("after");
    setFixedSaved(null);
    setView("results");
  };

  // Saves exactly the setup the After batch played, so replaying it gives the After count shown.
  const saveFixed = () => {
    if (batch.status !== "done" || fix.status !== "applied" || fix.rerun.dropped || !fix.rerun.fixed) return;
    const fixed = fix.rerun.fixed;
    const ok = saveOwnerSetup(fixed);
    if (ok) setSaved(loadOwnerSetups(manifest.buildingId));
    setFixedSaved({ key: batch.key, ok, setup: fixed });
  };
  const openFixed = () => {
    if (!fixedSaved?.ok) return;
    setDraft({ setup: fixedSaved.setup, pristine: false, state: "saved" });
    setSelection(null);
    setView("setup");
  };

  const planning = batch.status === "planning";
  const action =
    view === "compare" ? (
      <Button
        variant="primary"
        data-testid="owner-pair-open"
        disabled={pair.status !== "done"}
        onClick={() => {
          if (pair.status !== "done") return;
          const setup = pair.sides[pairSide === "a" ? 0 : 1].setup;
          setDraft({ setup, pristine: false, state: isDemoSetup(setup) ? "preset" : "saved" });
          setSelection(null);
          setTool("select");
          setView("setup");
        }}
      >
        Open {pairSide.toUpperCase()} in the editor
      </Button>
    ) : view === "setup" ? (
      <div className="flex flex-col gap-2">
        {problems.all.length > 0 ? (
          <p data-testid="owner-run-blocked" className="text-sm text-text-2">
            Fix {problems.all.length === 1 ? "the problem" : `the ${problems.all.length} problems`} above to run the crew.
          </p>
        ) : null}
        <Button variant="primary" data-testid="owner-run" onClick={runBatch} disabled={planning || problems.all.length > 0}>
          {planning ? "The crew is planning…" : "Run 50 attempts"}
        </Button>
        {fresh ? (
          <Button variant="ghost" data-testid="owner-to-results" onClick={() => setView("results")}>
            Back to the results
          </Button>
        ) : null}
      </div>
    ) : batch.status !== "done" ? (
      <Button variant="primary" data-testid="owner-run" onClick={runBatch} disabled={planning || problems.all.length > 0}>
        {planning ? "The crew is planning…" : "Run 50 attempts"}
      </Button>
    ) : fix.status === "idle" || fix.status === "error" ? (
      <Button variant="primary" data-testid="owner-ask-fix" onClick={suggest}>
        Ask the Chief for a fix
      </Button>
    ) : fix.status === "asking" ? (
      <Button variant="primary" data-testid="owner-ask-fix" disabled>
        The Chief is reading the batch…
      </Button>
    ) : fix.status === "suggested" ? (
      <Button variant="primary" data-testid="owner-apply" onClick={apply}>
        Apply and rerun
      </Button>
    ) : fix.rerun.dropped ? (
      <Button variant="primary" data-testid="owner-save-fixed" disabled>
        The change didn&apos;t fit: nothing to save
      </Button>
    ) : (
      <Button variant="primary" data-testid="owner-save-fixed" onClick={saveFixed} disabled={fixedSaved?.ok === true}>
        {fixedSaved?.ok
          ? "Saved on this device"
          : fix.status === "applied" && fix.rerun.after.escaped < fix.rerun.before.escaped
            ? "Save the fixed setup"
            : "Save this setup"}
      </Button>
    );

  return (
    <BuildingScreen
      visualLabel="Owner board"
      visual={
        <div className="absolute inset-0 flex flex-col">
          <div className="flex h-14 shrink-0 items-center gap-3 px-4 sm:px-6">
            <span className="hidden label-caps text-text-2 sm:inline">
              {view === "setup"
                ? "Your security"
                : view === "compare"
                  ? "Two setups"
                  : shownSummary
                    ? `${shownSummary.total} attempts`
                    : "The crew's attempts"}
            </span>
            <span aria-hidden className="hidden h-4 w-px bg-border sm:block" />
            {/* On a phone the caption takes two lines, so the count and the side are never cut off. */}
            <span data-testid="owner-board-caption" className="line-clamp-2 min-w-0 text-xs leading-snug text-text-1 sm:truncate sm:text-sm">
              {view === "setup"
                ? draft.pristine
                  ? "The building's generated security, as a starting point"
                  : draft.setup.name || "Unnamed setup"
                : view === "compare"
                  ? pair.status === "done"
                    ? pairCaption(pairSide, pair.sides[pairSide === "a" ? 0 : 1].setup.name, pair.sides[pairSide === "a" ? 0 : 1].summary)
                    : "The crew is planning its ways in"
                  : shownSummary
                    ? boardCaption(shownSummary, shownSide)
                    : "The crew is planning its ways in"}
            </span>
            {view === "results" && fix.status === "applied" && !fix.rerun.dropped ? (
              <SideToggle
                label="Show the setup"
                options={[
                  ["before", "Before", "owner-side-before"],
                  ["after", "After", "owner-side-after"],
                ]}
                value={side}
                onChange={(s) => setSide(s as Side)}
              />
            ) : view === "compare" && pair.status === "done" ? (
              <SideToggle
                label="Show a setup"
                options={[
                  ["a", "A", "owner-pair-side-a"],
                  ["b", "B", "owner-pair-side-b"],
                ]}
                value={pairSide}
                onChange={(s) => setPairSide(s as PairId)}
              />
            ) : null}
          </div>
          <div className="relative min-h-0 flex-1">
            {view === "compare" ? (
              pair.status === "done" && pairBoards ? (
                <OwnerBoard
                  placed={pairBoards[pairSide === "a" ? 0 : 1]}
                  result={{
                    route: pair.sides[pairSide === "a" ? 0 : 1].summary.topRoute?.nodes ?? null,
                    detector: pair.sides[pairSide === "a" ? 0 : 1].summary.detectors[0] ?? null,
                  }}
                />
              ) : (
                <OwnerBoard placed={editBoard} />
              )
            ) : view === "setup" ? (
              <OwnerBoard
                placed={editBoard}
                edit={{
                  setup: draft.setup,
                  selection,
                  picking: tool !== "select",
                  problems: new Set(problems.by.keys()),
                  onNode: (nodeId) => onNode(nodeId),
                  onCamera: (id) => tool === "select" && setSelection({ kind: "camera", id }),
                  onDoor: (id) => tool === "select" && setSelection({ kind: "door", id }),
                }}
              />
            ) : batchBoard ? (
              <OwnerBoard
                placed={batchBoard}
                result={{
                  route: shownSummary?.topRoute?.nodes ?? null,
                  detector: shownSummary?.detectors[0] ?? null,
                }}
              />
            ) : (
              <OwnerBoard placed={editBoard} />
            )}
          </div>
          <div className="flex h-12 shrink-0 items-center px-6">
            <p className="text-sm text-text-2">
              {view === "setup"
                ? "Click a guard, cleaner, camera, door or desk to change it, or pick a tool to add one."
                : view === "compare"
                  ? "Both setups meet the same strategies on the same ten nights, so only the setup differs."
                  : "The crew plays each strategy on ten nights: different rounds, sweeps and nerve."}
            </p>
          </div>
        </div>
      }
      panel={
        <div className="flex flex-col gap-6">
          <OwnerHeading name={building.name} />
          {view === "setup" ? (
            <SetupPanel
              floor={floor}
              draft={draft}
              problems={problems}
              selection={selection}
              tool={tool}
              saved={saved}
              batchError={batch.status === "error" ? batch.message : null}
              onTool={(t) => {
                setTool(t);
                if (t !== "select" && t !== "move" && t !== "round") setSelection(null);
              }}
              onSelect={setSelection}
              onEdit={edit}
              onRename={(name) => setDraft((d) => ({ ...d, setup: { ...d.setup, name }, state: d.pristine ? "untouched" : "editing" }))}
              onSave={save}
              onLoad={load}
              onDelete={remove}
              onReset={reset}
              measure={editMeasure}
              extra={
                <>
                  <DemoList demos={demos} onLoad={loadDemo} />
                  <ComparePicker
                    options={options}
                    pick={pick}
                    planning={pair.status === "planning"}
                    onPick={setPicked}
                    onCompare={runCompare}
                  />
                </>
              }
            />
          ) : view === "compare" ? (
            <ComparePanel
              pair={pair}
              floor={floor}
              boards={pairBoards}
              madeUp={pair.status === "done" ? [isDemoSetup(pair.sides[0].setup), isDemoSetup(pair.sides[1].setup)] : [false, false]}
              side={pairSide}
              measures={pairMeasures}
              onSide={setPairSide}
              onRetry={runCompare}
              onBack={() => setView("setup")}
            />
          ) : (
            <BatchPanel
              batch={batch}
              fix={fix}
              zones={ownerZones(manifest, floor)}
              generated={batchBefore ?? generated}
              setupName={batch.status === "done" && batch.key !== GENERATED_KEY ? batch.setup.name : null}
              stale={batch.status === "done" && !fresh}
              fixedSaved={fixedSaved}
              side={side}
              board={batchBoard ?? undefined}
              measures={batchMeasures}
              onEdit={() => setView("setup")}
              onRetry={runBatch}
              onOpenFixed={openFixed}
            />
          )}
          <Link href={debriefHref} data-testid="owner-back" className={cn(buttonVariants({ variant: "ghost" }), "self-start")}>
            Back to the debrief
          </Link>
        </div>
      }
      action={action}
    />
  );

  function onNode(nodeId: string) {
    const setup = draft.setup;
    if (tool === "move" && selection && (selection.kind === "guard" || selection.kind === "cleaner" || selection.kind === "camera")) {
      edit(
        selection.kind === "guard"
          ? moveGuard(setup, selection.id, nodeId)
          : selection.kind === "cleaner"
            ? moveCleaner(setup, selection.id, nodeId)
            : updateCamera(setup, selection.id, { node: nodeId }),
      );
      setTool("select");
      return;
    }
    if (tool === "round" && (selection?.kind === "guard" || selection?.kind === "cleaner")) {
      edit(selection.kind === "guard" ? extendRound(setup, selection.id, nodeId) : extendCleanerRound(setup, selection.id, nodeId));
      return;
    }
    if (tool === "guard" || tool === "cleaner" || tool === "camera") {
      const added =
        tool === "guard" ? addGuard(setup, nodeId, generated.level.patrolTempo) : tool === "cleaner" ? addCleaner(setup, nodeId) : addCamera(setup, nodeId);
      edit(added.setup);
      setSelection({ kind: tool, id: added.id });
      setTool("select");
      return;
    }
    if (tool === "desk") {
      const has = setup.desks.includes(nodeId);
      edit(toggleDesk(setup, nodeId));
      setSelection(has ? null : { kind: "desk", id: nodeId });
      setTool("select");
      return;
    }
    // Select: a guard posted here or a cleaner starting here (the next one on each click), a camera mounted here, or a desk.
    const here: Selection[] = [
      ...setup.guards.filter((g) => g.post === nodeId).map((g) => ({ kind: "guard" as const, id: g.id })),
      ...(setup.cleaners ?? []).filter((c) => c.round[0] === nodeId).map((c) => ({ kind: "cleaner" as const, id: c.id })),
    ];
    if (here.length > 0) {
      const at = here.findIndex((w) => w!.kind === selection?.kind && w!.id === selection.id);
      setSelection(here[(at + 1) % here.length]);
      return;
    }
    const camera = setup.cameras.find((c) => c.node === nodeId);
    if (camera) return setSelection({ kind: "camera", id: camera.id });
    if (setup.desks.includes(nodeId)) return setSelection({ kind: "desk", id: nodeId });
    setSelection(null);
  }
}
