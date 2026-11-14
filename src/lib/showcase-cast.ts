// "Cast it" onto a mission's showcase building (#103). With live CoStar and a
// showcase list (`SHOWCASE_LEVELS=<building>:<mission>,...`, #93), a mission
// on the list is cast onto its paired kit building: the list is the source,
// and nothing searches the kit for one. The cast screen shows that building
// beside the Casting Director's replay, with why it fits the mission and
// where it does not, from the building's own CoStar fields.
//
// Without a list entry, in fake mode, with CoStar forced to fixtures or after
// a live failure, there is no showcase cast and the screen is unchanged. Nor
// is there when the list pairs the building with a mission staged in another
// city: no level can be built for that pair, so it is skipped with a warning.
// What leaves here is picked field by field from `Building`, which carries no
// contact of any kind, so no broker or agent name reaches a screen.
import { getCoStar } from "@/adapters/costar";
import { buildState, canBuildFor } from "@/agents/builder/live-levels";
import type { Building, BuildingClass, Layers, Mission, PropertyType } from "@/domain";
import { largestVacantFloor } from "./cast-because";
import { cityName } from "./cities";
import { configuredModes } from "./mode";
import { showcase, showcaseBuilding } from "./showcase";

type Env = Record<string, string | undefined>;

/** `match`: the field meets the need; `miss`: it does not; `unknown`: the record cannot say. */
export type ReasonStatus = "match" | "miss" | "unknown";

/** One of the mission's needs against the building's CoStar field. */
export interface CastReason {
  /** The need, as the mission's funnel row words it: "Class A or B". */
  need: string;
  /** The building's value, from its record: "Class B". */
  value: string;
  status: ReasonStatus;
}

/**
 * Where the showcase building's level stands for the mission: `built` (Plan
 * and Run open on it), `building` (the startup build or a visitor's is
 * running), `failed` (the last build failed; the Dossier can retry), `none`
 * (not built yet; the Dossier builds it), or no build can run because the
 * model is on fixtures: `model-forced` in the demo settings, `model-fixtures`
 * as configured.
 */
export type ShowcaseLevel = "built" | "building" | "failed" | "none" | "model-forced" | "model-fixtures";

/** What the cast screen shows of a showcase building. */
export interface ShowcaseCast {
  id: string;
  name: string;
  neighbourhood: string;
  city: Building["city"];
  yearBuilt: number;
  buildingClass: BuildingClass;
  stories: number;
  layers: Layers;
  /** One per casting filter of the mission, in the mission's order. */
  reasons: CastReason[];
  /** Where its level stands for the mission. */
  level: ShowcaseLevel;
}

const SF = new Intl.NumberFormat("en-US");

/**
 * Each of `mission`'s casting needs against `building`'s CoStar fields:
 * what the record says, and whether it fits. `propertyType` is the kit
 * record's, which `Building` does not carry; null reads as unknown.
 */
export function castReasons(building: Building, propertyType: PropertyType | null, mission: Pick<Mission, "casting">): CastReason[] {
  const floor = largestVacantFloor(building);
  return mission.casting.map((f): CastReason => {
    const reason = (value: string, status: ReasonStatus | boolean): CastReason => ({
      need: f.label,
      value,
      status: typeof status === "boolean" ? (status ? "match" : "miss") : status,
    });
    switch (f.kind) {
      case "city":
        return reason(`in ${cityName(building.city)}`, building.city === f.city);
      case "yearBuilt": {
        const { min, max } = f.yearBuilt;
        const y = building.yearBuilt;
        return reason(`built ${y}`, (min === undefined || y >= min) && (max === undefined || y <= max));
      }
      case "buildingClass":
        return reason(`Class ${building.buildingClass}`, f.buildingClass.includes(building.buildingClass));
      case "propertyTypes":
        return propertyType
          ? reason(propertyType, f.propertyTypes.includes(propertyType))
          : reason("property type not on record", "unknown");
      case "minVacantFloorSf":
        return floor
          ? reason(`floor ${floor.floor}: ${SF.format(floor.sf)} SF on the market`, floor.sf >= f.minVacantFloorSf)
          : reason("nothing on the market", false);
      case "needsScan":
        return reason(building.layers.matterport ? "a Matterport scan" : "no Matterport scan", building.layers.matterport);
      case "needsEntry":
        // Entries come from the aerial, not the CoStar record.
        return reason(building.layers.vexcel ? "tagged on the aerial at Scout" : "no aerial on record", "unknown");
    }
  });
}

/**
 * Where a showcase level stands. A level built or building stands whatever
 * the model; otherwise no build can run while the model is on fixtures, in
 * the order the Dossier checks.
 */
function levelState(buildingId: string, missionId: string, modelForced: boolean, env: Env): ShowcaseLevel {
  const state = buildState(buildingId, missionId);
  if (state.status === "built" || state.status === "building") return state.status;
  if (modelForced) return "model-forced";
  if (configuredModes(env).llm !== "live") return "model-fixtures";
  return state.status;
}

/**
 * The showcase building `mission` is cast onto, or null when there is none:
 * no list entry, CoStar not live (fake, forced, or fallen back), the building
 * not found, or a pair whose building is in a city the mission is not staged
 * in (warned). `modelForced`: the model is forced to fixtures in the demo
 * settings. Never throws: a failure is logged and the cast screen carries on
 * without it.
 */
export async function showcaseCast(
  mission: Pick<Mission, "id" | "casting">,
  options: { forced?: boolean; modelForced?: boolean; env?: Env } = {},
): Promise<ShowcaseCast | null> {
  const buildingId = showcaseBuilding(mission.id, options.env);
  if (!buildingId) return null;
  try {
    const costar = getCoStar({ forced: options.forced });
    if (costar.mode !== "live") return null;
    const building = await costar.adapter.getBuilding(buildingId);
    if (!building || building.source !== "costar") return null;
    if (!canBuildFor(building, mission.id)) {
      const position = showcase(options.env).findIndex((e) => e.missionId === mission.id) + 1;
      console.warn(`SHOWCASE_LEVELS: pair ${position} names ${mission.id}, which is not staged in its building's city; casting ${mission.id} without it`);
      return null;
    }
    const { id, name, neighbourhood, city, yearBuilt, buildingClass, stories, layers } = building;
    return {
      ...{ id, name, neighbourhood, city, yearBuilt, buildingClass, stories, layers },
      reasons: castReasons(building, costar.propertyType?.(id) ?? null, mission),
      level: levelState(id, mission.id, options.modelForced ?? false, options.env ?? process.env),
    };
  } catch (error) {
    console.error(`showcase cast for ${mission.id}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
