"use client";

// Sound on the Run screen (issue 101): the hook that plays the run's cues as
// its state changes, and the mute button with its `M` key. Which cue an event
// calls for is sound.ts; what a cue sounds like is sound-synth.ts; when the
// audio context may exist is sound-player.ts.
import { Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { RunState } from "@/engine";
import { cn } from "@/lib/utils";
import { muteStore } from "./sound-mute-store";
import { createSoundPlayer, type SoundPlayer } from "./sound-player";

/**
 * What a browser takes as leave to start audio. A mouse press and a key press
 * count as they happen; a touch counts only once it lifts, which `click` covers.
 */
const GESTURES = ["pointerdown", "click", "keydown"] as const;

/** Whether a key press is the mute key: `M` alone, not held down, and not typed into a field. */
export function isMuteKey(
  event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "repeat"> & { target: unknown },
): boolean {
  if (event.key !== "m" && event.key !== "M") return false;
  if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return false;
  const target = event.target as Partial<Pick<HTMLElement, "closest">> | null;
  return !target?.closest?.("input, textarea, select, [contenteditable=true], [contenteditable='']");
}

/**
 * Plays the run's sound: call it with the run as it stands on every render.
 * Returns whether sound is muted and the way to flip that, which `M` also
 * does; the choice is remembered (sound-mute-store.ts).
 *
 * Nothing sounds before the player's first click or key press, and where Web
 * Audio is missing or blocked nothing sounds at all, with no error. Leaving
 * the screen ends every sound.
 */
export function useRunSound(run: RunState | null): [muted: boolean, toggleMute: () => void] {
  // The stored choice is the browser's: the server, and the first render after it, take sound as on.
  const muted = useSyncExternalStore(muteStore.subscribe, muteStore.get, () => false);
  const player = useRef<SoundPlayer | null>(null);

  // The player lives as long as the screen does. These effects run in this order: it exists
  // before it is told the mute choice, and knows the choice before it is shown a run.
  useEffect(() => {
    const made = createSoundPlayer();
    player.current = made;
    const wake = () => made.wake();
    // In the capture phase: the press that plays a turn has opened audio before that turn's cues are due.
    for (const gesture of GESTURES) window.addEventListener(gesture, wake, true);
    return () => {
      for (const gesture of GESTURES) window.removeEventListener(gesture, wake, true);
      made.close();
      player.current = null;
    };
  }, []);

  useEffect(() => {
    player.current?.setMuted(muted);
  }, [muted]);

  useEffect(() => {
    player.current?.follow(run);
  }, [run]);

  const toggleMute = useCallback(() => muteStore.set(!muteStore.get()), []);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!isMuteKey(event)) return;
      event.preventDefault();
      toggleMute();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleMute]);

  return [muted, toggleMute];
}

/**
 * The mute button in the board's top bar, beside the Layer lens and styled as
 * it is. Pressed means muted, and the icon says the same; it names its key.
 */
export function MuteToggle({ muted, onToggle }: { muted: boolean; onToggle: () => void }) {
  const Icon = muted ? VolumeX : Volume2;
  return (
    <button
      type="button"
      data-testid="mute-toggle"
      aria-pressed={muted}
      aria-keyshortcuts="M"
      onClick={onToggle}
      className={cn(
        "inline-flex h-10 shrink-0 items-center gap-2 rounded-sm border px-3 text-sm font-medium select-none",
        "transition-colors duration-fast ease-out",
        "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.5]",
        muted
          ? "border-border-strong bg-surface-3 text-text-1"
          : "border-transparent text-text-2 hover:bg-surface-3 hover:text-text-1",
      )}
    >
      <Icon aria-hidden />
      {/* On a phone the top bar is narrow: the icon stays, the name stays for screen readers. */}
      <span className="max-md:sr-only">Mute</span>
      <kbd
        aria-hidden
        className="max-md:hidden inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-surface-2 px-1 font-mono text-xs text-text-2"
      >
        M
      </kbd>
    </button>
  );
}
