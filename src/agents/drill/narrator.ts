// The drill narrator (SPEC §4.4): one structured call per drill, a scenario
// paragraph and three recommendations. It is told the drill's facts
// (src/drill/facts.ts) and nothing else. In fake mode, on a timeout or on a
// failure, the narrative recorded for exactly those facts answers, and the
// answer says so. Live, when the model fails and nothing is recorded for the
// drill, that is the model's failure, not "nothing recorded": it throws
// `NarratorUnavailableError`, so the screen offers a retry.
import {
  getChatModelSelection,
  LlmConfigurationError,
  structuredCall,
  type ChatModelSelection,
  type StructuredCallOptions,
} from "@/adapters/llm";
import { DrillReport as DrillNarrative } from "@/domain";
import type { DrillFacts } from "@/drill";
import { loadDrillRecording, matchNarrative, NoNarrativeError } from "./recorded";

export interface NarrativeAnswer {
  narrative: DrillNarrative;
  /** True when a recorded narrative answered, not a live model. */
  recorded: boolean;
  reason?: "fake mode" | "configuration" | "timeout" | "error";
  /** The recorded narrative's id, when one answered. */
  recording?: string;
}

export interface NarrateOptions {
  /** Test seams for structuredCall. */
  selection?: StructuredCallOptions<DrillNarrative>["selection"];
  timeoutMs?: number;
  fixturesDir?: string;
}

export const NARRATOR_PROMPT_HEAD = "You write the scenario for a building's evacuation drill plan.";

export function narratorSystemPrompt(): string {
  return `${NARRATOR_PROMPT_HEAD}

The reader is the building's fire safety director. You get the drill's facts
as JSON. Write one paragraph of at most four sentences that says who is on
the floor and where, which stair the drill blocks and why, how long the floor
takes to get into a stair against the time with every stair open, and where
people queue. Then give exactly three recommendations, one sentence each,
naming a room, door id or stair from the facts.

Use only the numbers, rooms, doors and stairs in the facts; never invent one
and never round. Keys ending in "S" are seconds. When "allClear" is false, say how many
cannot reach a stair, and never say the floor clears. Plain words, present
tense, sentence case, no exclamation marks.

A zone's "rerouted" is how many of its people would use the blocked stair
with every stair open. Only those need turning toward an open stair; never
say a zone with "rerouted" 0 must be turned, and turn every zone whose
"rerouted" is above 0.

The bottleneck is the room people queue to get into or along: a person
waits at the doorway into it, or inside it for the way ahead, so never say
they queue or wait "in" it. Its figures are the whole room's. "peakQueue" is
the most people waiting to get into or along it at once; "waiters" is how many
people waited for it at all; "mostWaitedS" is the most seconds any one of
them waited, all of their waits added together, since a person in a stop-start
queue waits, moves on and waits again: never call it one wait or the longest
wait, say it is in all; "throughput" is how many pass through it.
"personSeconds" is everyone's waits added up, not a time on the clock: if you
state it, call it person-seconds, never seconds.

A warden post is one way out of a room and its door; a room with two ways out
in use has two posts. Its "people" is how many of the room leave by that door,
not the room's headcount: a warden there reaches only them, so to reach a
whole room, name every one of its posts' doors.`;
}

export function narratorMessages(facts: DrillFacts) {
  return [
    { role: "system", content: narratorSystemPrompt() },
    { role: "user", content: JSON.stringify(facts) },
  ];
}

/** A live model call failed, and no recorded narrative can stand in. Worth a retry. */
export class NarratorUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NarratorUnavailableError";
  }
}

/**
 * The fast model, or undefined when a setting refuses every live call: structuredCall then
 * answers with the recording, reason "configuration", and no model is called.
 */
function safeSelection(): { selection?: ChatModelSelection; refused: boolean } {
  try {
    return { selection: getChatModelSelection("fast"), refused: false };
  } catch (error) {
    if (!(error instanceof LlmConfigurationError)) throw error;
    return { refused: true };
  }
}

/**
 * Narrates one drill. Throws `NoNarrativeError` in fake mode, or under a setting that refuses every live call,
 * when nothing is recorded for these facts, and
 * `NarratorUnavailableError` when a live call fails and nothing is recorded to stand in.
 */
export async function narrateDrill(facts: DrillFacts, options: NarrateOptions = {}): Promise<NarrativeAnswer> {
  let recording: string | undefined;
  const { selection, refused } = options.selection ? { selection: options.selection, refused: false } : safeSelection();
  const fake = async () => {
    const file = await loadDrillRecording(facts.buildingId, options.fixturesDir);
    const found = file ? matchNarrative(file, facts) : null;
    if (!found) {
      const none = `no recorded narrative for this drill of "${facts.buildingId}", floor ${facts.floor}`;
      // Live, the fake answers only after the model failed: that failure is what to report.
      // A refusing setting called no model, so there is nothing to retry: as in fake mode.
      if (selection?.mode !== "fake" && !refused) throw new NarratorUnavailableError(`the model did not answer, and there is ${none}`);
      throw new NoNarrativeError(none);
    }
    recording = found.id;
    return found.narrative;
  };
  const answer = await structuredCall(DrillNarrative, narratorMessages(facts), {
    fake,
    name: "drill_narrative",
    role: "fast",
    selection,
    timeoutMs: options.timeoutMs,
  });
  return {
    narrative: answer.value,
    recorded: answer.recorded,
    ...(answer.reason && { reason: answer.reason }),
    ...(recording && { recording }),
  };
}
