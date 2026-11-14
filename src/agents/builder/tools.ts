// The Level Builder's tools (SPEC §4.4). They run for real against the
// adapters (fakes in fake mode): the model chooses and writes, the tools
// read the data and apply the rules table.
//
// One `BuildRun` holds what the tools learned in this run.
// `write_manifest` builds the manifest from the derivation that
// `derive_security_profile` stored, the mission the run was given (the one
// the player chose, #119) and the briefing the agent wrote, so every number in the level comes from a
// tool call the trace shows, never from the model's own text.
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { CoStarAdapter } from "@/adapters/costar";
import type { VexcelAdapter } from "@/adapters/vexcel";
import { BRIEFING_MAX_WORDS, type Building, briefingProblems, LevelManifest, type Mission, type Provenance, type Zone } from "@/domain";
import { deriveSecurityProfile, type SecurityDerivation } from "@/level/rules";
import { findMission, MISSIONS } from "./missions";

export interface BuildRun {
  /** The building this run builds; every tool refuses any other id. */
  buildingId: string;
  /** The mission this run builds the level for; `get_mission` and `write_manifest` refuse any other id. */
  missionId: string;
  costar: CoStarAdapter;
  vexcel: VexcelAdapter;
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

/** The run's mission from the library; any other id is refused. */
function mission(run: BuildRun, missionId: string): Mission {
  if (missionId !== run.missionId) throw new Error(`this run builds mission ${run.missionId}, not ${missionId}`);
  const found = findMission(missionId, run.missions ?? MISSIONS);
  if (!found) throw new Error(`no mission "${missionId}" in the library`);
  return found;
}

/** The tool the game master uses: the mission the player chose. */
export function gameMasterTools(run: BuildRun) {
  const getMission = tool(
    async ({ missionId }) => {
      // The building is already cast, so the casting needs stay out of the reply.
      const { casting: _casting, ...rest } = mission(run, missionId);
      void _casting;
      return json(rest);
    },
    {
      name: "get_mission",
      description:
        "The mission this level is built for: its id, city, type, title, the documented event it is inspired by " +
        "(or null when fictional), objective and exit condition.",
      schema: z.object({ missionId: z.string().describe("The mission id the builder was given, for example romaine-1974") }),
    },
  );
  return [getMission];
}

const WriteManifestArgs = z.object({
  buildingId: z.string(),
  missionId: z.string().describe("The mission id the builder was given"),
  briefing: z
    .string()
    .min(1)
    .describe("The game master's briefing to the crew, copied verbatim: every sentence, the game-fiction line included"),
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
      const problems = briefingProblems(briefing);
      if (problems.length > 0) {
        throw new Error(`${problems.join("; ")}. Send it back to the game-master to rewrite; do not edit it yourself`);
      }
      const chosen = mission(run, missionId);
      if (chosen.city !== b.city) throw new Error(`mission ${missionId} is staged in ${chosen.city}, not ${b.city}`);

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
            chosen.objective,
            `Mission "${chosen.title}" (game fiction): ${chosen.objective.toLowerCase()}`,
          ),
        ],
      };
      const missionProvenance = fiction(
        `mission:${chosen.id}`,
        "mission.inspiredBy",
        chosen.inspiredBy ? `${chosen.inspiredBy.event}, ${chosen.inspiredBy.date}` : "fictional",
        chosen.inspiredBy
          ? `The mission the player chose; inspired by ${chosen.inspiredBy.event} (${chosen.inspiredBy.date}), ` +
            "staged in a comparable building"
          : "The mission the player chose; a fictional mission, labelled as such",
      );

      const manifest = LevelManifest.parse({
        buildingId,
        securityProfile: derivation.securityProfile,
        zones: [...derivation.zones, objectiveZone],
        entries: derivation.entries,
        missionId: chosen.id,
        mission: { ...chosen, briefing },
        provenance: [...derivation.provenance, objectiveZone.provenance[0], missionProvenance],
      });
      run.manifest = manifest;
      return (
        `Manifest written for ${buildingId}: ${manifest.zones.length} zones, ${manifest.entries.length} entries, ` +
        `${manifest.provenance.length} provenance entries, mission ${chosen.id}.`
      );
    },
    {
      name: "write_manifest",
      description:
        "Writes the level manifest: the derived security profile, zones and entries, plus the mission, its " +
        `briefing and the objective zone. Refuses a briefing over ${BRIEFING_MAX_WORDS} words or one that does not ` +
        "say its security is game fiction. Validates it against the LevelManifest schema.",
      schema: WriteManifestArgs,
    },
  );
  return [writeManifest];
}
