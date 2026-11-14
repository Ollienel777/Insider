"use client";

// The Inside view (SPEC §4.5, issue 28): on a board built from a live scan, a
// Showcase player in the side panel that moves to the player's sweep on every
// hop. The board's node ids are the scan's sweep ids, so the player's node is
// where the view goes. It only moves the camera: nothing is read from it, and
// nothing leaves the page.
//
// The Run screen renders this only on a live scan; on fixtures (the demo path
// and the smoke) there is no panel at all.
import { useEffect, useRef, useState } from "react";
import type { InsideView } from "@/adapters/matterport";
import { LayerDot } from "@/components/shell/layer-dot";
import { Skeleton } from "@/components/ui/skeleton";

type Status = "connecting" | "ready" | "failed";

export function InsideViewPanel({
  open,
  sweepId,
}: {
  /** Opens the player in the element given; from `insideViewFor`. */
  open: (parent: HTMLElement) => Promise<InsideView>;
  /** The player's node on the board: a sweep id of the scan. */
  sweepId: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<InsideView | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const latestSweep = useRef(sweepId);

  useEffect(() => {
    latestSweep.current = sweepId;
  }, [sweepId]);

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    let active = true;
    open(parent).then(
      (opened) => {
        if (!active) return opened.disconnect();
        view.current = opened;
        setStatus("ready");
        void opened.moveTo(latestSweep.current);
      },
      (error: unknown) => {
        if (!active) return;
        console.warn(`Matterport: the Inside view did not open (${error instanceof Error ? error.message : String(error)})`);
        setStatus("failed");
      },
    );
    return () => {
      active = false;
      view.current?.disconnect();
      view.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (status === "ready") void view.current?.moveTo(sweepId);
  }, [sweepId, status]);

  return (
    <section aria-labelledby="inside-view-label" data-testid="inside-view" data-status={status} className="flex flex-col gap-2">
      <h2 id="inside-view-label" className="flex items-center gap-2 label-caps text-text-3">
        <LayerDot layer="matterport" decorative />
        Inside view
      </h2>
      <div className="relative aspect-video overflow-hidden rounded-md border border-border bg-surface-1">
        <div ref={host} className="absolute inset-0" />
        {status === "connecting" ? <Skeleton className="absolute inset-0 rounded-none bg-surface-1" /> : null}
        {status === "failed" ? (
          <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-text-2">
            The scan&apos;s player didn&apos;t open. The board still plays on the scan.
          </p>
        ) : null}
      </div>
      <p className="text-sm text-text-2">The scan at your spot. It follows each hop.</p>
    </section>
  );
}
