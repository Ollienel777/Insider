import { AlertTriangle, Check, CircleSlash, Info } from "lucide-react";
import type { GhostPlan } from "@/components/run/board-view";
import type { CheckedPlan } from "@/level/validate-plan";
import { cn } from "@/lib/utils";
import type { CrewAnswer } from "./crew-request";

/** The board's ghost: the plan's path, a ring where it is seen, and the advice's waits. */
export function ghostOf(checked: CheckedPlan): GhostPlan {
  const marks: GhostPlan["marks"][number][] = checked.warnings
    .filter((w) => w.by !== null)
    .map((w) => ({ nodeId: w.nodeId, kind: "sighting" as const, label: `${w.by} · T${w.turn}` }));
  for (const wait of checked.advice?.waits ?? []) {
    marks.push({ nodeId: wait.nodeId, kind: "wait", label: `WAIT · T${wait.turn}` });
  }
  return { path: checked.path, marks };
}

const REASON: Record<NonNullable<CrewAnswer["reason"]>, string> = {
  "fake mode": "Fake mode: no model was called. This is a recorded crew reply.",
  configuration: "No model was called: a setting refuses live calls. This is a recorded crew reply.",
  timeout: "The model didn't answer within the time limit, so a recorded crew reply stands in.",
  error: "The model call failed, so a recorded crew reply stands in.",
};

/** Why the plan was worked out on the board: the model gave no reply, and this building has no recording to stand in. */
const NO_RECORDING = "This building has no recorded crew reply to stand in, so this plan was worked out from the board itself.";
const BOARD_REASON: Record<NonNullable<CrewAnswer["reason"]>, string> = {
  "fake mode": `Fake mode: no model was called. ${NO_RECORDING}`,
  configuration: `No model was called: a setting refuses live calls. ${NO_RECORDING}`,
  timeout: `The model didn't answer within the time limit. ${NO_RECORDING}`,
  error: `The model call failed. ${NO_RECORDING}`,
};

/** The "Worked out on the board" chip's tooltip, for the reason the model gave no reply. */
export function boardPlanTitle(reason: CrewAnswer["reason"]): string {
  return reason ? BOARD_REASON[reason] : `The crew gave no reply. ${NO_RECORDING}`;
}

/**
 * The crew's answer in the Plan panel (DESIGN.md, Plan): the numbered steps,
 * any step dropped because its zone is not on the board, the warning the
 * board found, the crew's own pushback, and the quiet route's waits.
 */
export function CrewReply({ answer, checked }: { answer: CrewAnswer; checked: CheckedPlan }) {
  const { plan } = answer;
  const warning = checked.warnings[0];
  return (
    <section aria-labelledby="crew-plan-label" data-testid="crew-reply" data-outcome={checked.outcome} className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h2 id="crew-plan-label" className="label-caps text-text-3">
          The crew&apos;s plan
        </h2>
        {answer.recorded ? (
          <span
            data-testid="recorded-chip"
            title={answer.reason ? REASON[answer.reason] : "A recorded crew reply."}
            className="rounded-sm border border-border px-1.5 py-0.5 label-caps text-text-2"
          >
            Recorded
          </span>
        ) : answer.source === "board" ? (
          <span
            data-testid="board-plan-chip"
            title={boardPlanTitle(answer.reason)}
            className="rounded-sm border border-border px-1.5 py-0.5 label-caps text-text-2"
          >
            Worked out on the board
          </span>
        ) : null}
        <span className="ml-auto font-mono text-xs text-text-2" title="The crew's confidence in this plan">
          {Math.round(plan.confidence * 100)}% sure
        </span>
      </div>

      <ol data-testid="crew-steps" className="flex flex-col">
        {plan.steps.map((step, i) => {
          const number = i + 1;
          const kept = checked.steps.find((s) => s.number === number);
          const dropped = checked.dropped.find((d) => d.number === number);
          return (
            <li
              key={number}
              data-testid="crew-step"
              data-zone={step.zoneId}
              data-dropped={dropped ? "true" : undefined}
              className="grid grid-cols-[20px_minmax(0,1fr)] gap-x-2 border-b border-border py-2 text-sm last:border-b-0"
            >
              <span className="font-mono text-xs leading-5 text-text-3">{number}</span>
              <span className={cn("min-w-0", dropped ? "text-text-2 line-through decoration-n-500" : "text-text-1")}>
                {step.action}
              </span>
              <span className="col-start-2 mt-0.5 flex flex-wrap items-baseline gap-x-2 font-mono text-xs text-text-2">
                <span className="uppercase tracking-label">{kept?.zone ?? step.zoneId}</span>
                {kept?.turns ? (
                  <span>{kept.turns.from === kept.turns.to ? `turn ${kept.turns.from}` : `turns ${kept.turns.from}–${kept.turns.to}`}</span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>

      {checked.dropped.length > 0 ? (
        <ul data-testid="dropped-steps" className="flex flex-col gap-1">
          {checked.dropped.map((d) => (
            <li key={d.number} className="flex items-start gap-2 text-sm text-text-2">
              <CircleSlash aria-hidden className="mt-0.5 size-4 shrink-0 stroke-[1.5]" />
              <span>
                Dropped step {d.number}: {d.reason}.
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {checked.startNote ? (
        <p data-testid="plan-start-note" role="note" className="flex items-start gap-2 text-sm text-text-2">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 stroke-[1.5]" />
          <span>{checked.startNote}</span>
        </p>
      ) : null}

      {warning ? (
        <div
          data-testid="plan-warning"
          data-by={warning.by ?? undefined}
          data-turn={warning.turn}
          role="note"
          className="flex flex-col gap-1 rounded-r-sm border-l-2 border-warning bg-surface-2 py-3 pr-4 pl-3"
        >
          <p className="flex items-center gap-2 label-caps text-warning">
            <AlertTriangle aria-hidden className="size-4 stroke-[1.5]" />
            Checked on the board
          </p>
          <p className="text-sm text-text-1">{warning.text}</p>
        </div>
      ) : (
        <div
          data-testid="plan-clean"
          role="note"
          className="flex items-center gap-2 rounded-r-sm border-l-2 border-success bg-surface-2 py-3 pr-4 pl-3 text-sm text-text-1"
        >
          <Check aria-hidden className="size-4 shrink-0 stroke-[1.5] text-success" />
          Checked on the board: nobody sees you, out in {checked.actions.length} turns.
        </div>
      )}

      {plan.pushback ? (
        <div className="flex flex-col gap-1">
          <p className="label-caps text-text-3">The crew pushes back</p>
          <p data-testid="crew-pushback" className="text-base text-text-1">
            {plan.pushback}
          </p>
        </div>
      ) : null}

      {checked.advice ? (
        <div data-testid="plan-advice" className="flex flex-col gap-2">
          <p className="label-caps text-text-3">The quiet way</p>
          <ol className="flex flex-col gap-2">
            {checked.advice.waits.map((wait) => (
              <li key={wait.turn} data-testid="advice-wait" data-outbound={wait.outbound} className="text-sm text-text-1">
                {wait.text}
              </li>
            ))}
          </ol>
          <p className="text-sm text-text-2">{checked.advice.summary}</p>
        </div>
      ) : checked.noQuietRoute ? (
        <p data-testid="plan-no-quiet-route" className="text-sm text-text-2">
          No way through this floor stays unseen. The risk is where the board says above.
        </p>
      ) : null}
    </section>
  );
}
