"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition } from "react";
import { BuildingScreen } from "@/components/shell/building-screen";
import { Button, buttonVariants } from "@/components/ui/button";

// Any building screen that throws while it renders: inside the shell (the top
// bar and step rail stay), what happened and the ways on, instead of Next's
// generic error page. A bad cached level has its own state on each screen;
// this catches the rest.
export default function BuildingError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  // These screens are server components, so `reset()` alone re-renders the
  // same payload and throws again. Refresh fetches the segment from the
  // server again, and the reset in the same transition clears the boundary.
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });
  return (
    <BuildingScreen
      visualLabel="Error"
      visual={
        <div data-testid="building-error" className="mx-auto flex h-full max-w-[720px] flex-col justify-center gap-3 px-6 py-8">
          <p className="label-caps text-danger">Something broke</p>
          <h1 className="text-xl font-semibold text-text-1">This screen failed to open</h1>
          <p className="text-base text-text-2">Try it again. If it fails the same way, pick another building.</p>
          {error.digest ? <p className="font-mono text-sm text-text-3">Error {error.digest}</p> : null}
        </div>
      }
      panel={
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-text-1">Load it again</h2>
          <Button variant="secondary" onClick={retry}>
            Try again
          </Button>
        </div>
      }
      action={
        <Link href="/map" className={buttonVariants({ variant: "primary" })}>
          Pick another building
        </Link>
      }
    />
  );
}
