import Link from "next/link";
import { AppShell } from "@/components/shell/app-shell";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <AppShell>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="flex max-w-sm flex-col items-start gap-4">
          <p className="label-caps text-text-3">Not found</p>
          <h1 className="text-xl font-semibold text-text-1">There is no building or screen at this address.</h1>
          <Link href="/" className={buttonVariants({ variant: "secondary" })}>
            Back to the map
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
