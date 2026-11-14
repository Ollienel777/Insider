"use client";

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { buildingHref } from "@/lib/building-href";
import { useMissionId } from "@/lib/use-mission-id";
import { cn } from "@/lib/utils";

/** The Debrief's way into Owner Mode (issue 128): the same building, played against the owner's own security. */
export function OwnerModeLink({ buildingId, className }: { buildingId: string; className?: string }) {
  const missionId = useMissionId();
  return (
    <Link
      href={buildingHref(buildingId, "owner", missionId)}
      data-testid="debrief-owner-mode"
      className={cn(buttonVariants({ variant: "ghost" }), "w-full", className)}
    >
      Owner mode: test your own security
    </Link>
  );
}
