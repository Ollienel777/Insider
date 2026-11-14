// The Casting Director's tools (SPEC §4.4). They run for real against the
// adapters (fakes in fake mode): the search is deterministic code over the
// CoStar adapter; the model chooses the order, judges ties and writes each
// finalist's reason.
//
// One `CastRun` holds what the tools learned in this run. `write_shortlist`
// builds the CastingResult from the last search, which must have applied
// every one of the mission's filters, so every count, floor and fit comes
// from a tool call the trace shows, never from the model's own text.
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { CoStarAdapter } from "@/adapters/costar";
import { vacantFloors } from "@/adapters/costar/search";
import type { VexcelAdapter } from "@/adapters/vexcel";
import {
  type Candidate,
  CASTING_FINALISTS,
  type CastingFilter,
  type Fit,
  type FunnelStep,
  type InventoryProperty,
  type InventorySearch,
  type Mission,
  type SearchCandidate,
} from "@/domain";

export interface CastRun {
  /** The mission this run casts; every tool refuses any other id. */
  mission: Mission;
  costar: Pick<CoStarAdapter, "searchInventory">;
  vexcel: VexcelAdapter;
  /**
   * The inventory records `get_candidate` reads, for searches the fixtures
   * answered. No reader exists yet for the kit's records (#27).
   */
  inventory: readonly InventoryProperty[];
  /** The filters applied so far, in order. */
  applied: CastingFilter[];
  /** The last search, with every applied filter. */
  search?: InventorySearch;
  /** Set by `write_shortlist`. */
  shortlist?: { funnel: FunnelStep[]; finalists: Candidate[]; source: InventorySearch["source"] };
}

const json = (value: unknown): string => JSON.stringify(value, null, 2);

const MissionArg = z.object({ missionId: z.string().describe("The mission id, for example romaine-1974") });
const PropertyArg = z.object({ id: z.string().describe("A property id the inventory search returned, for example L01") });

function checkMission(run: CastRun, missionId: string): void {
  if (missionId !== run.mission.id) throw new Error(`this run casts ${run.mission.id}, not ${missionId}`);
}

/** The candidates the searches so far returned, by id. */
function seen(run: CastRun): Map<string, SearchCandidate> {
  return new Map((run.search?.steps ?? []).flatMap((s) => s.top).map((c) => [c.id, c]));
}

/** The full inventory record of a candidate the search returned. */
function record(run: CastRun, id: string): InventoryProperty {
  if (!seen(run).has(id)) throw new Error(`${id} is not among the candidates search_inventory returned in this run`);
  if (run.search?.source !== "fixture") {
    throw new Error(`no reader for the ${run.search?.source} inventory's records yet; only the fixtures have one`);
  }
  const found = run.inventory.find((p) => p.id === id);
  if (!found) throw new Error(`the inventory has no property ${id}`);
  return found;
}

/** The mission tool every agent in the run has. */
export function missionTool(run: CastRun) {
  return tool(
    async ({ missionId }) => {
      checkMission(run, missionId);
      return json(run.mission);
    },
    {
      name: "get_mission",
      description:
        "The mission: its title, city, the event it is inspired by, objective, and its casting filters, each with " +
        "its kind and the plain-English label its funnel row shows.",
      schema: MissionArg,
    },
  );
}

