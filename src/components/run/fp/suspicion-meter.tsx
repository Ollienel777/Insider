"use client";

// Being noticed, in first person (issue 146): one suspicion meter at the top
// of the view, saying how near the player is to being noticed and who by, so
// stepping into a camera reads as the cause of the alarm. What it shows is
// `noticeOf` (notice.ts), read from the engine's run state alone. Under
// reduced motion it does not pulse; the levels still show.
import { Ear, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Notice } from "./notice";

const TONE_VAR = { calm: "var(--n-500)", warning: "var(--warning)", danger: "var(--danger)" } as const;
const SEGMENTS = 5;

const KEYFRAMES = `
@keyframes fp-meter-pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.45 } }
@media (prefers-reduced-motion: reduce) { [data-fp-motion] { animation: none !important } }
`;

export function SuspicionMeter({ notice }: { notice: Notice }) {
  const colour = TONE_VAR[notice.tone];
  const seen = notice.seenBy.length > 0;
  // The line's own sense: the ear when it is about noise, the eye otherwise.
  const Icon = notice.cause === "heard" || notice.cause === "earshot" ? Ear : Eye;
  return (
    <>
      <style>{KEYFRAMES}</style>
      <div
        data-testid="fp-notice"
        data-tone={notice.tone}
        data-level={notice.level}
        data-cause={notice.cause}
        role="status"
        aria-live="polite"
        aria-label={`Suspicion: ${notice.reason}`}
        className="pointer-events-none absolute top-14 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-md border bg-surface-1/92 px-4 py-2.5 shadow-e-1"
        style={{ borderColor: notice.level > 0 ? colour : "var(--border)" }}
      >
        <Icon aria-hidden className="size-5 shrink-0 stroke-[1.75]" style={{ color: colour }} />
        <span aria-hidden data-fp-motion className="flex gap-1" style={{ animation: seen ? "fp-meter-pulse 0.9s ease-in-out infinite" : undefined }}>
          {Array.from({ length: SEGMENTS }, (_, i) => (
            <span
              key={i}
              className="h-3.5 w-5 rounded-[2px] transition-colors duration-fast"
              style={{ background: notice.level >= (i + 1) / SEGMENTS - 0.001 ? colour : "var(--n-800)" }}
            />
          ))}
        </span>
        <span className={cn("text-base font-semibold whitespace-nowrap", notice.level > 0 ? "text-text-1" : "text-text-2")}>{notice.reason}</span>
      </div>
    </>
  );
}
