"use client";

// Being noticed, in first person (issue 146): one suspicion meter under the
// board's top bar, saying how near the player is to being noticed and who by,
// and a ripple when the last turn made noise. What it shows is `noticeOf` and
// `noiseCue` (notice.ts), read from the engine's run state alone. Under
// reduced motion nothing pulses or ripples; the levels still show.
import { Ear, Eye, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NoiseCue, Notice } from "./notice";

const TONE_VAR = { calm: "var(--n-500)", warning: "var(--warning)", danger: "var(--danger)" } as const;
const SEGMENTS = 5;

const KEYFRAMES = `
@keyframes fp-meter-pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.5 } }
@keyframes fp-noise-ripple { from { transform: translate(-50%, -50%) scale(0.3); opacity: 0.9 } to { transform: translate(-50%, -50%) scale(1); opacity: 0 } }
@media (prefers-reduced-motion: reduce) { [data-fp-motion] { animation: none !important } }
`;

export function SuspicionMeter({ notice, noise, turn }: { notice: Notice; noise: NoiseCue; turn: number }) {
  const colour = TONE_VAR[notice.tone];
  const seen = notice.seenBy.length > 0;
  const Icon = notice.heardBy.length > 0 || (notice.level > 0 && notice.level <= 0.2) ? Ear : Eye;
  return (
    <>
      <style>{KEYFRAMES}</style>
      <div
        data-testid="fp-notice"
        data-tone={notice.tone}
        data-level={notice.level}
        role="status"
        aria-live="polite"
        className="pointer-events-none absolute top-14 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-sm border border-border bg-surface-1/92 px-3.5 py-2 shadow-e-1"
        style={{ borderColor: notice.level > 0 ? colour : undefined }}
      >
        <Icon aria-hidden className="size-5 shrink-0 stroke-[1.75]" style={{ color: colour }} />
        <span aria-hidden data-fp-motion className="flex gap-1" style={{ animation: seen ? "fp-meter-pulse 0.9s ease-in-out infinite" : undefined }}>
          {Array.from({ length: SEGMENTS }, (_, i) => (
            <span
              key={i}
              className="h-3 w-4 rounded-[2px] transition-colors duration-fast"
              style={{ background: notice.level >= (i + 1) / SEGMENTS - 0.001 ? colour : "var(--n-800)" }}
            />
          ))}
        </span>
        <span className={cn("text-sm font-medium whitespace-nowrap", notice.level > 0 ? "text-text-1" : "text-text-2")}>{notice.reason}</span>
      </div>

      {noise.loud ? (
        <div key={turn} data-testid="fp-noise" data-heard={noise.heardBy.join(" ")} className="pointer-events-none absolute inset-0">
          <span
            aria-hidden
            data-fp-motion
            className="absolute top-1/2 left-1/2 size-[min(60vh,60vw)] rounded-full border-4"
            style={{ borderColor: noise.heardBy.length > 0 ? "var(--warning)" : "var(--n-300)", animation: "fp-noise-ripple 0.7s ease-out both" }}
          />
          <p className="absolute top-[calc(50%+2.5rem)] left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-sm bg-surface-1/90 px-2.5 py-1 font-mono text-xs tracking-[0.06em] text-text-1 uppercase shadow-e-1">
            <Volume2 aria-hidden className="size-3.5" style={{ color: noise.heardBy.length > 0 ? "var(--warning)" : "var(--n-300)" }} />
            {noise.kind === "pick" ? "Lock noise" : "Sprint noise"}
            {noise.heardBy.length > 0 ? ` · heard by ${noise.heardBy.join(", ")}` : " · no one heard"}
          </p>
        </div>
      ) : null}
    </>
  );
}
