import type { ReactNode } from "react";

interface BuildingScreenProps {
  /** The visual: aerial, board or drill view. Takes the remaining width. */
  visual: ReactNode;
  /** The side panel's text. */
  panel: ReactNode;
  /** The screen's one primary action, pinned to the panel's bottom edge. */
  action?: ReactNode;
  /** The visual's accessible name, e.g. "Aerial view". */
  visualLabel: string;
}

/**
 * The two-column screen (DESIGN.md, Layout): the visual on the left, a 400px
 * side panel on the right with its primary action pinned to the bottom. Below
 * `lg` the panel stacks under the visual.
 */
export function BuildingScreen({ visual, panel, action, visualLabel }: BuildingScreenProps) {
  return (
    <div className="grid min-h-0 flex-1 grid-rows-[minmax(320px,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-1">
      <section aria-label={visualLabel} className="relative min-h-0 overflow-hidden bg-surface-0">
        {visual}
      </section>
      <aside className="flex min-h-0 flex-col border-t border-border bg-surface-1 lg:border-t-0 lg:border-l">
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{panel}</div>
        {action ? <div className="border-t border-border p-4 [&>*]:w-full">{action}</div> : null}
      </aside>
    </div>
  );
}