/** The location scout's tools: the inventory search, a candidate's facts, its aerial entries. */
export function scoutTools(run: CastRun) {
  const searchInventory = tool(
    async ({ missionId, filter }) => {
      checkMission(run, missionId);
      const next = run.mission.casting.find((f) => f.kind === filter);
      if (!next) throw new Error(`mission ${missionId} has no "${filter}" filter`);
      if (run.applied.some((f) => f.kind === filter)) throw new Error(`the "${filter}" filter is already applied`);
      const applied = [...run.applied, next];
      const search = await run.costar.searchInventory(applied);
      run.applied = applied;
      run.search = search;
      const step = search.steps.at(-1)!;
      return json({
        applied: step.label,
        left: step.count,
        funnel: search.steps.map(({ label, count }) => ({ label, count })),
        top: step.top.map(({ id, name, yearBuilt, buildingClass, propertyType, vacantFloor }) => ({
          id,
          name,
          yearBuilt,
          buildingClass,
          propertyType,
          vacantFloor: vacantFloor && { floor: vacantFloor.floor, sf: vacantFloor.sf },
        })),
        filtersLeft: run.mission.casting.filter((f) => !applied.includes(f)).map((f) => f.kind),
      });
    },
    {
      name: "search_inventory",
      description:
        "Applies one more of the mission's casting filters, by kind, to the CoStar inventory, on top of those " +
        "already applied. Returns the count left, the funnel so far and the top candidates: largest vacant floor " +
        "first.",
      schema: MissionArg.extend({
        filter: z
          .enum(["city", "yearBuilt", "buildingClass", "propertyTypes", "minVacantFloorSf", "needsScan", "needsEntry"])
          .describe("The kind of the mission's casting filter to apply next"),
      }),
    },
  );

  const getCandidate = tool(
    async ({ id }) => {
      const p = record(run, id);
      return json({
        id: p.id,
        name: p.name,
        city: p.city,
        neighbourhood: p.neighbourhood,
        yearBuilt: p.yearBuilt,
        buildingClass: p.buildingClass,
        propertyType: p.propertyType,
        stories: p.stories,
        rbaSf: p.rbaSf,
        typicalFloorSf: p.typicalFloorSf,
        vacantFloors: vacantFloors(p),
        scans: p.matterportModelId ? 1 : 0,
        layers: p.layers,
      });
    },
    {
      name: "get_candidate",
      description:
        "A candidate's CoStar facts: year built, class, property type, stories and areas, its vacant floors from " +
        "the listings (suites added up per floor, largest first), its scan count and its layer flags.",
      schema: PropertyArg,
    },
  );

  const getAerialEntries = tool(
    async ({ id }) => {
      const p = record(run, id);
      const aerial = await run.vexcel.getAerial(id);
      if (aerial) {
        return json({
          source: aerial.source,
          entries: aerial.entries.map(({ id: entryId, kind, label, view }) => ({ id: entryId, kind, label, view })),
        });
      }
      return json({ source: "inventory", entryKinds: p.entries, note: "no aerial yet; the inventory's entry tags" });
    },
    {
      name: "get_aerial_entries",
      description:
        "The ways in and out tagged on a candidate's Vexcel aerial (dock, garage, lobby, roof, service), or the " +
        "inventory's entry tags when no aerial is loaded for it.",
      schema: PropertyArg,
    },
  );

  return [missionTool(run), searchInventory, getCandidate, getAerialEntries];
}

/** One fit line per casting filter: the filter's label and the candidate's own value. */
export function fitOf(p: InventoryProperty, filters: readonly CastingFilter[]): Fit[] {
  return filters.map((f): Fit => {
    switch (f.kind) {
      case "city":
        return { criterion: f.label, value: p.city };
      case "yearBuilt":
        return { criterion: f.label, value: p.yearBuilt };
      case "buildingClass":
        return { criterion: f.label, value: `Class ${p.buildingClass}` };
      case "propertyTypes":
        return { criterion: f.label, value: p.propertyType };
      case "minVacantFloorSf": {
        const floor = vacantFloors(p)[0];
        return { criterion: f.label, value: floor ? `floor ${floor.floor}, ${floor.sf.toLocaleString("en-US")} SF` : "none" };
      }
      case "needsScan":
        return { criterion: f.label, value: p.layers.matterport };
      case "needsEntry":
        return { criterion: f.label, value: f.needsEntry.filter((k) => p.entries.includes(k)).join(", ") || "none" };
      default: {
        const unknown: never = f;
        throw new Error(`unknown casting filter kind: ${(unknown as { kind?: unknown }).kind}`);
      }
    }
  });
}

const WriteShortlistArgs = MissionArg.extend({
  finalists: z
    .array(
      z.object({
        id: z.string().describe("A property id left after the last filter"),
        reason: z.string().min(1).describe("One line: why this building suits the mission"),
      }),
    )
    .length(CASTING_FINALISTS)
    .describe("The three finalists, best first"),
});

/** The director's own tool: assembles, validates and stores the shortlist. */
export function directorTools(run: CastRun) {
  const writeShortlist = tool(
    async ({ missionId, finalists }) => {
      checkMission(run, missionId);
      const search = run.search;
      const missing = run.mission.casting.filter((f) => !run.applied.includes(f)).map((f) => f.kind);
      if (!search || missing.length > 0) {
        throw new Error(`apply every casting filter first (through the location-scout); not yet: ${missing.join(", ")}`);
      }
      const left = new Map(search.steps.at(-1)!.top.map((c) => [c.id, c]));
      const ids = finalists.map((f) => f.id);
      if (new Set(ids).size !== ids.length) throw new Error("the finalists must be three different properties");
      const candidates = finalists.map(({ id, reason }): Candidate => {
        const c = left.get(id);
        if (!c) throw new Error(`${id} is not among the candidates left after the last filter`);
        if (!c.vacantFloor) throw new Error(`${id} has nothing on the market`);
        return { ...c, vacantFloor: c.vacantFloor, fit: fitOf(record(run, id), run.applied), reason: reason.trim() };
      });
      run.shortlist = {
        funnel: search.steps.map(({ label, count }) => ({ label, count })),
        finalists: candidates,
        source: search.source,
      };
      return `Shortlist written for ${missionId}: ${ids.join(", ")}, from a funnel of ${search.steps.length} rows.`;
    },
    {
      name: "write_shortlist",
      description:
        "Writes the mission's shortlist: the funnel of the last search and three finalists, best first, each with " +
        "its one-line reason. Every casting filter must have been applied.",
      schema: WriteShortlistArgs,
    },
  );
  return [missionTool(run), writeShortlist];
}
