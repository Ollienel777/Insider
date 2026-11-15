// What first person says when the run is over (issue 157): the end, and why,
// in the words the Debrief uses, so a capture reads as cause and effect on
// the spot: who noticed the player and where, then who reached them. Pure:
// it reads the run state and the placed level, nothing else.
import { LEVELS, type RunState } from "@/engine";
import type { PlacedLevel } from "@/level/placer";
import { objectiveNoun } from "@/lib/objective-noun";
import { roomName, zoneName } from "../board";

export interface EndState {
  outcome: "won" | "caught";
  /** "Caught in the Corridor." or "Out with the files." */
  headline: string;
  /** Why: who saw the player where, and who reached them; or which way out and how long. Null when nothing more is known. */
  detail: string | null;
}

const rank = (alarm: RunState["alarm"]) => LEVELS.indexOf(alarm);
const NOTICED = new Set(["camera", "guard", "cleaner", "noise"]);

/** "G1", "G1 and G2", "G1, G2 and G3". */
function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The end of `run` as first person shows it; null while it is still being played. */
export function endState(placed: PlacedLevel, run: RunState): EndState | null {
  if (run.status === "playing") return null;
  const { floor } = placed.level;
  if (run.status === "won") {
    const exit = placed.entries.find((e) => e.nodeId === run.playerNode)?.label ?? roomName(floor, run.playerNode);
    const turns = `${run.turn} ${run.turn === 1 ? "turn" : "turns"}`;
    return { outcome: "won", headline: `Out with the ${objectiveNoun(placed.level.missionId)}.`, detail: `Out through the ${exit.toLowerCase()} in ${turns}.` };
  }
  // The sighting that first put the alarm at Alert or above: what the capture follows from.
  const trip = run.alarmEvents.find((e) => rank(e.to) >= rank("alert") && rank(e.to) > rank(e.from) && NOTICED.has(e.cause.kind));
  const where = trip?.lastKnownZone ? zoneName(placed, trip.lastKnownZone) : null;
  const tripLine = trip
    ? `${trip.cause.kind === "camera" ? "Camera " : ""}${trip.cause.id ?? "Someone"} ${trip.cause.kind === "noise" ? "heard" : "saw"} you${where ? ` in the ${where}` : ""}.`
    : null;
  const by = run.guards.filter((g) => g.nodeId === run.playerNode).map((g) => g.id);
  const reached = by.length > 0 ? `${joinAnd(by)} reached you.` : null;
  return { outcome: "caught", headline: `Caught in the ${roomName(floor, run.playerNode)}.`, detail: [tripLine, reached].filter(Boolean).join(" ") || null };
}
