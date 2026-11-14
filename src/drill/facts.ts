// What the drill narrator is told (SPEC §4.4): the report's numbers and the
// names of its rooms and stairs, and nothing else. No node, coordinate or
// edge leaves the browser in it. The drill screen sends these to
// `POST /api/drill/narrative`; a recorded narrative answers only the facts it
// was recorded for, so a recorded paragraph is never shown against a report
// it does not describe.
//
// Pure, like the rest of src/drill.
import { z } from "zod";
import type { FloorGraph } from "@/domain";
import type { DrillReport } from "./simulate";

const Label = z.string().min(1).max(80);
const Count = z.number().int().min(0).max(100_000);

export const DrillFacts = z
  .object({
    buildingId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    floor: z.number().int().min(1).max(500),
    headcount: Count,
    /** The blocked stair's room label; null when none is blocked. */
    blockedStair: Label.nullable(),
    /** How many would have used it with every stair open. */
    wouldUse: Count,
    openStairs: z.array(Label).max(20),
    timeToClearS: Count,
    /** The time to clear with every stair open. */
    baselineS: Count,
    allClear: z.boolean(),
    stranded: Count,
    /**
     * The room people spent the most time queued to get into or along; every figure is the whole room's
     * (see `Bottleneck`). `personSeconds` is a sum over people, not a span of time on the clock, and
     * `mostWaitedS` is one person's waits added together, not one unbroken wait.
     */
    bottleneck: z
      .object({
        label: Label,
        peakQueue: Count,
        waiters: Count,
        mostWaitedS: Count,
        personSeconds: Count,
        throughput: Count,
      })
      .strict()
      .nullable(),
    zones: z
      .array(
        z
          .object({
            label: Label,
            occupants: Count,
            clearedAtS: Count.nullable(),
            /** How many of the room's occupants would have used the blocked stair with every stair open, so must be turned. */
            rerouted: Count,
          })
          .strict(),
      )
      .max(100),
    /** One per way out of an occupied room that anyone takes; "people" is how many of the room leave by it. */
    wardenPosts: z.array(z.object({ label: Label, doorId: z.string().max(80).nullable(), people: Count }).strict()).max(100),
  })
  .strict();
export type DrillFacts = z.infer<typeof DrillFacts>;

/** The facts of a drill, from its report, the same floor with every stair open, and the board's room labels. */
export function drillFacts(report: DrillReport, baseline: DrillReport, floor: FloorGraph): DrillFacts {
  const roomOf = new Map(floor.nodes.map((n) => [n.id, n.roomId]));
  const labelOf = new Map(floor.rooms.map((r) => [r.id, r.label]));
  const stairLabel = (nodeId: string) => labelOf.get(roomOf.get(nodeId) ?? "") ?? nodeId;
  const blockedNode = report.scenario.blockedStair?.nodeId ?? null;
  const rerouted = (roomId: string) =>
    blockedNode === null ? 0 : baseline.occupants.filter((o) => o.roomId === roomId && o.stair === blockedNode).length;
  return {
    buildingId: report.buildingId,
    floor: report.headcount.floor,
    headcount: report.headcount.count,
    blockedStair: report.scenario.blockedStair?.label ?? null,
    wouldUse: report.scenario.wouldUse,
    openStairs: report.openStairs.map(stairLabel),
    timeToClearS: report.timeToClearS,
    baselineS: baseline.timeToClearS,
    allClear: report.allClear,
    stranded: report.stranded.length,
    bottleneck: report.bottleneck
      ? {
          label: report.bottleneck.label,
          peakQueue: report.bottleneck.peakQueue,
          waiters: report.bottleneck.waiters,
          mostWaitedS: report.bottleneck.mostWaitedS,
          personSeconds: report.bottleneck.personSeconds,
          throughput: report.bottleneck.throughput,
        }
      : null,
    zones: report.zones.map((z) => ({
      label: z.label,
      occupants: z.occupants,
      clearedAtS: z.clearedAtS,
      rerouted: rerouted(z.roomId),
    })),
    wardenPosts: report.wardenPosts.map((p) => ({ label: p.label, doorId: p.doorId, people: p.people })),
  };
}
