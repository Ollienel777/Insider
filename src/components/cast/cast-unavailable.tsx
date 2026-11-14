import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

interface CastUnavailableProps {
  missionId: string;
  title: string;
  /** `missing`: no shortlist cast yet; `unreadable`: its file cannot be read or parsed; `invalid`: it fails its schema. */
  reason: "missing" | "unreadable" | "invalid";
}

const COPY = {
  missing: {
    label: "Not cast yet",
    body: "The Casting Director runs ahead of the demo, per mission, and has not cast this one. Cast it, then reload.",
  },
  unreadable: {
    label: "Shortlist unreadable",
    body: "This mission's cached shortlist could not be read. Cast it again, then reload.",
  },
  invalid: {
    label: "Shortlist failed its check",
    body: "This mission's cached shortlist does not match the schema. Cast it again, then reload.",
  },
} as const;

/** The cast screen for a known mission without a shortlist to replay: what happened, and the one way on. */
export function CastUnavailable({ missionId, title, reason }: CastUnavailableProps) {
  const copy = COPY[reason];
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div data-testid="cast-unavailable" data-reason={reason} className="flex max-w-lg min-w-0 flex-col items-start gap-3">
        <p className="label-caps text-danger">{copy.label}</p>
        <h1 className="text-xl font-semibold break-words text-text-1">{title} has no shortlist to replay.</h1>
        <p className="text-base text-text-2">{copy.body}</p>
        <code className="rounded-sm border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-text-1">
          npm run cast -- {missionId}
        </code>
        <Link href="/" className={`${buttonVariants({ variant: "primary" })} mt-2`}>
          Pick a mission
        </Link>
      </div>
    </div>
  );
}
