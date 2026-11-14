// What a mission needs of its stand-in building, the inventory the casting
// search runs on, and the shortlist the Casting Director writes (SPEC §4.1,
// §4.4, §4.6). The search itself is C2's (`searchInventory` on the CoStar
// adapter); these are the shapes it reads and the agent returns.
import { z } from "zod";
import { BuildTraceEvent, BuildTrace } from "./agents";
import { EntryKind } from "./aerial";
import { Building, BuildingClass } from "./building";
import { checkUnique, City, Id, Text } from "./common";

export const PropertyType = z.enum(["office", "retail", "industrial", "flex"]);
export type PropertyType = z.infer<typeof PropertyType>;

/** The entries a mission can ask for on the aerial. */
export const CastingEntryKind = EntryKind.extract(["dock", "service", "garage"]);
export type CastingEntryKind = z.infer<typeof CastingEntryKind>;

/**
 * One filter of a mission's casting, with the plain-English label its funnel
 * row shows. A property passes when:
 * - `city`: its city is `city`;
 * - `yearBuilt`: `min <= yearBuilt <= max` (either bound may be absent);
 * - `buildingClass`: its class is listed;
 * - `propertyTypes`: its property type is listed;
 * - `minVacantFloorSf`: on some floor, its available suites add up to at
 *   least this many square feet;
 * - `needsScan`: it has a Matterport scan (`layers.matterport`);
 * - `needsEntry`: its aerial shows at least one of the listed entries.
 */
export const CastingFilter = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("city"), label: Text, city: City }),
  z.strictObject({
    kind: z.literal("yearBuilt"),
    label: Text,
    yearBuilt: z
      .strictObject({ min: z.int().optional(), max: z.int().optional() })
      .refine((y) => y.min !== undefined || y.max !== undefined, "yearBuilt needs a min or a max")
      .refine((y) => y.min === undefined || y.max === undefined || y.min <= y.max, "yearBuilt min is above max"),
  }),
  z.strictObject({ kind: z.literal("buildingClass"), label: Text, buildingClass: z.array(BuildingClass).min(1) }),
  z.strictObject({ kind: z.literal("propertyTypes"), label: Text, propertyTypes: z.array(PropertyType).min(1) }),
  z.strictObject({ kind: z.literal("minVacantFloorSf"), label: Text, minVacantFloorSf: z.number().positive() }),
  z.strictObject({ kind: z.literal("needsScan"), label: Text }),
  z.strictObject({ kind: z.literal("needsEntry"), label: Text, needsEntry: z.array(CastingEntryKind).min(1) }),
]);
export type CastingFilter = z.infer<typeof CastingFilter>;

/** A mission's casting: its filters in the order the search applies them, each kind at most once. */
export const Casting = z
  .array(CastingFilter)
  .min(1)
  .superRefine((filters, ctx) =>
    checkUnique(
      filters.map((f) => f.kind),
      "casting filter",
      [],
      ctx,
    ),
  );
export type Casting = z.infer<typeof Casting>;

/**
 * One property of the fixture inventory (`fixtures/inventory.json`): a
 * building plus what casting reads beyond the `Building` record, its property
 * type and the entry kinds its aerial shows (empty without the Vexcel layer).
 */
export const InventoryProperty = Building.extend({
  propertyType: PropertyType,
  entries: z.array(EntryKind),
});
export type InventoryProperty = z.infer<typeof InventoryProperty>;

export const Inventory = z.array(InventoryProperty).superRefine((properties, ctx) =>
  checkUnique(
    properties.map((p) => p.id),
    "property",
    [],
    ctx,
  ),
);
export type Inventory = z.infer<typeof Inventory>;

/** One row of the funnel: the filter's label and how many properties are left. */
export const FunnelStep = z.strictObject({ label: Text, count: z.int().nonnegative() });
export type FunnelStep = z.infer<typeof FunnelStep>;

/** The floor a finalist would stage: its available suites, added up. */
export const VacantFloor = z.strictObject({
  floor: z.int(),
  sf: z.number().positive(),
  suites: z.array(Id).min(1),
});
export type VacantFloor = z.infer<typeof VacantFloor>;

