"use client";

import { useState, type ReactNode } from "react";
import type { FloorGraph } from "@/domain";
import type { OwnerDoorLock, OwnerSetup } from "@/domain/owner-setup";
import type { OwnerSetupError } from "@/level/owner-setup";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Selection } from "./owner-board";
import {
  CAMERA_KINDS,
  clearRound,
  COMPASS,
  DOOR_LOCKS,
  removeCamera,
  removeGuard,
  setDoor,
  setTempo,
  startRound,
  toggleDesk,
  updateCamera,
} from "./owner-edit";

/** The setup being edited, and where it stands. */
export interface Draft {
  setup: OwnerSetup;
  /** Untouched since it was made from the generated security: the batch plays the generated level itself. */
  pristine: boolean;
  state: "untouched" | "editing" | "saved" | "save-failed";
}

/** What a click on a node does: select, add, or work the selected guard or camera. */
export type Tool = "select" | "guard" | "camera" | "desk" | "move" | "round";

const STATE_CHIP: Record<Draft["state"], { label: string; className: string }> = {
  untouched: { label: "Starting point", className: "text-text-2" },
  editing: { label: "Unsaved", className: "text-warning" },
  saved: { label: "Saved", className: "text-success" },
  "save-failed": { label: "Not saved", className: "text-danger" },
};

const LOCK_LABEL: Record<OwnerDoorLock, string> = { key: "Key lock", badge: "Badge reader", open: "Open" };
const KIND_LABEL = { sweeping: "Sweeping", ptz: "PTZ cycle", fixed: "Fixed" } as const;

const TOOL_HINT: Record<Tool, string> = {
  select: "Click a guard, camera, door or desk on the board.",
  guard: "Click a node to post a new guard there.",
  camera: "Click a node to mount a new camera over it.",
  desk: "Click a node to put a staffed desk there.",
  move: "Click the node to move it to.",
  round: "Click the next node of the round, each a neighbour of the last. Close the loop beside the post. Click the last node again to take it off.",
};

/**
 * The setup editor's panel (issue 125's UI): the setup's name and where it
 * stands, saved setups on this device, the tools, the selected element, and
 * every problem the validator names, each with its reason.
 */
