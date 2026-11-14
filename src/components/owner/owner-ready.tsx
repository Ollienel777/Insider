"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { BatchSummary, FloorGraph, LevelManifest } from "@/domain";
import type { OwnerSetup } from "@/domain/owner-setup";
import { applyFix } from "@/engine";
import { deleteOwnerSetup, loadOwnerSetups, saveOwnerSetup } from "@/components/run/owner-setup-store";
import { BuildingScreen } from "@/components/shell/building-screen";
import { Button, buttonVariants } from "@/components/ui/button";
import { placeLevel, type PlacedLevel } from "@/level/placer";
import { cn } from "@/lib/utils";
import { BatchPanel, type Side } from "./batch-panel";
import { toEngineFix } from "./chief-fix";
import { OwnerBoard, type Selection } from "./owner-board";
import { ownerZones } from "./owner-batch";
import {
  addCamera,
  addGuard,
  boardOf,
  extendRound,
  moveGuard,
  playable,
  problemsOf,
  setupFromPlaced,
  setupWithFix,
  toggleDesk,
  updateCamera,
} from "./owner-edit";
import { OWNER_SEED, OwnerHeading, type OwnerBuilding } from "./owner-screen";
import { SetupPanel, type Draft, type Tool } from "./setup-panel";
import { useOwnerBatch } from "./use-owner-batch";

/** The board's caption over a batch: how many got out, and what the board draws. */
export function boardCaption(summary: BatchSummary, side: Side | null): string {
  const lead = side === "after" ? "After the fix: " : side === "before" ? "Before: " : "";
  const out = `${summary.escaped} of ${summary.total} got out`;
  return summary.topRoute ? `${lead}${out}. The way most got out is drawn` : `${lead}${out}. No way out to draw`;
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
  const [view, setView] = useState<"setup" | "results">("setup");
  const [side, setSide] = useState<Side>("after");
  const [fixedSaved, setFixedSaved] = useState<{ key: string; ok: boolean; setup: OwnerSetup } | null>(null);
  const { batch, fix, run, suggest, apply } = useOwnerBatch(manifest, floor);

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
  const batchBoard = useMemo<PlacedLevel | null>(() => {
    if (!batchBefore) return null;
    const before = batchBefore;
    if (fix.status !== "applied" || side === "before" || fix.rerun.dropped) return before;
    const engineFix = toEngineFix(fix.answer.fix, ownerZones(manifest, floor));
    const applied = applyFix(before.level, engineFix.change);
    if (!applied.ok) return before;
    const cameras = before.cameras.map((c) => {
      const spec = applied.level.cameras?.find((s) => s.id === c.id);
      return spec ? { ...c, cover: spec.cover } : c;
    });
    return { ...before, level: applied.level, cameras };
  }, [batchBefore, fix, side, manifest, floor]);

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

  const saveFixed = () => {
    if (batch.status !== "done" || fix.status !== "applied" || fix.rerun.dropped) return;
    const base = batch.setup;
    const engineFix = toEngineFix(fix.answer.fix, ownerZones(manifest, floor));
    const name = `${base.name}, after the fix`.slice(0, 80);
    const fixed = setupWithFix(base, engineFix, generated.level, name);
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
    view === "setup" ? (
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
        {fixedSaved?.ok ? "Saved on this device" : "Save the fixed setup"}
      </Button>
    );

  return (
    <BuildingScreen
      visualLabel="Owner board"
      visual={
        <div className="absolute inset-0 flex flex-col">
          <div className="flex h-14 shrink-0 items-center gap-3 px-6">
            <span className="label-caps text-text-2">{view === "setup" ? "Your security" : shownSummary ? `${shownSummary.total} attempts` : "The crew's attempts"}</span>
            <span aria-hidden className="h-4 w-px bg-border" />
            <span data-testid="owner-board-caption" className="truncate text-sm text-text-1">
              {view === "setup"
                ? draft.pristine
                  ? "The building's generated security, as a starting point"
                  : draft.setup.name || "Unnamed setup"
                : shownSummary
                  ? boardCaption(shownSummary, shownSide)
                  : "The crew is planning its ways in"}
            </span>
            {view === "results" && fix.status === "applied" && !fix.rerun.dropped ? (
              <div role="group" aria-label="Show the setup" className="ml-auto flex rounded-sm border border-border">
                {(["before", "after"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    data-testid={`owner-side-${s}`}
                    aria-pressed={side === s}
                    onClick={() => setSide(s)}
                    className={cn(
                      "h-8 px-3 label-caps transition-colors duration-fast",
                      side === s ? "bg-surface-3 text-text-1" : "text-text-2 hover:text-text-1",
                    )}
                  >
                    {s === "before" ? "Before" : "After"}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="relative min-h-0 flex-1">
            {view === "setup" ? (
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
                ? "Click a guard, camera, door or desk to change it, or pick a tool to add one."
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
    if (tool === "move" && selection && (selection.kind === "guard" || selection.kind === "camera")) {
      edit(selection.kind === "guard" ? moveGuard(setup, selection.id, nodeId) : updateCamera(setup, selection.id, { node: nodeId }));
      setTool("select");
      return;
    }
    if (tool === "round" && selection?.kind === "guard") {
      edit(extendRound(setup, selection.id, nodeId));
      return;
    }
    if (tool === "guard" || tool === "camera") {
      const added = tool === "guard" ? addGuard(setup, nodeId, generated.level.patrolTempo) : addCamera(setup, nodeId);
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
    // Select: a guard posted here (the next one on each click), a camera mounted here, or a desk.
    const here = setup.guards.filter((g) => g.post === nodeId);
    if (here.length > 0) {
      const at = selection?.kind === "guard" ? here.findIndex((g) => g.id === selection.id) : -1;
      setSelection({ kind: "guard", id: here[(at + 1) % here.length].id });
      return;
    }
    const camera = setup.cameras.find((c) => c.node === nodeId);
    if (camera) return setSelection({ kind: "camera", id: camera.id });
    if (setup.desks.includes(nodeId)) return setSelection({ kind: "desk", id: nodeId });
    setSelection(null);
  }
}
