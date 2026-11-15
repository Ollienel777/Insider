import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface BuildingScreenProps {
  /** The visual: aerial, board or drill view. Takes the remaining width. */
  visual: ReactNode;
  /** The side panel's text. */
  panel: ReactNode;
  /** The screen's one primary action: the stamp, docked at the right end of the folder's tab row. */
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

// One sheet of paper in the open case file (issue 166).
const PAGE = "rounded-[4px] border-2 border-border bg-surface-0 shadow-[2px_3px_0_rgb(43_29_18/0.12)]";

/**
 * The open case file's spread: the visual on the left page, the side panel
 * on the right page. The primary action is the stamp: from `lg` it sits on the
 * desk at the right end of the tab row, above the folder; below `lg` it stays
 * at the foot of the panel, where the panel stacks under the visual.
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
        "grid min-h-0 flex-1 gap-3",
        panelClosed
          ? "grid-rows-[minmax(320px,1fr)]"
          : [
              visualTall ? "grid-rows-[minmax(560px,1fr)_auto]" : "grid-rows-[minmax(320px,1fr)_auto]",
              "lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)] lg:grid-rows-1",
            ],
      )}
    >
      <section aria-label={visualLabel} className={cn(PAGE, "relative min-h-0 overflow-hidden")}>
        {visual}
      </section>
      <aside hidden={panelClosed || undefined} className={cn(PAGE, "flex min-h-0 flex-col")}>
        <div data-testid="panel-body" className="min-h-0 flex-1 overflow-y-auto p-4">
          {panel}
        </div>
        {action ? (
          <div
            data-testid="stamp-dock"
            className="p-4 [&>*]:w-full lg:absolute lg:top-0 lg:right-4 lg:z-20 lg:-translate-y-[calc(100%+14px)] lg:p-0 lg:[&>*]:w-auto lg:[&>*]:min-w-[200px]"
          >
            {action}
          </div>
        ) : null}
      </aside>
    </div>
  );
}
