import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

interface CastUnavailableProps {
  missionId: string;
  title?: string;
  /** `unknown`: no such mission; `missing`: no cached shortlist yet; `invalid`: the cached one fails its schema. */
  reason: "unknown" | "missing" | "invalid";
}

const COPY = {
  unknown: {
    label: "No such mission",
    body: "The mission library has five missions, and this address names none of them.",
  },
  missing: {
    label: "Not cast yet",
    body: "The Casting Director runs ahead of the demo, per mission. Cast this one, then reload.",
  },
  invalid: {
    label: "Shortlist failed its check",
    body: "The cached shortlist in data/casting/ does not match the schema. Cast it again, then reload.",
  },
} as const;

/** The cast screen without a shortlist to replay: what happened, and the one way on. */
export function CastUnavailable({ missionId, title, reason }: CastUnavailableProps) {
  const copy = COPY[reason];
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div data-testid="cast-unavailable" data-reason={reason} className="flex max-w-lg min-w-0 flex-col items-start gap-3">
        <p className="label-caps text-danger">{copy.label}</p>
        <h1 className="text-xl font-semibold break-words text-text-1">
          {reason === "unknown" ? (
            <>
              There is no mission called <span className="font-mono">{missionId}</span>.
            </>
          ) : (
            `${title ?? missionId} has no shortlist to replay.`
          )}
        </h1>
        <p className="text-base text-text-2">{copy.body}</p>
        {reason === "unknown" ? null : (
          <code className="rounded-sm border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-text-1">
            npm run cast -- {missionId}
          </code>
        )}
        <Link href="/" className={`${buttonVariants({ variant: "primary" })} mt-2`}>
          Pick a mission
        </Link>
      </div>
    </div>
  );
}
