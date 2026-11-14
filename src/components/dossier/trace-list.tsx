import { ChevronDown, Circle, CircleCheck, CircleDashed, CircleX, GitBranch, LoaderCircle, Wrench } from "lucide-react";
import { Fragment, useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatDuration, type StepView, type TodoStatus, type TraceView } from "./replay";
import { Reveal } from "./reveal";

interface TraceListProps {
  view: TraceView;
  /** "Recorded replay · <timestamp> · model turns: <model>" (#17, R1-M2, R1-M5). */
  header: string;
  /** Skip or Replay, beside the header. */
  control: ReactNode;
  /** What the replay is of (`traceBanner`). */
  banner: string;
  /** The subagents the builder could dispatch, as the trace recorded them. */
  subagents?: string[];
  /** The agent whose run this is. */
  title?: string;
  /** Shown between the plan and the subagents and tools (the cast screen's funnel). */
  afterPlan?: ReactNode;
  /** Let a header part over 40 characters wrap inside itself (a long model name in a narrow panel). */
  wrapLongParts?: boolean;
}

/**
 * The Level Builder's run as the dossier replays it (DESIGN.md, Dossier): the
 * plan's todos tick, subagent tasks indent their own tool calls, and tool
 * calls read in mono with their recorded duration. Every row is laid out
 * from the start under a skeleton, so the list holds its height. A shown
 * task or tool row is a button that opens what it was given and what it
 * returned, as recorded (#79).
 */
export function TraceList({
  view,
  header,
  control,
  banner,
  subagents,
  title = "Level Builder",
  afterPlan,
  wrapLongParts = false,
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
                <span className={wrapLongParts && part.length > 40 ? "break-words" : "whitespace-nowrap"}>
                  {part}
                  {i < parts.length - 1 ? " ·" : null}
                </span>
                {i < parts.length - 1 ? " " : null}
              </Fragment>
            ))}
          </p>
      </div>
      <p data-testid="trace-banner" className="rounded-sm border border-border bg-surface-2 px-3 py-2 text-sm text-text-2">
        {banner}
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
        {subagents?.length ? (
          <p data-testid="trace-subagents" className="mt-1 text-xs text-text-2">
            Available:{" "}
            {subagents.map((name, i) => (
              <Fragment key={name}>
                <span className="font-mono whitespace-nowrap text-text-1">{name}</span>
                {i < subagents.length - 1 ? " · " : null}
              </Fragment>
            ))}
          </p>
        ) : null}
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
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const running = step.status === "in_progress";
  const failed = step.status === "failed";
  const subagent = step.kind === "subagent";
  const toggle = {
    type: "button" as const,
    "aria-expanded": open,
    "aria-controls": detailId,
    "data-testid": "trace-step-toggle",
    onClick: () => setOpen((o) => !o),
    className: "flex w-full cursor-pointer gap-2 rounded-sm text-left hover:bg-surface-3",
  };
  const detail = open ? <StepDetail id={detailId} step={step} /> : null;
  if (subagent) {
    return (
      <li data-testid="trace-step" data-kind="subagent" data-shown={step.shown} data-status={step.status} className="py-1.5 text-sm">
        <Reveal shown={step.shown}>
        <button {...toggle}>
        {running ? (
          <LoaderCircle aria-label="running" className={cn(ICON, "animate-spin text-accent")} />
        ) : (
          <GitBranch aria-label="subagent task" className={cn(ICON, failed ? "text-danger" : "text-text-2")} />
        )}
        <span className="block min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-text-1">
              <span className="text-text-2">task</span> <span data-testid="trace-subagent">{step.agent}</span>
            </span>
            <span className="flex shrink-0 items-baseline gap-2">
              {failed ? (
                <span className="font-mono text-xs text-danger">{step.failure === "returned" ? "task error" : "subagent failed"}</span>
              ) : null}
              <Duration step={step} />
              <Chevron open={open} />
            </span>
          </span>
          <span className="mt-0.5 line-clamp-2 text-text-2" title={step.label}>
            {step.label}
          </span>
        </span>
        </button>
        {detail}
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
      <button {...toggle} className={cn(toggle.className, "items-center")}>
      <Wrench aria-hidden className={cn("size-4 shrink-0 stroke-[1.5]", failed ? "text-danger" : "text-text-3")} />
      <span className="min-w-0 flex-1 truncate font-mono text-text-1">{step.label}</span>
      {failed ? <span className="shrink-0 font-mono text-xs text-danger">tool error</span> : null}
      <Duration step={step} />
      <Chevron open={open} />
      </button>
      {detail}
      </Reveal>
    </li>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <ChevronDown
      aria-hidden
      className={cn("size-4 shrink-0 self-center stroke-[1.5] text-text-3 transition-transform duration-fast", open && "rotate-180")}
    />
  );
}

/**
 * What a row was given and what it returned, as the trace recorded them:
 * plain text, never HTML, each cut at record time to 2,000 characters and
 * scrolled here past 160px.
 */
export function StepDetail({ id, step }: { id: string; step: StepView }) {
  const subagent = step.kind === "subagent";
  const failed = step.status === "failed";
  let outputLabel = subagent ? "Answer" : "Output";
  if (failed && !subagent) outputLabel = "Tool error";
  else if (failed) outputLabel = step.failure === "returned" ? "Task returned an error" : "Subagent run failed";
  return (
    <div id={id} data-testid="trace-step-detail" className={cn("mt-2 flex flex-col gap-3 rounded-sm border border-border bg-surface-2 p-3", subagent && "ml-6")}>
      {step.withheld ? (
        <p className="text-xs text-text-2">Not recorded: live data stays out of the trace.</p>
      ) : (
        <>
          <RecordedText label={subagent ? "Brief" : "Input"} text={step.input} />
          <RecordedText label={outputLabel} text={step.output} danger={failed} />
        </>
      )}
    </div>
  );
}

function RecordedText({ label, text, danger = false }: { label: string; text?: string; danger?: boolean }) {
  return (
    <div>
      <p className={cn("label-caps", danger ? "text-danger" : "text-text-3")}>{label}</p>
      {text === undefined ? (
        <p className="mt-1 text-xs text-text-2">Not recorded.</p>
      ) : (
        <pre
          tabIndex={0}
          role="region"
          aria-label={label}
          className="mt-1 max-h-40 overflow-auto font-mono text-xs break-words whitespace-pre-wrap text-text-1"
        >
          <TruncatedText text={text} />
        </pre>
      )}
    </div>
  );
}

function Duration({ step }: { step: StepView }) {
  if (step.status === "in_progress") return <span className="font-mono text-xs text-text-2">running</span>;
  if (step.durationMs === undefined) return null;
  return <span className="shrink-0 font-mono text-xs text-text-2 tabular-nums">{formatDuration(step.durationMs)}</span>;
}

/** The recorder's "… [N more characters not recorded]" marker, set apart from the recorded text. */
const CUT = /… \[\d+ more characters not recorded\]$/;

function TruncatedText({ text }: { text: string }) {
  const cut = CUT.exec(text);
  if (!cut) return text;
  return (
    <>
      {text.slice(0, cut.index)}
      <span data-testid="trace-cut" className="text-text-3 italic">
        {cut[0]}
      </span>
    </>
  );
}
