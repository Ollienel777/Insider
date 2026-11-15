"use client";

// The Why card in first person (issue 115): the board's own card (why-card.tsx),
// opened on the guard, cleaner or camera the player is looking at, and set in
// the view's top right, under the mute button. While it is open the turn clock
// holds, as it does for the board's card (turn-clock.ts watches for it), so a
// judge can read it without being caught. Esc or the close button shuts it,
// and a press on it is not a look (controller.ts leaves dialogs alone).
import { useEffect } from "react";
import type { RunState } from "@/engine";
import type { PlacedLevel } from "@/level/placer";
import { CARD_WIDTH, liveSubtitle, whyTarget } from "../why";
import { WhyCard } from "../why-card";

export function WhyOverlay({ placed, run, whyKey, onClose }: { placed: PlacedLevel; run: RunState; whyKey: string; onClose: () => void }) {
  const target = whyTarget(placed, whyKey);

  // Nothing to explain (no target for the key): shut at once, so no empty card holds the clock or F.
  useEffect(() => {
    if (!target) onClose();
  }, [target, onClose]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="pointer-events-auto">
      {target ? (
        <WhyCard
          key={target.key}
          target={target}
          subtitle={liveSubtitle(placed, run, target)}
          onClose={onClose}
          className="top-14 right-6"
          style={{ width: CARD_WIDTH, maxWidth: "calc(100% - 48px)", maxHeight: "calc(100% - 136px)" }}
        />
      ) : null}
    </div>
  );
}
