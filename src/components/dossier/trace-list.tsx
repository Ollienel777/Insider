import { Circle, CircleCheck, CircleDashed, CircleX, GitBranch, LoaderCircle, Wrench } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatDuration, type StepView, type TodoStatus, type TraceView } from "./replay";
import { Reveal } from "./reveal";

interface TraceListProps {
  view: TraceView;
  /** "Recorded run · <timestamp> · <model>" (#17, R1-M2). */
  header: string;
  /** Skip or Replay, beside the header. */
  control: ReactNode;
  /** The agent whose run this is. */
  title?: string;
  /** The one line that says what this replay is and is not. */
  notice?: string;
  /** Shown between the plan and the subagents and tools (the cast screen's funnel). */
  afterPlan?: ReactNode;
}

/** The dossier's notice: its trace was recorded on fixtures, and replays without a model. */
export const FIXTURE_REPLAY_NOTICE = "A replay of a run recorded on fixtures. Nothing on this screen calls a model.";

/**
 * The Level Builder's run as the dossier replays it (DESIGN.md, Dossier): the
 * plan's todos tick, subagent tasks indent their own tool calls, and tool
 * calls read in mono with their recorded duration. Every row is laid out
 * from the start under a skeleton, so the list holds its height.
 */
export function TraceList({
  view,
  header,
  control,
  title = "Level Builder",
  notice = FIXTURE_REPLAY_NOTICE,
  afterPlan,
}: TraceListProps) {
  return (
    <section aria-labelledby="trace-title" data-testid="trace-list" className="flex flex-col gap-4">
      <div>
        <div className="flex items-center justify-between gap-3">
          <h2 id="trace-title" className="text-lg font-semibold text-text-1">
            {title}
          </h2>
          {control}
        </div>
        <p data-testid="trace-header" className="font-mono text-xs text-text-2">
            {/* Each part keeps together, so a line breaks only between parts. */}
            {header.split(" · ").map((part, i, parts) => (
              <Fragment key={part}>
                <span className={part.length > 40 ? "break-words" : "whitespace-nowrap"}>
                  {part}
                  {i < parts.length - 1 ? " ·" : null}
                </span>
                {i < parts.length - 1 ? " " : null}
              </Fragment>
            ))}
          </p>
      </div>
      <p data-testid="replay-notice" className="rounded-sm border border-border bg-surface-2 px-3 py-2 text-sm text-text-2">
        {notice}
      </p>

      <div>
        <h3 className="label-caps text-text-3">Plan</h3>
        <ol aria-label="Plan" className="mt-2 flex flex-col">
          {view.todos.map((todo) => (
            <li
              key={todo.label}
              data-testid="trace-todo"
              data-status={todo.status ?? "unseen"}
              className="py-1.5 text-sm"
            >
              <Reveal shown={todo.status !== null} skeleton="bar">
                <span className="flex gap-2">
                  <TodoIcon status={todo.status ?? "pending"} />
                  <span className={todo.status === "completed" ? "text-text-2" : "text-text-1"}>{todo.label}</span>
                </span>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>

      {afterPlan}

      <div>
        <h3 className="label-caps text-text-3">Subagents and tools</h3>
        <ol aria-label="Subagents and tools" className="mt-2 flex flex-col">
          {view.steps.map((step) => (
            <StepRow key={step.index} step={step} />
          ))}
        </ol>
      </div>
    </section>
  );
}

const ICON = "mt-0.5 size-4 shrink-0 stroke-[1.5]";

function TodoIcon({ status }: { status: TodoStatus }) {
  switch (status) {
    case "completed":
      return <CircleCheck aria-label="done" className={cn(ICON, "text-success")} />;
    case "in_progress":
      return <CircleDashed aria-label="in progress" className={cn(ICON, "text-accent")} />;
    case "failed":
      return <CircleX aria-label="failed" className={cn(ICON, "text-danger")} />;
    default:
      return <Circle aria-label="to do" className={cn(ICON, "text-text-3")} />;
  }
}

function StepRow({ step }: { step: StepView }) {
  const running = step.status === "in_progress";
  const failed = step.status === "failed";
  if (step.kind === "subagent") {
    return (
      <li data-testid="trace-step" data-kind="subagent" data-shown={step.shown} data-status={step.status} className="py-1.5 text-sm">
        <Reveal shown={step.shown}>
        <div className="flex gap-2">
        {running ? (
          <LoaderCircle aria-label="running" className={cn(ICON, "animate-spin text-accent")} />
        ) : (
          <GitBranch aria-label="subagent task" className={cn(ICON, failed ? "text-danger" : "text-text-2")} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-text-1">
              <span className="text-text-2">task</span> {step.agent}
            </span>
            <Duration step={step} />
          </div>
          <p className="mt-0.5 line-clamp-2 text-text-2" title={step.label}>
            {step.label}
          </p>
        </div>
        </div>
        </Reveal>
      </li>
    );
  }
  return (
    <li
      data-testid="trace-step"
      data-kind="tool"
      data-shown={step.shown}
      data-status={step.status}
      className={cn("py-1.5 text-sm", step.depth === 1 && "pl-6")}
    >
      <Reveal shown={step.shown} skeleton="bar">
      <span className="flex items-center gap-2">
      <Wrench aria-hidden className={cn("size-4 shrink-0 stroke-[1.5]", failed ? "text-danger" : "text-text-3")} />
      <span className="min-w-0 flex-1 truncate font-mono text-text-1">{step.label}</span>
      <Duration step={step} />
      </span>
      </Reveal>
    </li>
  );
}

function Duration({ step }: { step: StepView }) {
  if (step.status === "in_progress") return <span className="font-mono text-xs text-text-2">running</span>;
  if (step.durationMs === undefined) return null;
  return <span className="shrink-0 font-mono text-xs text-text-2 tabular-nums">{formatDuration(step.durationMs)}</span>;
}
