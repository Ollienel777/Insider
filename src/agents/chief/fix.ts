// The Security Chief's suggested fix for Owner Mode (issue 127): after a batch,
// one structured call reads the batch summed into zone and element ids and
// the security profile, and suggests one change to the setup. It never sees
// the floor (SPEC §4.5): the summary is a strict `FixSummary`. Live, the
// fast model answers within LLM_TIMEOUT_MS; in fake mode, on a timeout or a
// failure, the recorded fix answers, or the deterministic template when there
// is none. Whatever answers is clamped to the level's roster and the
// summary's zones; a change naming anything else is dropped with the reason,
// and the template stands in.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { readLevel } from "@/agents/builder/live-levels";
import { defaultMissionId } from "@/agents/builder/missions";
import { structuredCall, type StructuredCallOptions } from "@/adapters/llm";
import {
  ChiefFix,
  FIX_RATIONALE_MAX,
  FIX_RETIME_MAX,
  type FixChange,
  type FixRequest,
  type FixSummary,
  type LevelManifest,
} from "@/domain";
import { CHIEF_FIXTURES } from "./recorded";
import type { ChiefSource } from "./request";

export const FIX_PROMPT_HEAD = "You are the Security Chief for a building whose owner just watched the crew try 50 ways in.";

export const FixRecording = z.object({
  buildingId: z.string().min(1),
  note: z.string().optional(),
  fix: ChiefFix,
});
export type FixRecording = z.infer<typeof FixRecording>;

export interface FixAnswer {
  fix: ChiefFix;
  /** True when no live model answered: fake mode, no configured provider, a timeout or a failure. */
  recorded: boolean;
  reason?: "fake mode" | "configuration" | "timeout" | "error";
  /** Who wrote `fix`: the model, the recording, or the template (when nothing else gave a change that fits). */
  source: ChiefSource;
  /** A change left out, and why: it named an element or zone this level does not have. */
  dropped?: { change: FixChange; reason: string };
}

export interface FixOptions {
  /** Test seams for structuredCall. */
  selection?: StructuredCallOptions<ChiefFix>["selection"];
  timeoutMs?: number;
  fixturesDir?: string;
  levelsDir?: string;
  /** The mission whose level to read (#119); the building's own mission by default. */
  missionId?: string;
}

/** The ids the Chief may name: the profile's roster and every element the batch saw. */
export interface FixRoster {
  guards: string[];
  cameras: string[];
  zones: string[];
}

export function fixRoster(manifest: LevelManifest, summary: FixSummary): FixRoster {
  const p = manifest.securityProfile;
  const seen = (kind: string) => summary.detectors.filter((d) => d.kind === kind && d.id).map((d) => d.id!);
  const unique = (ids: string[]) => [...new Set(ids)];
  return {
    guards: unique([...Array.from({ length: p.guardCount }, (_, i) => `G${i + 1}`), ...seen("guard")]),
    cameras: unique([...Array.from({ length: p.cameraCount }, (_, i) => `C${i + 1}`), ...seen("camera")]),
    zones: summary.zones.map((z) => z.id),
  };
}

/** The change if it names only what the roster has and carries what its kind needs; else the reason. */
export function clampFix(roster: FixRoster, fix: ChiefFix): { ok: true; fix: ChiefFix } | { ok: false; reason: string } {
  const { kind, elementId, to, byTurns } = fix.change;
  const zone = (id: string | undefined, what: string) =>
    id === undefined ? `${kind} needs ${what}` : roster.zones.includes(id) ? null : `"${id}" is not a zone of this level`;
  let reason: string | null = null;
  let change: FixChange;
  switch (kind) {
    case "move-camera":
      reason = !roster.cameras.includes(elementId) ? `"${elementId}" is not a camera of this level` : zone(to, "a zone to cover");
      change = { kind, elementId, to };
      break;
    case "retime-guard": {
      if (!roster.guards.includes(elementId)) reason = `"${elementId}" is not a guard of this level`;
      else if (byTurns === undefined || byTurns === 0) reason = "retime-guard needs a non-zero byTurns";
      const by = Math.max(-FIX_RETIME_MAX, Math.min(FIX_RETIME_MAX, byTurns ?? 0));
      change = { kind, elementId, byTurns: by };
      break;
    }
    case "lock-door":
      reason = zone(elementId, "a zone");
      change = { kind, elementId };
      break;
    case "add-guard":
      reason = roster.guards.includes(elementId) || roster.cameras.includes(elementId)
        ? `"${elementId}" is already on this level`
        : !/^G\d{1,2}$/.test(elementId)
          ? `a new guard's id is G and a number, not "${elementId}"`
          : zone(to, "a zone to walk");
      change = { kind, elementId, to };
      break;
  }
  return reason ? { ok: false, reason } : { ok: true, fix: { change, rationale: fix.rationale } };
}

/** The zone's name in the summary, else its id. */
function nameOf(summary: FixSummary, id: string): string {
  return summary.zones.find((z) => z.id === id)?.name ?? id;
}

function clip(text: string): string {
  return text.length <= FIX_RATIONALE_MAX ? text : `${text.slice(0, FIX_RATIONALE_MAX - 1).trimEnd()}…`;
}

/**
 * The deterministic fix, from the summary alone. With escapes, it puts the
 * camera that noticed the crew least over the zone the commonest way out
 * crossed just before the objective; with none, it moves the round of the
 * guard that caught them most, so the owner still sees a rerun.
 */