export function SetupPanel({
  floor,
  draft,
  problems,
  selection,
  tool,
  saved,
  batchError,
  onTool,
  onSelect,
  onEdit,
  onRename,
  onSave,
  onLoad,
  onDelete,
  onReset,
}: {
  floor: FloorGraph;
  draft: Draft;
  problems: { all: OwnerSetupError[]; by: Map<string, OwnerSetupError[]> };
  selection: Selection;
  tool: Tool;
  saved: readonly OwnerSetup[];
  batchError: string | null;
  onTool: (tool: Tool) => void;
  onSelect: (selection: Selection) => void;
  onEdit: (setup: OwnerSetup) => void;
  onRename: (name: string) => void;
  onSave: () => void;
  onLoad: (name: string) => void;
  onDelete: (name: string) => void;
  onReset: () => void;
}) {
  const { setup } = draft;
  const [pick, setPick] = useState<string>("");
  const chosen = saved.some((s) => s.name === pick) ? pick : (saved[0]?.name ?? "");
  const chip = problems.all.length > 0 ? { label: `${problems.all.length} ${problems.all.length === 1 ? "problem" : "problems"}`, className: "text-danger" } : STATE_CHIP[draft.state];
  const nameMissing = setup.name.trim() === "";
  const locked = Object.values(setup.doors).filter((l) => l !== "open").length;

  return (
    <div className="flex flex-col gap-6" data-testid="owner-setup" data-state={problems.all.length > 0 ? "error" : draft.state}>
      <section aria-labelledby="owner-setup-label" className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 id="owner-setup-label" className="label-caps text-text-3">
            Your security
          </h2>
          <span data-testid="owner-setup-state" className={cn("ml-auto rounded-sm border border-border px-1.5 py-0.5 label-caps", chip.className)}>
            {chip.label}
          </span>
        </div>
        <label className="flex flex-col gap-1">
          <span className="label-caps text-text-3">Name</span>
          <input
            data-testid="owner-setup-name"
            value={setup.name}
            maxLength={80}
            onChange={(e) => onRename(e.target.value)}
            placeholder="Night shift, 3 guards"
            className="h-10 rounded-sm border border-border bg-surface-2 px-3 text-sm text-text-1 placeholder:text-text-3 focus:border-border-strong"
          />
        </label>
        <p data-testid="owner-setup-counts" className="font-mono text-sm text-text-2 tabular-nums">
          {count(setup.guards.length, "guard")} · {count(setup.cameras.length, "camera")} · {count(locked, "locked door")} ·{" "}
          {count(setup.desks.length, "desk")}
        </p>
        <p data-testid="owner-setup-note" className="text-sm text-text-2">
          {draft.state === "untouched"
            ? "This is the building's generated security in your terms. Change it to match what you really have."
            : draft.state === "saved"
              ? "Saved on this device. It never leaves this browser."
              : draft.state === "save-failed"
                ? "This browser didn't keep it: site data is blocked or full. The setup still runs here."
                : "Changed since it was last saved."}
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" data-testid="owner-save" onClick={onSave} disabled={nameMissing || problems.all.length > 0}>
            Save setup
          </Button>
          {!draft.pristine ? (
            <Button variant="ghost" data-testid="owner-reset" onClick={onReset}>
              Start over
            </Button>
          ) : null}
        </div>
        {nameMissing ? <p className="text-sm text-text-2">Give the setup a name to save it.</p> : null}
      </section>

      <section aria-labelledby="owner-saved-label" className="flex flex-col gap-2">
        <h2 id="owner-saved-label" className="label-caps text-text-3">
          Saved on this device
        </h2>
        {saved.length === 0 ? (
          <p data-testid="owner-saved-empty" className="text-sm text-text-2">
            No saved setups yet. Save one to keep it on this device.
          </p>
        ) : (
          <div className="flex gap-2">
            <select
              data-testid="owner-saved-list"
              aria-label="Saved setups"
              value={chosen}
              onChange={(e) => setPick(e.target.value)}
              className="h-10 min-w-0 flex-1 rounded-sm border border-border bg-surface-2 px-2 text-sm text-text-1"
            >
              {saved.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
            <Button variant="secondary" data-testid="owner-load" onClick={() => onLoad(chosen)}>
              Load
            </Button>
            <Button variant="ghost" data-testid="owner-delete" onClick={() => onDelete(chosen)} aria-label={`Delete ${chosen}`}>
              Delete
            </Button>
          </div>
        )}
      </section>

      <section aria-labelledby="owner-tools-label" className="flex flex-col gap-2">
        <h2 id="owner-tools-label" className="label-caps text-text-3">
          Add
        </h2>
        <Segmented
          label="Tool"
          testId="owner-tool"
          value={tool === "move" || tool === "round" ? "select" : tool}
          options={[
            ["select", "Select"],
            ["guard", "Guard"],
            ["camera", "Camera"],
            ["desk", "Desk"],
          ]}
          onChange={(t) => onTool(t as Tool)}
        />
        <p data-testid="owner-tool-hint" className="text-sm text-text-2">
          {TOOL_HINT[tool]}
        </p>
      </section>

      <Inspector
        floor={floor}
        setup={setup}
        selection={selection}
        tool={tool}
        problems={problems.by}
        onTool={onTool}
        onSelect={onSelect}
        onEdit={onEdit}
      />

      <section aria-labelledby="owner-problems-label" className="flex flex-col gap-2">
        <h2 id="owner-problems-label" className="label-caps text-text-3">
          Problems
        </h2>
        {problems.all.length === 0 ? (
          <p data-testid="owner-problems-none" className="text-sm text-text-2">
            None. The crew can play this setup.
          </p>
        ) : (
          <ul data-testid="owner-problems" className="flex flex-col gap-1">
            {problems.all.map((p, i) => (
              <li key={`${p.elementRole}-${i}`}>
                <button
                  type="button"
                  data-testid="owner-problem"
                  data-code={p.code}
                  data-role={p.elementRole}
                  onClick={() => onSelect(selectionOf(p.elementRole))}
                  className="w-full border-l-2 border-danger py-1 pl-3 text-left text-sm text-text-1 hover:bg-surface-3"
                >
                  {p.reason}.
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {batchError ? (
        <p data-testid="owner-batch-error" role="alert" className="border-l-2 border-danger pl-3 text-sm text-text-1">
          The crew didn&apos;t plan: {batchError}. Run it again.
        </p>
      ) : null}
    </div>
  );
}

function selectionOf(role: string): Selection {
  const [kind, id] = [role.slice(0, role.indexOf(":")), role.slice(role.indexOf(":") + 1)];
  return kind === "guard" || kind === "camera" || kind === "door" || kind === "desk" ? { kind, id } : null;
}

function Inspector({
  floor,
  setup,
  selection,
  tool,
  problems,
  onTool,
  onSelect,
  onEdit,
}: {
  floor: FloorGraph;
  setup: OwnerSetup;
  selection: Selection;
  tool: Tool;
  problems: Map<string, OwnerSetupError[]>;
  onTool: (tool: Tool) => void;
  onSelect: (selection: Selection) => void;
  onEdit: (setup: OwnerSetup) => void;
}) {
  const room = (nodeId: string) => {
    const node = floor.nodes.find((n) => n.id === nodeId);
    return floor.rooms.find((r) => r.id === node?.roomId)?.label ?? nodeId;
  };
  const shell = (title: string, subtitle: string, body: ReactNode, role: string) => (
    <section
      data-testid="owner-inspector"
      data-selected={role}
      aria-labelledby="owner-inspector-title"
      className="flex flex-col gap-3 rounded-md border border-border bg-surface-2 p-4"
    >
      <div className="flex items-baseline gap-2">
        <h2 id="owner-inspector-title" className="font-mono text-base text-text-1">
          {title}
        </h2>
        <p className="min-w-0 truncate text-sm text-text-2">{subtitle}</p>
      </div>
      {(problems.get(role) ?? []).map((p, i) => (
        <p key={i} data-testid="owner-inline-problem" className="border-l-2 border-danger pl-3 text-sm text-text-1">
          {p.reason}.
        </p>
      ))}
      {body}
    </section>
  );

  if (!selection) {
    return (
      <section data-testid="owner-inspector" data-selected="" className="rounded-md border border-dashed border-border p-4">
        <p className="text-sm text-text-2">Nothing selected. Click an element on the board to change it.</p>
      </section>
    );
  }

  if (selection.kind === "guard") {
    const guard = setup.guards.find((g) => g.id === selection.id);
    if (!guard) return null;
    const drawing = tool === "round";
    return shell(
      guard.id,
      guard.round.length > 1 ? `On a round of ${guard.round.length} nodes, from the ${room(guard.post)}` : `Stands a post in the ${room(guard.post)}`,
      <>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" data-testid="owner-move" aria-pressed={tool === "move"} onClick={() => onTool(tool === "move" ? "select" : "move")}>
            {tool === "move" ? "Cancel move" : "Move"}
          </Button>
          {drawing ? (
            <Button variant="secondary" data-testid="owner-round-done" onClick={() => onTool("select")}>
              Done drawing
            </Button>
          ) : (
            <Button
              variant="secondary"
              data-testid="owner-draw-round"
              onClick={() => {
                onEdit(startRound(setup, guard.id));
                onTool("round");
              }}
            >
              Draw a round
            </Button>
          )}
          {guard.round.length > 0 && !drawing ? (
            <Button variant="ghost" data-testid="owner-stand-post" onClick={() => onEdit(clearRound(setup, guard.id))}>
              Stand post
            </Button>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <span className="label-caps text-text-3">Turns per hop</span>
          <Button variant="secondary" size="icon" aria-label="Faster" onClick={() => onEdit(setTempo(setup, guard.id, guard.tempo - 1))} disabled={guard.tempo <= 1}>
            −
          </Button>
          <span data-testid="owner-tempo" className="w-6 text-center font-mono text-sm text-text-1 tabular-nums">
            {guard.tempo}
          </span>
          <Button variant="secondary" size="icon" aria-label="Slower" onClick={() => onEdit(setTempo(setup, guard.id, guard.tempo + 1))} disabled={guard.tempo >= 4}>
            +
          </Button>
        </div>
        <Button
          variant="ghost"
          data-testid="owner-remove"
          className="self-start"
          onClick={() => {
            onEdit(removeGuard(setup, guard.id));
            onSelect(null);
            onTool("select");
          }}
        >
          Remove {guard.id}
        </Button>
      </>,
      `guard:${guard.id}`,
    );
  }

  if (selection.kind === "camera") {
    const camera = setup.cameras.find((c) => c.id === selection.id);
    if (!camera) return null;
    return shell(
      camera.id,
      `Over the ${room(camera.node)}, facing ${camera.facing.toUpperCase()}`,
      <>
        <Segmented
          label="Kind"
          testId="owner-camera-kind"
          value={camera.kind}
          options={CAMERA_KINDS.map((k) => [k, KIND_LABEL[k]])}
          onChange={(kind) => onEdit(updateCamera(setup, camera.id, { kind: kind as typeof camera.kind }))}
        />
        <div className="flex flex-col gap-1">
          <span className="label-caps text-text-3">Facing</span>
          <Segmented
            label="Facing"
            testId="owner-camera-facing"
            value={camera.facing}
            options={COMPASS.map((c) => [c, c.toUpperCase()])}
            onChange={(facing) => onEdit(updateCamera(setup, camera.id, { facing: facing as typeof camera.facing }))}
            mono
          />
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" data-testid="owner-move" aria-pressed={tool === "move"} onClick={() => onTool(tool === "move" ? "select" : "move")}>
            {tool === "move" ? "Cancel move" : "Move"}
          </Button>
          <Button
            variant="ghost"
            data-testid="owner-remove"
            onClick={() => {
              onEdit(removeCamera(setup, camera.id));
              onSelect(null);
              onTool("select");
            }}
          >
            Remove {camera.id}
          </Button>
        </div>
      </>,
      `camera:${camera.id}`,
    );
  }

  if (selection.kind === "door") {
    const lock = setup.doors[selection.id] ?? "open";
    return shell(
      selection.id,
      LOCK_LABEL[lock],
      <Segmented
        label="What closes it"
        testId="owner-door-lock"
        value={lock}
        options={DOOR_LOCKS.map((l) => [l, LOCK_LABEL[l]])}
        onChange={(l) => onEdit(setDoor(setup, selection.id, l as OwnerDoorLock))}
      />,
      `door:${selection.id}`,
    );
  }

  return shell(
    "Desk",
    `Staffed all night in the ${room(selection.id)}`,
    <Button
      variant="ghost"
      data-testid="owner-remove"
      className="self-start"
      onClick={() => {
        onEdit(toggleDesk(setup, selection.id));
        onSelect(null);
      }}
    >
      Remove the desk
    </Button>,
    `desk:${selection.id}`,
  );
}

function Segmented({
  label,
  testId,
  value,
  options,
  onChange,
  mono = false,
}: {
  label: string;
  testId: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
  mono?: boolean;
}) {
  return (
    <div role="group" aria-label={label} data-testid={testId} data-value={value} className="flex flex-wrap rounded-sm border border-border">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          data-value={v}
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "h-8 min-w-10 flex-1 px-2 text-sm transition-colors duration-fast",
            mono && "font-mono",
            value === v ? "bg-surface-3 text-text-1 shadow-[inset_0_-2px_0_var(--accent)]" : "text-text-2 hover:text-text-1",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
