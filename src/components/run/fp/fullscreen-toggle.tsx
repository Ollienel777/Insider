"use client";

// The Fullscreen button, beside the view switch and the mute button: the Run
// screen's stage (the HUD, the board or first person, the radio line) fills
// the screen, and `F` does the same. Esc leaves it, after it frees the mouse.
// Nothing shows where the browser has no Fullscreen API.
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { Maximize, Minimize } from "lucide-react";
import { cn } from "@/lib/utils";
import { FULLSCREEN_ROOT, fullscreenSupported, isFullscreenKey, toggleFullscreen } from "./fullscreen";

const subscribe = (change: () => void) => {
  document.addEventListener("fullscreenchange", change);
  return () => document.removeEventListener("fullscreenchange", change);
};
/** Whether the stage is what is fullscreen now. */
const stageFullscreen = () => document.fullscreenElement?.hasAttribute(FULLSCREEN_ROOT) ?? false;
const never = () => false;
const noop = () => () => {};
const supportedHere = () => fullscreenSupported(document);

export function FullscreenToggle({ className }: { className?: string }) {
  const button = useRef<HTMLButtonElement>(null);
  // False on the server, which has no document; the button comes in on hydration.
  const supported = useSyncExternalStore(noop, supportedHere, never);
  const on = useSyncExternalStore(subscribe, stageFullscreen, never);

  const toggle = useCallback(() => {
    const el = button.current?.closest<HTMLElement>(`[${FULLSCREEN_ROOT}]`);
    if (el) void toggleFullscreen(el, document);
  }, []);

  useEffect(() => {
    if (!supported) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isFullscreenKey(event)) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [supported, toggle]);

  if (!supported) return null;
  const Icon = on ? Minimize : Maximize;
  return (
    <button
      ref={button}
      type="button"
      data-testid="fullscreen-toggle"
      aria-pressed={on}
      aria-keyshortcuts="F"
      title={on ? "Exit fullscreen (F or Esc)" : "Fullscreen (F)"}
      // A click must not leave focus here: Space on a focused button presses it, and on Run Space takes the files.
      onMouseDown={(event) => event.preventDefault()}
      onClick={toggle}
      className={cn(
        "inline-flex h-10 min-w-10 items-center justify-center gap-2 rounded-sm border px-3 select-none max-md:px-0",
        "transition-colors duration-fast ease-out motion-reduce:transition-none",
        "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.5]",
        on
          ? "border-border-strong bg-surface-3 text-text-1"
          : "border-border bg-surface-1 text-text-2 hover:border-border-strong hover:bg-surface-3 hover:text-text-1",
        className,
      )}
    >
      <Icon aria-hidden />
      <span className="sr-only">Fullscreen</span>
      <kbd
        aria-hidden
        className="max-md:hidden inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-surface-2 px-1 font-mono text-xs text-text-2"
      >
        F
      </kbd>
    </button>
  );
}