/** One line of a finalist card's fit: the criterion and the property's value. */
export const Fit = z.strictObject({
  criterion: Text,
  value: z.union([z.string(), z.number(), z.boolean()]),
});
export type Fit = z.infer<typeof Fit>;

/** A finalist: a building summary, its vacant floor, its fit and the agent's one-line reason. */
export const Candidate = InventoryProperty.pick({
  id: true,
  name: true,
  city: true,
  neighbourhood: true,
  lat: true,
  lng: true,
  yearBuilt: true,
  buildingClass: true,
  propertyType: true,
  stories: true,
  layers: true,
  source: true,
}).extend({
  vacantFloor: VacantFloor,
  fit: z.array(Fit).min(1),
  reason: Text,
});
export type Candidate = z.infer<typeof Candidate>;

export const CastingAgent = z.enum(["casting-director", "location-scout"]);
export type CastingAgent = z.infer<typeof CastingAgent>;

/** One line of the Casting Director's trace, shaped like the Level Builder's. */
export const CastingTraceEvent = BuildTraceEvent.extend({ agent: CastingAgent });
export type CastingTraceEvent = z.infer<typeof CastingTraceEvent>;

export const CastingTrace = BuildTrace.omit({ buildingId: true }).extend({
  events: z.array(CastingTraceEvent).min(1),
});
export type CastingTrace = z.infer<typeof CastingTrace>;

export const CASTING_FINALISTS = 3;

/**
 * A mission's cached shortlist. `funnel` has one row per filter, after a
 * first row for the whole inventory, so its counts never rise; `finalists`
 * are exactly three, best first.
 *
 * The ranking: the properties left after the last filter, ordered by their
 * largest vacant floor (the available suites on one floor, added up; the
 * floor SPEC §4.3 would stage), largest first, ties broken by id; the first
 * three are the finalists. On the fixture inventory this puts each mission's
 * own fixture building first; `fixtures/inventory-finalists.json` records the
 * three each mission's funnel ends with.
 */
export const CastingResult = z
  .strictObject({
    missionId: Id,
    funnel: z.array(FunnelStep).min(2),
    finalists: z.array(Candidate).length(CASTING_FINALISTS),
    trace: CastingTrace,
    source: Building.shape.source,
  })
  .superRefine((result, ctx) => {
    checkUnique(
      result.finalists.map((c) => c.id),
      "finalist",
      ["finalists"],
      ctx,
    );
    result.funnel.forEach((step, i) => {
      if (i > 0 && step.count > result.funnel[i - 1].count) {
        ctx.addIssue({ code: "custom", path: ["funnel", i, "count"], message: "a funnel count rose" });
      }
    });
    const left = result.funnel[result.funnel.length - 1].count;
    if (left < CASTING_FINALISTS) {
      ctx.addIssue({ code: "custom", path: ["funnel"], message: `the funnel ends with ${left}, fewer than three` });
    }
  });
export type CastingResult = z.infer<typeof CastingResult>;

/** How many candidates each step of an inventory search shows. */
export const SEARCH_TOP = 5;

/**
 * A candidate as the inventory search returns it: the finalist card's
 * summary and vacant floor, before the agent writes its fit and reason.
 * `vacantFloor` is the floor with the most available area, or `null` when
 * nothing in the building is on the market.
 */
export const SearchCandidate = Candidate.omit({ fit: true, reason: true }).extend({
  vacantFloor: VacantFloor.nullable(),
});
export type SearchCandidate = z.infer<typeof SearchCandidate>;

/** One step of a search: a funnel row, plus the best `SEARCH_TOP` properties still in. */
export const SearchStep = FunnelStep.extend({ top: z.array(SearchCandidate).max(SEARCH_TOP) });
export type SearchStep = z.infer<typeof SearchStep>;

/**
 * What `searchInventory(filters)` returns: `steps[0]` is the whole inventory,
 * then one step per filter in the order given, so counts never rise.
 * `source` says which inventory answered: `"fixture"` whenever the fixture
 * inventory did, live mode included, until the kit reader exists (#27).
 */
export const InventorySearch = z.strictObject({
  steps: z.array(SearchStep).min(1),
  source: Building.shape.source,
});
export type InventorySearch = z.infer<typeof InventorySearch>;
