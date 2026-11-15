// Filling the blurred patch under each scan position (issue 198), for the
// Run's first person on a live scan.
//
// A panorama is blurred under its own tripod, so the floor around every scan
// position showed as a grey disc: the "holes" in a room. The scan renderer can
// let a panorama give up its say inside that patch (`ScanView.setNadirFade`),
// so the floor there is painted from a panorama that saw it from the side.
// Here is the switch and the amount.
//
// No building's numbers are in this file.

/**
 * How much of its say a panorama gives up for the floor under its own tripod,
 * where another panorama saw that floor. Not quite all: the 1e-4 it keeps is
 * the crossover, so a neighbour that saw the floor takes over once its say is
 * more than a ten-thousandth of this panorama's, and fades in smoothly as it
 * enters rather than jumping in at its first frame.
 */
export const NADIR_FADE = 0.9999;

/** Whether the fill is on: it is, unless `NEXT_PUBLIC_SCAN_FILL` says `0`, `off` or `false`. */
export function fillOn(setting: string | undefined = process.env.NEXT_PUBLIC_SCAN_FILL): boolean {
  return !["0", "off", "false"].includes((setting ?? "").trim().toLowerCase());
}

/** The one call the fill needs from the scan's renderer. */
export interface NadirFadeTarget {
  setNadirFade(amount: number): void;
}

/** Turns the fill on for first person on `view`, unless it is switched off; the returned call turns it off again. */
export function fillScan(view: NadirFadeTarget, setting?: string): () => void {
  view.setNadirFade(fillOn(setting) ? NADIR_FADE : 0);
  return () => view.setNadirFade(0);
}
