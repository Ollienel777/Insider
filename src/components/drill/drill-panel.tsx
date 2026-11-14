import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { LayerDot } from "@/components/shell/layer-dot";
import type { DrillReport } from "@/drill";
import { cn } from "@/lib/utils";
import { clearedBy, seconds } from "./playback";

export type Phase = "playing" | "done";

/**
 * The drill's side panel (DESIGN.md, Drill): the time to clear in `3xl`, the
 * three answers SPEC beat 7 names (the bottleneck, per-zone clear times and
 * warden posts) straight under it, so all three sit above the fold at
 * 1440x900; then who cannot reach a stair, the blocked stair and the
 * report's sentence on why, the narrative and the headcount's basis. While the playback
 * runs, the clock counts and each zone row ticks as its last occupant reaches
 * a stair. Every figure here is read from the report.
 */
export function DrillPanel({
  report,
  baselineS,
  numberedAs = null,
  simS,
  phase,
  narrative,
}: {
  report: DrillReport;
  /** The time to clear with every stair open. */
  baselineS: number;
  /** When the board's suite numbers are another floor's (one typical plan serves every floor), that floor. */
  numberedAs?: number | null;
  simS: number;
  phase: Phase;
  narrative: ReactNode;
}) {
  const done = phase === "done";
  const t = done ? report.timeToClearS : Math.min(Math.floor(simS), report.timeToClearS);
  const blocked = report.scenario.blockedStair;
  const moving = report.occupants.filter((o) => o.clearedAtS !== null).length;
  const delta = report.timeToClearS - baselineS;

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="clear-label" className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="clear-label" className="label-caps text-text-3">
            {done ? (report.allClear ? "Time to clear" : "Floor not clear") : "Clearing"}
          </h2>
          <p className="font-mono text-xs text-text-2">
            Floor {report.headcount.floor} · {report.headcount.count}{" "}
            {report.headcount.count === 1 ? "occupant" : "occupants"}
          </p>
        </div>
        {done && !report.allClear ? (
          <>
            <p data-testid="drill-time" data-phase={phase} className="text-3xl font-semibold tabular-nums text-danger">
              {report.stranded.length} cut off
            </p>
            <p className="text-sm text-text-2">
              {report.stranded.length} {report.stranded.length === 1 ? "person cannot" : "people cannot"} reach an open stair.
              {moving > 0 ? ` The other ${moving} are in a stair by ${seconds(report.timeToClearS)}.` : ""}
            </p>
          </>
        ) : (
          <>
            <p
              data-testid="drill-time"
              data-phase={phase}
              aria-live={done ? "polite" : "off"}
              aria-label={seconds(t)}
              className={cn("text-3xl font-semibold tabular-nums", done ? "text-text-1" : "text-text-2")}
            >
              {Math.round(t).toLocaleString("en-US")}
              <span className="ml-1.5 text-xl font-medium text-text-2">s</span>
            </p>
            <p className="text-sm text-text-2">
              {done ? (
                <>
                  {!blocked
                    ? "Every stair open."
                    : delta > 0
                      ? `${seconds(delta)} longer than with every stair open (${seconds(baselineS)}).`
                      : delta < 0
                        ? `${seconds(-delta)} shorter than with every stair open (${seconds(baselineS)}).`
                        : `The same as with every stair open (${seconds(baselineS)}).`}
                </>
              ) : (
                `${clearedBy(report, simS)} of ${report.headcount.count} in a stair`
              )}
            </p>
          </>
        )}
      </section>

      <section aria-labelledby="bottleneck-label" className="flex flex-col gap-1">
        <h2 id="bottleneck-label" className="label-caps text-text-3">
          Bottleneck
        </h2>
        {report.bottleneck ? (
          <>
            <p data-testid="bottleneck" className="text-base text-text-1">
              {report.bottleneck.label}
            </p>
            <p data-testid="bottleneck-figures" className="text-sm text-text-2">
              {bottleneckLine(report.bottleneck, report.headcount.count)}
            </p>
          </>
        ) : (
          <p data-testid="bottleneck" className="text-sm text-text-2">
            Nobody queued: every door and landing took people as fast as they arrived.
          </p>
        )}
      </section>

      <section aria-labelledby="zones-label" className="flex flex-col gap-2">
        <h2 id="zones-label" className="label-caps text-text-3">
          Clear time by zone
        </h2>
        <table data-testid="zones" className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th scope="col" className="py-1.5 font-normal label-caps text-text-3">
                Zone
              </th>
              <th scope="col" className="py-1.5 text-right font-normal label-caps text-text-3">
                People
              </th>
              <th scope="col" className="py-1.5 text-right font-normal label-caps text-text-3">
                Clear at
              </th>
            </tr>
          </thead>
          <tbody>
            {report.zones.map((zone) => {
              const cleared = zone.clearedAtS !== null && (done || zone.clearedAtS <= simS);
              return (
                <tr key={zone.roomId} data-testid="zone-row" data-cleared={cleared} className="border-b border-border last:border-b-0">
                  <td className="py-1.5 text-text-1">
                    <span className="flex items-center gap-2">
                      <Check
                        aria-hidden
                        className={cn("size-4 shrink-0 stroke-[1.5] transition-opacity duration-fast", cleared ? "text-success opacity-100" : "opacity-0")}
                      />
                      {zone.label}
                    </span>
                  </td>
                  <td className="py-1.5 text-right font-mono text-text-2">{zone.occupants}</td>
                  <td className={cn("py-1.5 text-right font-mono", zone.clearedAtS === null ? "text-danger" : cleared ? "text-text-1" : "text-text-3")}>
                    {zone.clearedAtS === null ? "cut off" : seconds(zone.clearedAtS)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="wardens-label" className="flex flex-col gap-2">
        <h2 id="wardens-label" className="label-caps text-text-3">
          Warden posts
        </h2>
        {report.wardenPosts.length > 0 ? (
          <ul data-testid="warden-posts" className="flex flex-col">
            {report.wardenPosts.map((post, i) => (
              <li
                key={`${post.roomId}>${post.nodeId}`}
                data-testid="warden-post"
                className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-baseline gap-2 border-b border-border py-1.5 text-sm last:border-b-0"
              >
                <span className="font-mono text-text-1">W{i + 1}</span>
                <span className="flex flex-col">
                  <span className="text-text-1">{post.label}</span>
                  <span className="font-mono text-xs text-text-2">{post.doorId ? `door ${post.doorId}` : "at its way out"}</span>
                </span>
                <span className="font-mono text-text-2">{wardenCount(post)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-text-2">No zone has a way out to post a warden at.</p>
        )}
        {report.wardenPosts.some((p) => p.people !== p.occupants) ? (
          <p data-testid="warden-note" className="text-sm text-text-2">
            A room whose people leave by more than one door has a post at each. Each count is the people who leave by
            that door.
          </p>
        ) : null}
      </section>

      {report.stranded.length > 0 ? (
        <section aria-labelledby="stranded-label" className="flex flex-col gap-2">
          <h2 id="stranded-label" className="label-caps text-danger">
            Cannot reach a stair
          </h2>
          <ul data-testid="stranded" className="flex flex-col gap-1 text-sm text-text-1">
            {strandedLines(report).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="scenario-label" className="flex flex-col gap-2">
        <h2 id="scenario-label" className="label-caps text-text-3">
          Scenario
        </h2>
        {blocked ? (
          <p data-testid="blocked-stair-name" className="border-l-2 border-danger pl-3 text-base font-medium text-text-1">
            {blocked.label} blocked
          </p>
        ) : null}
        <p data-testid="scenario-rule" className="text-sm text-text-2">
          {report.scenario.rule}.
        </p>
      </section>

      {narrative}

      <section aria-labelledby="headcount-label" className="flex flex-col gap-2">
        <h2 id="headcount-label" className="flex items-center gap-2 label-caps text-text-3">
          <LayerDot layer="costar" decorative />
          Headcount
        </h2>
        <p data-testid="headcount-rule" className="text-sm text-text-2">
          {report.headcount.rule}.
        </p>
        {numberedAs !== null ? (
          <p data-testid="plan-note" className="text-sm text-text-2">
            The board is the typical floor plan, so its suites carry floor {numberedAs}&apos;s numbers.
          </p>
        ) : null}
      </section>
    </div>
  );
}

/**
 * The bottleneck's figures as an operator reads them. The queue is booked to the room people wait to get into
 * or along (`Bottleneck`), so the line never puts it "in" the room. The sum of everyone's waits is
 * person-seconds; `mostWaitedS` is one person's waits added together over every stop, so the line says so and
 * never calls it one wait.
 */
export function bottleneckLine(b: NonNullable<DrillReport["bottleneck"]>, headcount: number): string {
  const people = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "person" : "people"}`;
  // Waits are to the whole second, so a real wait under half a second reads "under 1", never "0".
  const total = b.personSeconds === 0 ? "under 1 person-second" : `${b.personSeconds.toLocaleString("en-US")} person-seconds`;
  const most = b.mostWaitedS === 0 ? "under 1 s" : seconds(b.mostWaitedS);
  return (
    `${people(b.waiters)} waited to get into or along it, up to ${b.peakQueue.toLocaleString("en-US")} at once, ` +
    `${total} in all. ` +
    `The most any one person waited, every stop added together, was ${most}. ` +
    `${b.throughput.toLocaleString("en-US")} of ${headcount.toLocaleString("en-US")} pass through it.`
  );
}

/** "3 people" when the whole room leaves by the post's door; "21 of 42 people" when only some of it does. */
export function wardenCount(post: DrillReport["wardenPosts"][number]): string {
  const noun = post.occupants === 1 ? "person" : "people";
  return post.people === post.occupants ? `${post.people} ${noun}` : `${post.people} of ${post.occupants} ${noun}`;
}

/** "2 in Suite 502: no open stair is reachable from their room", one line per room and reason. */
export function strandedLines(report: DrillReport): string[] {
  const rooms = new Map(report.zones.map((z) => [z.roomId, z.label]));
  const groups = new Map<string, number>();
  for (const s of report.stranded) {
    const where = s.roomId ? `in ${rooms.get(s.roomId) ?? s.roomId}` : "with no room to stand in";
    const key = `${where}: ${s.reason}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups].map(([key, n]) => `${n} ${key}`);
}
