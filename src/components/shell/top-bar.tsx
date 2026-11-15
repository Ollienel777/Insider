import Link from "next/link";
import type { Building } from "@/domain";
import { cityName } from "@/lib/cities";
import type { ServerStatus } from "@/lib/demo-status";
import { StatusChip } from "./demo-safety";

interface TopBarProps {
  /** What the server rendered with; the chip keeps it current in the browser. */
  status: ServerStatus;
  /** The building being played, shown centre; absent on the map. */
  building?: Pick<Building, "name" | "city">;
}

/** The 56px top bar: wordmark left, building centre, mode chip right (DESIGN.md, Layout). */
export function TopBar({ status, building }: TopBarProps) {
  return (
    <header
      data-testid="top-bar"
      className="grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-border bg-surface-1 px-4 md:px-6"
    >
      <Link
        href="/"
        className="group inline-flex h-10 items-center gap-2 justify-self-start rounded-sm whitespace-nowrap font-display text-2xl font-normal tracking-wide text-text-1"
      >
        {/* The game's logo mark: a yellow key-tile with an H, like a coin on the board. */}
        <span
          aria-hidden
          className="grid size-8 -rotate-6 place-items-center rounded-sm border-2 border-border-strong bg-accent font-display text-lg text-accent-ink shadow-[inset_0_2px_0_var(--key-sheen),0_3px_0_var(--ink-shadow)] transition-transform duration-base ease-out group-hover:rotate-6"
        >
          H
        </span>
        Heist Anywhere
      </Link>
      <div data-testid="building-slot" className="min-w-0 truncate text-sm">
        {building ? (
          <>
            <span className="font-medium text-text-1">{building.name}</span>{" "}
            <span className="px-1 text-text-3 max-md:hidden">·</span>{" "}
            <span className="text-text-2 max-md:hidden">{cityName(building.city)}</span>
          </>
        ) : null}
      </div>
      <div className="justify-self-end">
        <StatusChip status={status} />
      </div>
    </header>
  );
}
