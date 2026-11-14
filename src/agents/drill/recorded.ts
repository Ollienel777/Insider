// The drill narrator's recorded narratives (SPEC §4.5):
// `fixtures/llm/drill-<id>.json`. Each answers only the exact facts it was
// recorded for, so a recorded paragraph never describes a different drill
// from the one on screen.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { DrillReport as DrillNarrative } from "@/domain";
import { DrillFacts } from "@/drill";

export const DRILL_FIXTURES = path.join(process.cwd(), "fixtures", "llm");

export const RecordedNarrative = z.object({
  id: z.string().min(1),
  facts: DrillFacts,
  narrative: DrillNarrative,
});
export type RecordedNarrative = z.infer<typeof RecordedNarrative>;

export const DrillRecording = z.object({
  buildingId: z.string().min(1),
  note: z.string().optional(),
  narratives: z.array(RecordedNarrative).min(1),
});
export type DrillRecording = z.infer<typeof DrillRecording>;

/** No recorded narrative describes these facts. */
export class NoNarrativeError extends Error {
  override name = "NoNarrativeError";
}

/** Reads and checks a building's recording; null when there is none. */
export async function loadDrillRecording(buildingId: string, dir: string = DRILL_FIXTURES): Promise<DrillRecording | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(buildingId)) return null;
  let raw: string;
  try {
    raw = await readFile(path.join(dir, `drill-${buildingId}.json`), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return DrillRecording.parse(JSON.parse(raw));
}

/** The narrative recorded for exactly these facts, or null. */
export function matchNarrative(recording: DrillRecording, facts: DrillFacts): RecordedNarrative | null {
  return recording.narratives.find((n) => isDeepStrictEqual(n.facts, facts)) ?? null;
}
