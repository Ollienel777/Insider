"use client";

// Being noticed, drawn over the first-person view (issue 146): a glow on the
// edges of the view that rises as the player nears someone's sight and is
// full when they are in it, a meter that says who, and a ripple when the
// last turn made noise. What it shows is `noticeOf` and `noiseCue`
// (notice.ts), read from the run state. Under reduced motion nothing pulses
// or ripples; the levels still show.
import { Ear, Eye, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NoiseCue, Notice } from "./notice";

const TONE_VAR = { calm: "var(--n-400)", warning: "var(--warning)", danger: "var(--danger)" } as const;

const KEYFRAMES = `
@keyframes fp-notice-pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.55 } }
@keyframes fp-noise-ripple { from { transform: translate(-50%, -50%) scale(0.3); opacity: 0.9 } to { transform: translate(-50%, -50%) scale(1); opacity: 0 } }
@media (prefers-reduced-motion: reduce) { [data-fp-motion] { animation: none !important } }
`;

export function NoticeGlow({ notice, noise, turn }: { notice: Notice; noise: NoiseCue; turn: number }) {
  const colour = TONE_VAR[notice.tone];
  const seen = notice.seenBy.length > 0 || notice.tripped !== null;
  const Icon = notice.heardBy.length > 0 && !seen ? Ear : Eye;
  return (
    <>
      <style>{KEYFRAMES}</style>
      {notice.level > 0 ? (
        <div
          aria-hidden
          data-testid="fp-notice-glow"
          data-fp-motion
          className="pointer-events-none absolute inset-0"
          style={{
            boxShadow: `inset 0 0 ${40 + notice.level * 90}px ${8 + notice.level * 28}px color-mix(in srgb, ${colour} ${Math.round(25 + notice.level * 45)}%, transparent)`,
            animation: seen ? "fp-notice-pulse 0.9s ease-in-out infinite" : undefined,
          }}
        />
      ) : null}

      {/* The meter: under the board's top bar, in the middle, clear of the corners other HUD pieces hold. */}
      <div
        data-testid="fp-notice"
        data-tone={notice.tone}
        data-level={notice.level}
        role="status"
        aria-live="polite"
        className={cn(
          "pointer-events-none absolute top-14 left-1/2 flex -translate-x-1/2 items-center gap-2.5 rounded-sm bg-surface-1/90 px-3 py-1.5 shadow-e-1",
          "transition-opacity duration-base ease-out",
          notice.level > 0 ? "opacity-100" : "opacity-0",
        )}
      >
        <Icon aria-hidden className="size-4 shrink-0 stroke-[1.75]" style={{ color: colour }} />
        <span aria-hidden className="flex gap-0.5">
          {Array.from({ length: 5 }, (_, i) => (
            <span
              key={i}
              className="h-2.5 w-3 rounded-[1px] transition-colors duration-fast"
              style={{ background: notice.level >= (i + 1) / 5 - 0.001 ? colour : "var(--n-800)" }}
            />
          ))}
        </span>
        <span className="text-sm font-medium whitespace-nowrap text-text-1">{notice.reason ?? "Unseen"}</span>
      </div>

      {noise.loud ? (
        <div key={turn} data-testid="fp-noise" data-heard={noise.heardBy.join(" ")} className="pointer-events-none absolute inset-0">
          <span
            aria-hidden
            data-fp-motion
            className="absolute top-1/2 left-1/2 size-[min(70vh,70vw)] rounded-full border-4"
            style={{ borderColor: noise.heardBy.length > 0 ? "var(--warning)" : "var(--n-300)", animation: "fp-noise-ripple 0.7s ease-out both" }}
          />
          <p className="absolute top-[calc(50%+2.5rem)] left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-sm bg-surface-1/90 px-2.5 py-1 font-mono text-xs tracking-[0.06em] text-text-1 uppercase shadow-e-1">
            <Volume2 aria-hidden className="size-3.5" style={{ color: noise.heardBy.length > 0 ? "var(--warning)" : "var(--n-300)" }} />
            {noise.kind === "pick" ? "Lock noise" : "Sprint noise"} · {noise.rangeHops} {noise.rangeHops === 1 ? "room" : "rooms"}
            {noise.heardBy.length > 0 ? ` · heard by ${noise.heardBy.join(", ")}` : " · no one heard"}
          </p>
        </div>
      ) : null}
    </>
  );
}
