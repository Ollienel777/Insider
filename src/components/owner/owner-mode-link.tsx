"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The Owner screen's address, carrying the chosen mission (`?m=`) when there is one. */
export function ownerHref(buildingId: string, mission?: string | null): string {
  const base = `/b/${encodeURIComponent(buildingId)}/owner`;
  return mission ? `${base}?m=${encodeURIComponent(mission)}` : base;
}

/** The Debrief's way into Owner Mode (issue 128): the same building, played against the owner's own security. */
export function OwnerModeLink({ buildingId, className }: { buildingId: string; className?: string }) {
  const mission = useSearchParams()?.get("m") ?? null;
  return (
    <Link
      href={ownerHref(buildingId, mission)}
      data-testid="debrief-owner-mode"
      className={cn(buttonVariants({ variant: "ghost" }), "w-full", className)}
    >
      Owner mode: test your own security
    </Link>
  );
}
