import Link from "next/link";
import { Check, Lock } from "lucide-react";
import { buildingHref } from "@/lib/building-href";
import { cn } from "@/lib/utils";
import { FACTS_ONLY_NOTE, FACTS_ONLY_STEPS, STEPS, type StepSegment, type StepState } from "./steps";

// The whole game as folder tabs on the case file's top edge (issue 166), on
// every screen: Missions, Cast, the building's steps, then Owner Mode. A tab
// you have not reached yet is pushed back into the stack, shaded and locked;
// Owner Mode is always open. Drill Mode is on hold, so it has no tab. The row
// never wraps: the tabs shrink first.
const TAB = cn(
  "relative inline-flex h-10 min-w-0 shrink items-center gap-1.5 overflow-hidden rounded-t-[12px] border-[3px] border-b-0 border-border-strong",
  "px-[clamp(6px,0.9vw,12px)] font-hand text-[clamp(12px,1.05vw,15px)] whitespace-nowrap",
  "transition-transform duration-fast ease-out",
);
const NUM = "grid h-5 min-w-5 shrink-0 place-items-center rounded-[6px] border-2 border-border-strong bg-n-950 px-1 font-display text-xs leading-none";

/** Where the demo's Owner Mode opens before a building is cast: the showcase building. */
const OWNER_DEMO_HREF = buildingHref("F1", "owner", null);

export type RailTab = "missions" | "cast" | Exclude<StepSegment, "drill">;
export const RAIL_TABS: readonly { tab: RailTab; label: string }[] = [
  { tab: "missions", label: "Missions" },
  { tab: "cast", label: "Cast" },
  ...STEPS.filter((s) => s.segment !== "drill").map((s) => ({ tab: s.segment as RailTab, label: s.label })),
];

function TabLink({ href, label, n, state }: { href: string; label: string; n: number; state: StepState }) {
  return (
    <Link
      href={href}
      aria-current={state === "current" ? "page" : undefined}
      data-state={state}
      className={cn(
        TAB,
        state === "current"
          ? "z-10 translate-y-0 bg-manila text-text-1"
          : "translate-y-[5px] bg-manila-2 text-text-1 hover:translate-y-[2px]",
      )}
    >
      <span aria-hidden className={NUM}>{n}</span>
      {state === "done" ? <Check aria-hidden className="size-4 shrink-0 stroke-[2.5] text-success" /> : null}
      <span className="min-w-0 truncate">{label}</span>
      {state === "done" ? <span className="sr-only">(done)</span> : null}
    </Link>
  );
}

/**
 * The furthest tab the screen itself reaches: its own tab, or every tab on a
 * building page that has none (Drill) or on Owner Mode.
 */
export function reachedIndex(current: string | null, buildingId: string | null): number {
  if (current === "owner") return RAIL_TABS.length;
  const at = RAIL_TABS.findIndex((t) => t.tab === current);
  return at >= 0 ? at : buildingId ? RAIL_TABS.length : 0;
}

/** A tab not reached yet, or a step a building does not have: shown in the stack, shaded, not linked. */
function TabLocked({ label, n, why, state }: { label: string; n: number; why: string; state: string }) {
  return (
    <span
      aria-disabled="true"
      title={why}
      data-state={state}
      className={cn(TAB, "translate-y-[9px] cursor-not-allowed bg-manila-locked text-text-1/55")}
    >
      <span aria-hidden className={cn(NUM, "bg-n-800")}>{n}</span>
      <span className="min-w-0 truncate">{label}</span>
      <Lock aria-hidden className="size-3.5 shrink-0 stroke-[2.5] opacity-60" />
      <span className="sr-only"> ({why})</span>
    </span>
  );
}

/**
 * The tabs, with the current screen given: "missions", "cast", a building
 * step, "owner", or a building page that has no tab (Drill), where every step
 * before it counts as reached. `StepRail` supplies it on building screens.
 */
export function StepRailView({
  buildingId = null,
  current,
  missionId = null,
  factsOnly = false,
  reachedAtLeast = 0,
}: {
  /** The furthest tab opened before (RememberedRailView): every tab up to it stays open. */
  reachedAtLeast?: number;
  /** The building on screen; none on the mission picker and the cast screen. */
  buildingId?: string | null;
  current: string | null;
  /** The chosen mission, carried on every step as `?m=` (issue 119). */
  missionId?: string | null;
  /** A kit building (`isFactsOnly`): only Scout and the Dossier are linked; the rest are shown off. */
  factsOnly?: boolean;
}) {
  const owner = current === "owner";
  const at = RAIL_TABS.findIndex((t) => t.tab === current);
  // A building page without a tab of its own (Drill) comes after every step; a tab opened before stays open.
  const reached = Math.max(reachedIndex(current, buildingId), reachedAtLeast);
  const href = (tab: RailTab): string | null => {
    if (tab === "missions") return "/";
    if (tab === "cast") return missionId ? `/m/${encodeURIComponent(missionId)}/cast` : null;
    return buildingId ? buildingHref(buildingId, tab, missionId) : null;
  };
  const renderTab = ({ tab, label }: (typeof RAIL_TABS)[number], i: number) => {
    const n = i + 1;
    if (factsOnly && i >= 2 && !FACTS_ONLY_STEPS.includes(tab as StepSegment)) {
      return <TabLocked label={label} n={n} why={FACTS_ONLY_NOTE} state="off" />;
    }
    const to = href(tab);
    if (i > reached || to === null) {
      const before = RAIL_TABS[i - 1]?.label ?? "the step before";
      return <TabLocked label={label} n={n} why={i === 1 ? "Pick a mission first" : `Finish ${before} first`} state="upcoming" />;
    }
    // Before the screen's tab: done. After it: opened before, so open, but not ticked.
    return <TabLink href={to} label={label} n={n} state={i === at ? "current" : at >= 0 && i > at ? "upcoming" : "done"} />;
  };
  return (
    <nav aria-label="Steps" className="min-w-0 flex-1 pl-[clamp(8px,1.6vw,22px)] max-lg:overflow-x-auto max-lg:[scrollbar-width:none]">
      <ol className="flex min-w-0 flex-nowrap items-end gap-1">
        {RAIL_TABS.map((t, i) => (
          <li key={t.tab} className="flex min-w-0 shrink">
            {renderTab(t, i)}
          </li>
        ))}
        {factsOnly ? null : (
          <li className="flex min-w-0 shrink">
            <TabLink
              href={buildingId ? buildingHref(buildingId, "owner", missionId) : OWNER_DEMO_HREF}
              label="Owner Mode"
              n={RAIL_TABS.length + 1}
              state={owner ? "current" : "upcoming"}
            />
          </li>
        )}
      </ol>
    </nav>
  );
}
