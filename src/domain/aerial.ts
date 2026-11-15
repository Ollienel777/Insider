// Vexcel imagery and the tagged ways in and out (SPEC §4.1).
//
// Two kinds of aerial validate:
// - imagery: every view has an image `url`, and entries may be pinned to
//   pixels on those images. A live (`source: "vexcel"`) aerial is always this.
// - a massing (keyless fake mode, `source: "fixture"`): views carry no `url`,
//   because the Scout screen draws the building from `footprint` and
//   `heightM`. Entries on those views are anchored in space with `at`, which
//   the renderer projects onto whichever view is showing.
import { z } from "zod";
import { checkUnique, Id, Text } from "./common";

/**
 * An oblique is named for the side it is taken from: `N` looks south at the
 * north face. `ortho` looks straight down.
 */
export const ViewDir = z.enum(["N", "E", "S", "W", "ortho"]);
export type ViewDir = z.infer<typeof ViewDir>;

export const AerialView = z.object({
  dir: ViewDir,
  /** The image. Absent on a massing view, which is rendered, not fetched. */
  url: Text.optional(),
  /** The image's pixel size, or the size a massing view is rendered at. */
  width: z.int().positive(),
  height: z.int().positive(),
});
export type AerialView = z.infer<typeof AerialView>;

export const EntryKind = z.enum(["dock", "garage", "lobby", "roof", "service"]);
export type EntryKind = z.infer<typeof EntryKind>;

/** `[lng, lat]`, GeoJSON order. */
export const LngLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
export type LngLat = z.infer<typeof LngLat>;

/** A point on the building: where on the ground, and how far above it. */
export const EntryAnchor = z.object({
  lngLat: LngLat,
  elevM: z.number().nonnegative(),
});
export type EntryAnchor = z.infer<typeof EntryAnchor>;

/**
 * A tagged entry. `view` is the view it is best seen from. It is placed at
 * pixel (`x`, `y`) on that view's image, at `at` in space, or both. An entry
 * on a view with no image must have `at`; one on a view with an image must
 * have a pixel inside it, since `at` alone cannot be drawn on a photo.
 */
export const AerialEntry = z.object({
  id: Id,
  kind: EntryKind,
  label: Text,
  view: ViewDir,
  x: z.number().nonnegative().optional(),
  y: z.number().nonnegative().optional(),
  at: EntryAnchor.optional(),
  note: z.string(),
});
export type AerialEntry = z.infer<typeof AerialEntry>;

export const Aerial = z
  .object({
    views: z.array(AerialView).min(1),
    entries: z.array(AerialEntry),
    footprint: z.array(LngLat).min(3),
    heightM: z.number().positive(),
    source: z.enum(["vexcel", "fixture"]),
    /**
     * True when the footprint and height are estimated from the building's
     * CoStar facts (a kit building), not hand-made: the height is the stories
     * at a typical storey, and no entries are tagged. Live imagery keeps it.
     */
    derived: z.literal(true).optional(),
  })
  .superRefine((aerial, ctx) => {
    checkUnique(aerial.views.map((v) => v.dir), "view", ["views"], ctx);
    checkUnique(aerial.entries.map((e) => e.id), "entry", ["entries"], ctx);

    if (aerial.source === "vexcel") {
      aerial.views.forEach((view, i) => {
        if (view.url === undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["views", i, "url"],
            message: `view "${view.dir}" has no url; only a fixture aerial may be a massing`,
          });
        }
      });
    }

    const views = new Map(aerial.views.map((v) => [v.dir, v]));
    aerial.entries.forEach((entry, i) => {
      const issue = (path: (string | number)[], message: string) =>
        ctx.addIssue({ code: "custom", path: ["entries", i, ...path], message: `entry "${entry.id}" ${message}` });

      const view = views.get(entry.view);
      if (!view) {
        issue(["view"], `is placed on view "${entry.view}", which is not in views`);
        return;
      }
      if ((entry.x === undefined) !== (entry.y === undefined)) {
        issue([entry.x === undefined ? "x" : "y"], "has only one of x and y");
      }
      const hasPixel = entry.x !== undefined && entry.y !== undefined;
      if (view.url === undefined && entry.at === undefined) {
        issue(["at"], `sits on view "${view.dir}", which has no image, so it needs \`at\``);
      } else if (view.url !== undefined && !hasPixel) {
        // A photo is not a model: an `at` point alone cannot be drawn on it.
        issue(["x"], `sits on view "${view.dir}", which has an image, so it needs a pixel (x, y)`);
      } else if (view.url !== undefined && (entry.x! > view.width || entry.y! > view.height)) {
        issue(["x"], `is at pixel (${entry.x}, ${entry.y}), outside view "${view.dir}" (${view.width}×${view.height})`);
      }
      if (entry.at && entry.at.elevM > aerial.heightM) {
        issue(["at", "elevM"], `is ${entry.at.elevM} m up, above the building's ${aerial.heightM} m`);
      }
    });
  });
export type Aerial = z.infer<typeof Aerial>;
