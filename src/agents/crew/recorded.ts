// The crew's recorded replies (SPEC §4.5): `fixtures/llm/crew-<id>.json`,
// routed on keywords in the order. They answer in fake mode, and stand in
// when a live call times out or fails.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { StandInReason } from "@/adapters/llm";
import { CrewPlan } from "@/domain";

export const CREW_FIXTURES = path.join(process.cwd(), "fixtures", "llm");

export const RecordedReply = z.object({
  id: z.string().min(1),
  /** Keyword sets: the reply answers when every keyword of any one set occurs in the order. Empty: the default. */
  when: z.array(z.array(z.string().min(1)).min(1)),
  plan: CrewPlan,
});
export type RecordedReply = z.infer<typeof RecordedReply>;

export const CrewRecording = z
  .object({
    buildingId: z.string().min(1),
    note: z.string().optional(),
    replies: z.array(RecordedReply).min(1),
  })
  .refine((r) => r.replies[r.replies.length - 1].when.length === 0, {
    message: "the last reply must be the default, with no keywords",
  });
export type CrewRecording = z.infer<typeof CrewRecording>;

/** The building has no recorded crew replies. */
export class NoRecordingError extends Error {
  override name = "NoRecordingError";
  /** Why a recording was asked for: the model was off, timed out or failed (issue 140). */
  readonly reason?: StandInReason;
  constructor(message: string, reason?: StandInReason) {
    super(message);
    if (reason) this.reason = reason;
  }
}

/** Reads and checks a building's recording; null when there is none. */
export async function loadCrewRecording(buildingId: string, dir: string = CREW_FIXTURES): Promise<CrewRecording | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(buildingId)) return null;
  let raw: string;
  try {
    raw = await readFile(path.join(dir, `crew-${buildingId}.json`), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return CrewRecording.parse(JSON.parse(raw));
}

/** The first reply whose keywords all occur in the order, else the default. */
export function routeOrder(recording: CrewRecording, order: string): RecordedReply {
  const text = order.toLowerCase();
  return (
    recording.replies.find((r) => r.when.some((set) => set.every((word) => text.includes(word.toLowerCase())))) ??
    recording.replies[recording.replies.length - 1]
  );
}
