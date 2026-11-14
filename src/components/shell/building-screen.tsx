import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface BuildingScreenProps {
  /** The visual: aerial, board or drill view. Takes the remaining width. */
  visual: ReactNode;
  /** The side panel's text. */
  panel: ReactNode;
  /** The screen's one primary action, pinned to the panel's bottom edge. */
  action?: ReactNode;
  /** The visual's accessible name, e.g. "Aerial view". */
  visualLabel: string;
  /**
   * Closes the side panel, so the visual takes the whole screen: the Run
   * screen in Live, until Details opens it (issue 100). The panel is hidden,
   * not removed: what it holds keeps its state and goes on updating, and is
   * there the moment it opens.
   */
  panelClosed?: boolean;
  /**
   * Below `lg`, where the panel stacks under the visual, gives the visual
   * more height first: the Run screen in Live, whose rows sit around the board.
   */
  visualTall?: boolean;
}

/**
 * The two-column screen (DESIGN.md, Layout): the visual on the left, a 400px
 * side panel on the right with its primary action pinned to the bottom. Below
 * `lg` the panel stacks under the visual.
 */
export function BuildingScreen({
  visual,
  panel,
  action,
  visualLabel,
  panelClosed = false,
  visualTall = false,
}: BuildingScreenProps) {
  return (
    <div
      className={cn(
        "grid min-h-0 flex-1",
        panelClosed
          ? "grid-rows-[minmax(320px,1fr)]"
          : [
              visualTall ? "grid-rows-[minmax(560px,1fr)_auto]" : "grid-rows-[minmax(320px,1fr)_auto]",
              "lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-1",
            ],
      )}
    >
      <section aria-label={visualLabel} className="relative min-h-0 overflow-hidden bg-surface-0">
        {visual}
      </section>
      <aside
        hidden={panelClosed || undefined}
        className="flex min-h-0 flex-col border-t border-border bg-surface-1 lg:border-t-0 lg:border-l"
      >
        <div data-testid="panel-body" className="min-h-0 flex-1 overflow-y-auto p-4">
          {panel}
        </div>
        {action ? <div className="border-t border-border p-4 [&>*]:w-full">{action}</div> : null}
      </aside>
    </div>
  );
}
