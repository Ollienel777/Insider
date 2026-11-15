// Fullscreen for the Run screen's game area: the stage (the HUD, the board or
// the first-person view, and the radio line) fills the screen, so the view is
// not a short strip inside the case-file page. Pure helpers here; the button
// is fullscreen-toggle.tsx.

/** The attribute on the element that goes fullscreen: the Run screen's stage (live-layout.tsx). */
export const FULLSCREEN_ROOT = "data-fullscreen-root";

type FullscreenDoc = Pick<Document, "fullscreenEnabled" | "fullscreenElement" | "exitFullscreen">;

/** Whether this browser lets a page put an element fullscreen. A phone's Safari, or a frame without `allowfullscreen`, does not. */
export function fullscreenSupported(doc: Partial<FullscreenDoc> | undefined): boolean {
  if (!doc || doc.fullscreenEnabled !== true) return false;
  return typeof Element !== "undefined" && typeof Element.prototype.requestFullscreen === "function";
}

/** Whether a key press is the fullscreen key: `F` alone, not held down, and not typed into a field. */
export function isFullscreenKey(event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "repeat" | "target">): boolean {
  if (event.key !== "f" && event.key !== "F") return false;
  if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return false;
  const target = event.target as Partial<Pick<HTMLElement, "closest">> | null;
  return !target?.closest?.("input, textarea, select, [contenteditable=true], [contenteditable='']");
}

/** Whether the Run screen's stage is what is fullscreen now. */
export function stageFullscreen(doc: Pick<Document, "fullscreenElement"> | undefined): boolean {
  return doc?.fullscreenElement?.hasAttribute(FULLSCREEN_ROOT) ?? false;
}

/** What to do so the stage in fullscreen and the side panel never show together. */
export type FullscreenStep = "close-details" | "leave-fullscreen" | null;

/**
 * Fullscreen shows the stage alone: the side panel is outside it, so with the
 * panel open its controls would do nothing anyone could see. Whichever came
 * last wins. Going fullscreen closes Details; opening the panel while
 * fullscreen (Details, or a switch to Tactical, whose panel is always open)
 * leaves fullscreen. `live` says the panel can be closed at all: in Tactical
 * it can't, so fullscreen gives way.
 */
export function fullscreenStep(wasFullscreen: boolean, fullscreen: boolean, panels: boolean, live: boolean): FullscreenStep {
  if (!fullscreen || !panels) return null;
  return !wasFullscreen && live ? "close-details" : "leave-fullscreen";
}

/**
 * Puts `root` fullscreen, or takes the page out of fullscreen if anything is
 * fullscreen already. A refusal (no user gesture, a policy) leaves the page
 * as it was: it resolves either way.
 */
export async function toggleFullscreen(root: Pick<Element, "requestFullscreen">, doc: FullscreenDoc): Promise<void> {
  try {
    if (doc.fullscreenElement) await doc.exitFullscreen();
    else await root.requestFullscreen({ navigationUI: "hide" });
  } catch {
    // Refused: the button keeps saying what is true, since it reads `fullscreenchange`.
  }
}
