// The Level Builder's tools (SPEC §4.4). They run for real against the
// adapters (fakes in fake mode): the model chooses and writes, the tools
// read the data and apply the rules table.
//
// One `BuildRun` holds what the tools learned in this run.
// `write_manifest` builds the manifest from the derivation that
// `derive_security_profile` stored, the mission picked from the library and
// the briefing the agent wrote, so every number in the level comes from a
// tool call the trace shows, never from the model's own text.
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { CoStarAdapter } from "@/adapters/costar";
import type { VexcelAdapter } from "@/adapters/vexcel";
import { type Building, LevelManifest, type Mission, type Provenance, type Zone } from "@/domain";
import { deriveSecurityProfile, type SecurityDerivation } from "@/level/rules";
import { missionsFor, MISSIONS } from "./missions";

export interface BuildRun {
  /** The building this run builds; every tool refuses any other id. */
  buildingId: string;
  costar: CoStarAdapter;
  vexcel: Pick<VexcelAdapter, "getAerial">;
  missions?: readonly Mission[];
  /** Set by `derive_security_profile`. */
  derivation?: SecurityDerivation;
  /** Set by `write_manifest`. */
  manifest?: LevelManifest;
}

const json = (value: unknown): string => JSON.stringify(value, null, 2);

const BuildingArg = z.object({ buildingId: z.string().describe("The building id, for example F1") });

function checkBuilding(run: BuildRun, buildingId: string): void {
  if (buildingId !== run.buildingId) {
    throw new Error(`this run builds ${run.buildingId}, not ${buildingId}`);
  }
}

async function building(run: BuildRun, buildingId: string): Promise<Building> {
  checkBuilding(run, buildingId);
  const found = await run.costar.getBuilding(buildingId);
  if (!found) throw new Error(`CoStar has no building ${buildingId}`);
  return found;
}

/** The tools the data analyst uses: CoStar, Vexcel and the rules table. */
export function analystTools(run: BuildRun) {
  const getBuilding = tool(
    async ({ buildingId }) => {
      const b = await building(run, buildingId);
      const { availableSpace, ...record } = b;
      return json({ ...record, availableSuites: availableSpace.length });
    },
    {
      name: "get_building",
      description:
        "The building's CoStar record: name, city, year built, class, stories, rentable and typical floor area. " +
        "Holds no tenant data.",
      schema: BuildingArg,
    },
  );

  const getAvailableSpace = tool(
    async ({ buildingId }) => {
      checkBuilding(run, buildingId);
      const space = await run.costar.getAvailableSpace(buildingId);
      if (!space) throw new Error(`CoStar has no building ${buildingId}`);
      return json(space);
    },
    {
      name: "get_available_space",
      description: "The building's available suites from CoStar: floor, suite and square feet.",
      schema: BuildingArg,
    },
  );

  const getAerialEntries = tool(
    async ({ buildingId }) => {
      checkBuilding(run, buildingId);
      const aerial = await run.vexcel.getAerial(buildingId);
      if (!aerial) return json({ entries: [], note: "Vexcel has no aerial for this building" });
      return json({
        source: aerial.source,
        heightM: aerial.heightM,
        entries: aerial.entries.map(({ id, kind, label, view, note }) => ({ id, kind, label, view, note })),
      });
    },
    {
      name: "get_aerial_entries",
      description: "The ways in and out tagged on the building's Vexcel aerial: dock, garage, lobby, roof, service.",
      schema: BuildingArg,
    },
  );

  const deriveProfile = tool(
    async ({ buildingId }) => {
      const b = await building(run, buildingId);
      const aerial = await run.vexcel.getAerial(buildingId);
      const derivation = deriveSecurityProfile(b, aerial);
      run.derivation = derivation;
      return json({
        securityProfile: derivation.securityProfile,
        stagingFloor: derivation.stagingFloor,
        zones: derivation.zones.map(({ id, name, role, rule }) => ({ id, name, role, rule })),
        entries: derivation.entries,
        provenance: derivation.provenance.map(({ elementRole, rule }) => ({ elementRole, rule })),
      });
    },
    {
      name: "derive_security_profile",
      description:
        "Applies the rules table to the building's CoStar record and Vexcel tags: the security era, guard force, " +
        "cameras and locks, the staging floor, the quiet, crowded and secure zones, and the entries, each with the " +
        "rule that produced it. The manifest is built from this result.",
      schema: BuildingArg,
    },
  );

  return [getBuilding, getAvailableSpace, getAerialEntries, deriveProfile];
}

