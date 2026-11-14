import Link from "next/link";
import type { ModeChip as ModeChipState } from "@/lib/mode";
import type { Building } from "@/domain";
import { cityName } from "@/lib/cities";
import { ModeChip } from "./mode-chip";

interface TopBarProps {
  chip: ModeChipState;
  /** The building being played, shown centre; absent on the map. */
  building?: Pick<Building, "name" | "city">;
}

/** The 56px top bar: wordmark left, building centre, mode chip right (DESIGN.md, Layout). */
export function TopBar({ chip, building }: TopBarProps) {
  return (
    <header
      data-testid="top-bar"
      className="grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-border bg-surface-1 px-4 md:px-6"
    >
      <Link
        href="/"
        className="inline-flex h-10 items-center justify-self-start rounded-sm whitespace-nowrap text-base font-semibold tracking-tight text-text-1"
      >
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
        <ModeChip chip={chip} />
      </div>
    </header>
  );
}
