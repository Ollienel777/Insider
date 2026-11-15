// Filling the blurred patch under each scan position (issue 198), for the
// Run's first person on a live scan.
//
// A panorama is blurred under its own tripod, so the floor around every scan
// position showed as a grey disc about a metre across: the "holes" in a room.
// The scan renderer can let a panorama count for almost nothing inside that
// patch (`ScanView.setNadirFade`), so the floor there is painted from a
// panorama that saw it from the side. Here is the switch and the amount.
//
// No building's numbers are in this file.

/**
 * How much less a panorama counts for the floor under its own tripod. Not
 * quite all: where no other panorama saw that floor, its own blurred picture
 * is still the best there is, and it keeps enough say to be chosen.
 */
export const NADIR_FADE = 0.9999;

/** Whether the fill is on: it is, unless `NEXT_PUBLIC_SCAN_FILL` says `0`, `off` or `false`. */
export function fillOn(setting: string | undefined = process.env.NEXT_PUBLIC_SCAN_FILL): boolean {
  return !["0", "off", "false"].includes((setting ?? "").trim().toLowerCase());
}