export function fixTemplate(manifest: LevelManifest, summary: FixSummary): ChiefFix {
  const roster = fixRoster(manifest, summary);
  const entries = new Set(manifest.entries.map((e) => e.id));
  const objective = manifest.zones.find((z) => z.role === "objective")?.id;
  const counted = (id: string) => summary.detectors.find((d) => d.id === id)?.count ?? 0;
  const route = summary.topRoute?.zones ?? [];
  const toObjective = objective ? route.slice(0, Math.max(0, route.indexOf(objective))) : route;
  const approach = [...toObjective].reverse().find((id) => !entries.has(id) && roster.zones.includes(id));

  if (summary.escaped > 0 && approach && roster.cameras.length > 0) {
    const camera = [...roster.cameras].sort((a, b) => counted(a) - counted(b) || a.localeCompare(b))[0];
    return {
      change: { kind: "move-camera", elementId: camera, to: approach },
      rationale: clip(
        `${summary.escaped} of ${summary.total} got out, most through the ${nameOf(summary, approach)}. Put ${camera} on it, the camera that saw them least.`,
      ),
    };
  }
  if (summary.escaped > 0 && objective && roster.zones.includes(objective)) {
    const id = `G${roster.guards.length + 1}`;
    return {
      change: { kind: "add-guard", elementId: id, to: objective },
      rationale: clip(`${summary.escaped} of ${summary.total} got out with the files. Post a new guard, ${id}, on the ${nameOf(summary, objective)}.`),
    };
  }
  const guard = summary.detectors.find((d) => d.kind === "guard" && d.id && roster.guards.includes(d.id))?.id ?? roster.guards[0] ?? "G1";
  return {
    change: { kind: "retime-guard", elementId: guard, byTurns: 1 },
    rationale: clip(`Nobody got out of ${summary.total}. Hold the setup; at most, walk ${guard}'s round a turn later so it is less easy to read.`),
  };
}

export function fixSystemPrompt(manifest: LevelManifest, summary: FixSummary, roster: FixRoster): string {
  const p = manifest.securityProfile;
  return `${FIX_PROMPT_HEAD}

Suggest exactly one change to the security that would most cut the crew's
successes. The change is one of:
- move-camera: camera elementId now covers zone "to".
- retime-guard: guard elementId walks its round byTurns turns later (negative
  is earlier), at most ${FIX_RETIME_MAX} either way.
- lock-door: every lockable door into zone elementId starts locked.
- add-guard: a new guard elementId (the next G number) walks zone "to".

The rationale is for the owner: one or two plain sentences, under
${FIX_RATIONALE_MAX} characters, naming the element and the zone by name, and why.
Use only these ids; never invent one.

Building: ${manifest.buildingId}. Mission: ${manifest.mission.title}.
Security: ${p.era} era, ${p.guardCount} guards, ${p.cameraCount} ${p.cameraKind} cameras, ${p.lockKind} locks.
Guards: ${roster.guards.join(", ")}. Cameras: ${roster.cameras.join(", ")}.
Zones (id: name):
${summary.zones.map((z) => `- ${z.id}: ${z.name}`).join("\n")}`;
}

export function fixUserPrompt(summary: FixSummary): string {
  const route = summary.topRoute ? `${summary.topRoute.zones.join(" > ")} (${summary.topRoute.count} times)` : "none";
  return `${summary.escaped} of ${summary.total} attempts got out with the objective.
By strategy: ${summary.byStrategy.map((s) => `${s.strategyId} ${s.escaped}/${s.runs}`).join("; ") || "none"}.
Commonest way out, by zone: ${route}.
First to notice the crew: ${summary.detectors.map((d) => `${d.kind} ${d.id ?? ""}`.trim() + ` ${d.count} times (turns ${d.turns.join(", ")})`).join("; ") || "nothing"}.`;
}

export function fixMessages(manifest: LevelManifest, summary: FixSummary, roster: FixRoster = fixRoster(manifest, summary)) {
  return [
    { role: "system", content: fixSystemPrompt(manifest, summary, roster) },
    { role: "user", content: fixUserPrompt(summary) },
  ];
}

/** Reads and checks a building's recorded fix; null when there is none. */
export async function loadFixRecording(buildingId: string, dir: string = CHIEF_FIXTURES): Promise<FixRecording | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(buildingId)) return null;
  let raw: string;
  try {
    raw = await readFile(path.join(dir, `fix-${buildingId}.json`), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return FixRecording.parse(JSON.parse(raw));
}

/** The Chief's one suggested change for a batch. Null when there is no cached level for the mission. */
export async function suggestFix(request: FixRequest, options: FixOptions = {}): Promise<FixAnswer | null> {
  const missionId = options.missionId ?? defaultMissionId(request.buildingId);
  // A showcase kit building's level is in memory (#93, issue 205), as the crew's strategies read it.
  const cached = missionId ? await readLevel(request.buildingId, missionId, options.levelsDir) : null;
  if (!cached) return null;
  const { manifest } = cached;
  const { summary } = request;
  const roster = fixRoster(manifest, summary);

  let source: ChiefSource = "model";
  const fake = async (): Promise<ChiefFix> => {
    const file = await loadFixRecording(request.buildingId, options.fixturesDir);
    source = file ? "recorded" : "template";
    return file ? file.fix : fixTemplate(manifest, summary);
  };
  const answer = await structuredCall(ChiefFix, fixMessages(manifest, summary, roster), {
    fake,
    name: "chief_fix",
    role: "fast",
    selection: options.selection,
    timeoutMs: options.timeoutMs,
  });
  const base = {
    recorded: answer.recorded,
    ...(answer.reason && { reason: answer.reason }),
  };
  const clamped = clampFix(roster, answer.value);
  if (clamped.ok) return { ...base, fix: clamped.fix, source: answer.recorded ? source : "model" };
  return {
    ...base,
    fix: fixTemplate(manifest, summary),
    source: "template",
    dropped: { change: answer.value.change, reason: clamped.reason },
  };
}
