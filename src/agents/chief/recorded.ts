// The Chief's recorded turns (SPEC §4.5): `fixtures/llm/chief-<id>.json`, one
// per alarm transition worth rehearsing. They answer in fake mode, and stand
// in when a live call times out or fails; a transition with no recording
// gets the deterministic template (template.ts).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { AlarmState, ChiefOrders } from "@/domain";
import type { ChiefRequest } from "./request";

export const CHIEF_FIXTURES = path.join(process.cwd(), "fixtures", "llm");

export const RecordedTurn = z.object({
  id: z.string().min(1),
  /** The transition it answers. Every field given must match; a missing one matches anything. */
  when: z.object({
    from: AlarmState.optional(),
    to: AlarmState.optional(),
    lastKnownZone: z.string().min(1).optional(),
    causeId: z.string().min(1).optional(),
  }),
  orders: ChiefOrders,
});
export type RecordedTurn = z.infer<typeof RecordedTurn>;

export const ChiefRecording = z.object({
  buildingId: z.string().min(1),
  note: z.string().optional(),
  turns: z.array(RecordedTurn).min(1),
});
export type ChiefRecording = z.infer<typeof ChiefRecording>;

/** Reads and checks a building's recording; null when there is none. */
export async function loadChiefRecording(buildingId: string, dir: string = CHIEF_FIXTURES): Promise<ChiefRecording | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(buildingId)) return null;
  let raw: string;
  try {
    raw = await readFile(path.join(dir, `chief-${buildingId}.json`), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return ChiefRecording.parse(JSON.parse(raw));
}

/** The first recorded turn whose `when` matches the request's transition, or null. */
export function matchTurn(recording: ChiefRecording, request: ChiefRequest): RecordedTurn | null {
  const t = request.transition;
  return (
    recording.turns.find(
      ({ when }) =>
        (when.from === undefined || when.from === t.from) &&
        (when.to === undefined || when.to === t.to) &&
        (when.lastKnownZone === undefined || when.lastKnownZone === request.lastKnownZone) &&
        (when.causeId === undefined || when.causeId === t.cause.id),
    ) ?? null
  );
}
