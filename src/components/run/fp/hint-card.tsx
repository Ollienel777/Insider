"use client";

// The controls, for a player handed the mouse for the first time (issue 146):
// a card at the left of the view, clear of the middle the player looks
// through, big enough to read at a glance, each control ticked off as it is
// tried. It fades once the player has walked and looked about (hint.ts);
// under reduced motion it goes at once. Shift is a walk, as the view's own
// line of keys calls it: slower, and no quieter to the engine.
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { HINT_FADE_MS, type HintPhase, type HintTicks } from "./hint";

export function ControlsHint({ phase, ticks, dragToLook }: { phase: HintPhase; ticks: HintTicks; dragToLook: boolean }) {
  if (phase === "gone") return null;
  return (
    <div
      data-testid="fp-controls-hint"
      data-phase={phase}
      aria-label="Controls"
      className={cn(
        "pointer-events-none absolute top-1/2 left-6 w-max -translate-y-1/2 rounded-md border border-border bg-surface-1/92 px-6 py-5 shadow-e-2",
        "transition-opacity ease-out",
        phase === "fading" ? "opacity-0" : "opacity-100",
      )}
      style={{ transitionDuration: `${HINT_FADE_MS}ms` }}
    >
      <ul className="grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-3 text-base text-text-1">
        <Row done={ticks.move} keys={<><Cap>W</Cap><Cap>A</Cap><Cap>S</Cap><Cap>D</Cap></>}>move</Row>
        <Row done={ticks.look} keys={<Cap wide>{dragToLook ? "Drag" : "Mouse"}</Cap>}>look around</Row>
        <Row done={ticks.sneak} keys={<Cap wide>Shift</Cap>}>walk</Row>
        <Row done={ticks.use} keys={<>hold <Cap>E</Cap></>}>at doors, to pick the lock</Row>
      </ul>
    </div>
  );
}

function Row({ done, keys, children }: { done: boolean; keys: ReactNode; children: ReactNode }) {
  return (
    <li data-done={done ? "true" : undefined} className="contents">
      <span className="flex items-center justify-end gap-1.5 text-sm text-text-2">{keys}</span>
      <span className={cn("transition-colors duration-base", done ? "text-text-3" : "text-text-1")}>{children}</span>
      <Check aria-hidden className={cn("size-4 stroke-[2] text-success transition-opacity duration-base", done ? "opacity-100" : "opacity-0")} />
    </li>
  );
}

function Cap({ children, wide }: { children: string; wide?: boolean }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-8 items-center justify-center rounded-sm border border-border-strong bg-surface-2 font-mono text-sm text-text-1",
        wide ? "px-2.5" : "min-w-8 px-1.5",
      )}
    >
      {children}
    </kbd>
  );
}
