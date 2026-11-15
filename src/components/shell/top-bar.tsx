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

/** The things lying on the desk above the case file: the game's card, the building's label, the mode chip (issue 166). */
export function TopBar({ status, building }: TopBarProps) {
  return (
    <header
      data-testid="top-bar"
      data-chrome
      className="grid h-14 shrink-0 grid-cols-[1fr_minmax(0,auto)_1fr] items-center gap-4 px-1 max-md:grid-cols-[auto_minmax(0,1fr)_auto] max-md:gap-2"
    >
      <Link
        href="/"
        className="inline-flex h-10 -rotate-3 items-center justify-self-start rounded-[6px] border-[3px] border-border-strong bg-n-950 px-3 font-display text-2xl font-normal whitespace-nowrap tracking-wide text-text-1 max-md:h-9 max-md:px-2 max-md:text-base shadow-[4px_5px_0_rgb(0_0_0/0.3)] transition-transform duration-fast hover:-rotate-1"
      >
        Hobbs<span className="text-danger">.</span>
      </Link>
      <div data-testid="building-slot" className="min-w-0 truncate font-hand text-base text-n-950 [text-shadow:1px_2px_0_rgb(0_0_0/0.4)]">
        {building ? (
          <>
            <span>{building.name}</span>{" "}
            <span className="px-1 opacity-70 max-md:hidden">·</span>{" "}
            <span className="opacity-85 max-md:hidden">{cityName(building.city)}</span>
          </>
        ) : null}
      </div>
      <div className="justify-self-end">
        <StatusChip status={status} />
      </div>
    </header>
  );
}
