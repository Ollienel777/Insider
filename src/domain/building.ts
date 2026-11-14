// A building as the CoStar adapter (or its fixture) reports it (SPEC §4.1).
// Taste rule (SPEC §1): no tenant fields exist in this type. The schema is
// strict, so a record carrying any key not listed here fails to parse.
import { z } from "zod";
import { City, Id, Text } from "./common";

export const BuildingClass = z.enum(["A", "B", "C"]);
export type BuildingClass = z.infer<typeof BuildingClass>;

/** One available (vacant) suite. Occupied suites are the ones not listed. */
export const AvailableSpace = z.strictObject({
  floor: z.int(),
  suite: Id,
  sf: z.number().positive(),
});
export type AvailableSpace = z.infer<typeof AvailableSpace>;

export const Layers = z.strictObject({
  costar: z.boolean(),
  vexcel: z.boolean(),
  matterport: z.boolean(),
});
export type Layers = z.infer<typeof Layers>;

export const Building = z.strictObject({
  id: Id,
  name: Text,
  city: City,
  neighbourhood: Text,
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  yearBuilt: z.int().min(1800).max(2100),
  buildingClass: BuildingClass,
  stories: z.int().positive(),
  rbaSf: z.number().positive(),
  typicalFloorSf: z.number().positive(),
  availableSpace: z.array(AvailableSpace),
  layers: Layers,
  matterportModelId: Id.optional(),
  source: z.enum(["costar", "fixture"]),
});
export type Building = z.infer<typeof Building>;
