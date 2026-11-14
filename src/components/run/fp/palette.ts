// The first-person scene's colours (issue 115): DESIGN.md's tokens, read from
// the page's CSS variables when the scene is built, so the renderer holds no
// colour values of its own (globals.css is the one place they live).
import { Color } from "three";

const TOKENS = {
  n950: "--n-950",
  n900: "--n-900",
  n850: "--n-850",
  n800: "--n-800",
  n700: "--n-700",
  n600: "--n-600",
  n500: "--n-500",
  n400: "--n-400",
  n300: "--n-300",
  n200: "--n-200",
  n100: "--n-100",
  accent: "--accent",
  success: "--success",
  warning: "--warning",
  danger: "--danger",
} as const;

export type Palette = Readonly<Record<keyof typeof TOKENS, Color>>;

/** The tokens as the page defines them. A token the page does not define comes out mid-grey, never black. */
export function readPalette(element: Element): Palette {
  const style = getComputedStyle(element);
  const out = {} as Record<keyof typeof TOKENS, Color>;
  for (const [name, token] of Object.entries(TOKENS) as [keyof typeof TOKENS, string][]) {
    const value = style.getPropertyValue(token).trim();
    const colour = new Color().setScalar(0.5);
    if (value) {
      try {
        colour.set(value);
      } catch {
        // A value three cannot read stays grey.
      }
    }
    out[name] = colour;
  }
  return out;
}
