// Vexcel imagery and the tagged ways in and out (SPEC §4.1).
import { z } from "zod";
import { checkUnique, Id, Text } from "./common";

export const ViewDir = z.enum(["N", "E", "S", "W", "ortho"]);
export type ViewDir = z.infer<typeof ViewDir>;

export const AerialView = z.object({
  dir: ViewDir,
  url: Text,
  width: z.int().positive(),
  height: z.int().positive(),
});
export type AerialView = z.infer<typeof AerialView>;

export const EntryKind = z.enum(["dock", "garage", "lobby", "roof", "service"]);
export type EntryKind = z.infer<typeof EntryKind>;

/** A tagged entry, placed at pixel (x, y) on the view named by `view`. */
export const AerialEntry = z.object({
  id: Id,
  kind: EntryKind,
  label: Text,
  view: ViewDir,
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  note: z.string(),
});
export type AerialEntry = z.infer<typeof AerialEntry>;

/** `[lng, lat]`, GeoJSON order. */
export const LngLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
export type LngLat = z.infer<typeof LngLat>;

export const Aerial = z
  .object({
    views: z.array(AerialView).min(1),
    entries: z.array(AerialEntry),
    footprint: z.array(LngLat).min(3),
    heightM: z.number().positive(),
    source: z.enum(["vexcel", "fixture"]),
  })
  .superRefine((aerial, ctx) => {
    checkUnique(aerial.views.map((v) => v.dir), "view", ["views"], ctx);
    checkUnique(aerial.entries.map((e) => e.id), "entry", ["entries"], ctx);
    const dirs = new Set(aerial.views.map((v) => v.dir));
    aerial.entries.forEach((entry, i) => {
      if (!dirs.has(entry.view)) {
        ctx.addIssue({
          code: "custom",
          path: ["entries", i, "view"],
          message: `entry "${entry.id}" is placed on view "${entry.view}", which is not in views`,
        });
      }
    });
  });
export type Aerial = z.infer<typeof Aerial>;
