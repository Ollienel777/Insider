"use client";

// Builds a kit building's level on demand (#93): posts to the build route,
// says the Level Builder is working while it runs, then reloads the screen,
// which now has the level. A failed build says what failed and offers a retry.
import { useState } from "react";
import { Button } from "@/components/ui/button";

type State = { status: "idle" } | { status: "building" } | { status: "failed"; error: string };

export function BuildLevelButton({
  buildingId,
  missionId,
  initialError,
}: {
  buildingId: string;
  missionId: string;
  /** Why the last build of this level failed, when one did. */
  initialError?: string;
}) {
  const [state, setState] = useState<State>(initialError ? { status: "failed", error: initialError } : { status: "idle" });

  async function build() {
    setState({ status: "building" });
    try {
      const response = await fetch(`/api/levels/${encodeURIComponent(buildingId)}/build?m=${encodeURIComponent(missionId)}`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setState({ status: "failed", error: body.error ?? `the build route answered ${response.status}` });
        return;
      }
      // A full reload, so the layout's step rail reads the new level as well.
      window.location.reload();
    } catch (error) {
      setState({ status: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <div className="flex flex-col items-start gap-2" data-testid="build-level">
      <Button variant="primary" onClick={build} disabled={state.status === "building"} aria-busy={state.status === "building"}>
        {state.status === "building" ? "Building the level…" : state.status === "failed" ? "Try the build again" : "Build this level"}
      </Button>
      <p role="status" aria-live="polite" className="text-sm text-text-2">
        {state.status === "building"
          ? "The Level Builder is reading this building's CoStar and Vexcel data. This takes a minute or two."
          : state.status === "failed"
            ? state.error
            : "The Level Builder runs live for this building. The level stays on this server and is never saved."}
      </p>
    </div>
  );
}