/** The tool the game master uses: the mission library. */
export function gameMasterTools(run: BuildRun) {
  const listMissions = tool(
    async ({ city }) => json(missionsFor(city, run.missions ?? MISSIONS)),
    {
      name: "list_missions",
      description:
        "The missions staged in a city: each one's id, type, title, the documented event it is inspired by (or " +
        "null when fictional), objective and exit condition.",
      schema: z.object({ city: z.enum(["LA", "Houston"]) }),
    },
  );
  return [listMissions];
}

const WriteManifestArgs = z.object({
  buildingId: z.string(),
  missionId: z.string().describe("A mission id from list_missions, staged in the building's city"),
  briefing: z.string().min(1).describe("The Game Master's briefing to the crew, in plain English"),
  objective: z
    .object({
      name: z.string().min(1).describe("The game-fiction name of the room the objective is in"),
      rule: z.string().min(1).describe("What the player must do there"),
    })
    .describe("The objective zone"),
});

/** The builder's own tool: assembles, validates and stores the manifest. */
export function builderTools(run: BuildRun) {
  const writeManifest = tool(
    async ({ buildingId, missionId, briefing, objective }) => {
      const b = await building(run, buildingId);
      const derivation = run.derivation;
      if (!derivation) throw new Error("call derive_security_profile (through the data-analyst) before write_manifest");
      const mission = (run.missions ?? MISSIONS).find((m) => m.id === missionId);
      if (!mission) throw new Error(`no mission "${missionId}" in the library`);
      if (mission.city !== b.city) throw new Error(`mission ${missionId} is staged in ${mission.city}, not ${b.city}`);

      const fiction = (elementRole: string, field: string, value: string, rule: string): Provenance => ({
        elementRole,
        layer: "fiction",
        field,
        value,
        rule,
      });
      const objectiveZone: Zone = {
        id: "objective",
        name: objective.name,
        role: "objective",
        rule: objective.rule,
        provenance: [
          fiction(
            "zone:objective",
            "mission.objective",
            mission.objective,
            `Mission "${mission.title}" (game fiction): ${mission.objective.toLowerCase()}`,
          ),
        ],
      };
      const missionProvenance = fiction(
        `mission:${mission.id}`,
        "mission.inspiredBy",
        mission.inspiredBy ? `${mission.inspiredBy.event}, ${mission.inspiredBy.date}` : "fictional",
        mission.inspiredBy
          ? `Picked from the ${b.city} library; inspired by ${mission.inspiredBy.event} (${mission.inspiredBy.date}), ` +
            "staged in a comparable building"
          : `Picked from the ${b.city} library; a fictional mission, labelled as such`,
      );

      const manifest = LevelManifest.parse({
        buildingId,
        securityProfile: derivation.securityProfile,
        zones: [...derivation.zones, objectiveZone],
        entries: derivation.entries,
        mission: { ...mission, briefing },
        provenance: [...derivation.provenance, objectiveZone.provenance[0], missionProvenance],
      });
      run.manifest = manifest;
      return (
        `Manifest written for ${buildingId}: ${manifest.zones.length} zones, ${manifest.entries.length} entries, ` +
        `${manifest.provenance.length} provenance entries, mission ${mission.id}.`
      );
    },
    {
      name: "write_manifest",
      description:
        "Writes the level manifest: the derived security profile, zones and entries, plus the chosen mission, " +
        "its briefing and the objective zone. Validates it against the LevelManifest schema.",
      schema: WriteManifestArgs,
    },
  );
  return [writeManifest];
}
