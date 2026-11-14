// The dossier's replay of the Level Builder's recorded trace (SPEC §2 beat 3):
// when each trace event, and each block of the dossier, appears over about
// six seconds. The recorded run took a fraction of a second on fixtures, so
// the replay spaces its moments evenly instead of keeping the recorded gaps.
//
// Pure: the screen asks what is shown at `elapsed` ms, so a test can too.
import type { BuildTrace, BuildTraceEvent } from "@/domain";

/** When the first trace moment shows. */
export const REPLAY_START_MS = 400;
/** From the first trace moment to the last. */
export const REPLAY_TRACE_MS = 5000;
/** How long after its source tool call a block fills. */
export const BLOCK_LAG_MS = 250;
/** Between one table row and the next. */
export const ROW_STEP_MS = 150;

export interface ReplaySchedule {
  /** When each trace event shows, by index into `trace.events`. */
  events: number[];
  /** When the CoStar facts fill: as `get_building` returns. */
  facts: number;
  /** When each Data → Level row fills: from `derive_security_profile`, one after another. */
  rows: number[];
  /** When the briefing fills: as `write_manifest` returns. */
  briefing: number;
  /** When everything has shown. */
  end: number;
}

/**
 * The replay's timing. Events recorded at the same moment (one `write_todos`
 * update, say) show together; each distinct moment gets an equal slot.
 */
export function replaySchedule(trace: BuildTrace, rowCount: number): ReplaySchedule {
  const moments = [...new Set(trace.events.map((e) => e.atMs))].sort((a, b) => a - b);
  const step = moments.length > 1 ? REPLAY_TRACE_MS / (moments.length - 1) : 0;
  const at = (atMs: number) => REPLAY_START_MS + moments.indexOf(atMs) * step;
  const events = trace.events.map((e) => at(e.atMs));
  const last = REPLAY_START_MS + REPLAY_TRACE_MS;

  // Each block fills when the tool that produced its data returns, or at a
  // fixed share of the replay when the trace has no such call.
  const after = (tool: string, share: number) => {
    const i = trace.events.findIndex((e) => e.kind === "tool" && e.label === tool);
    return (i >= 0 ? events[i] : REPLAY_START_MS + REPLAY_TRACE_MS * share) + BLOCK_LAG_MS;
  };
  const facts = after("get_building", 0.15);
  const firstRow = after("derive_security_profile", 0.45);
  const rows = Array.from({ length: rowCount }, (_, i) => firstRow + i * ROW_STEP_MS);
  const briefing = after("write_manifest", 0.85);
  const end = Math.max(last, facts, briefing, ...rows, ...events);
  return { events, facts, rows, briefing, end };
}

export type TodoStatus = BuildTraceEvent["status"];

export interface TodoView {
  label: string;
  /** Its latest status so far; null until its first write shows. */
  status: TodoStatus | null;
}

export interface StepView {
  /** Index into `trace.events`. */
  index: number;
  kind: "subagent" | "tool";
  agent: BuildTraceEvent["agent"];
  label: string;
  /** False until the replay reaches it: the row is laid out, under a skeleton. */
  shown: boolean;
  /** Running until the replay moves past it, then the recorded status. */
  status: TodoStatus;
  durationMs?: number;
  /** The recorded input and output, shown when the row is expanded. */
  input?: string;
  output?: string;
  /** 1 for a tool a subagent called, under its task. */
  depth: 0 | 1;
}

export interface TraceView {
  /** The plan: each todo once, in the order it was first written. */
  todos: TodoView[];
  /** Every subagent task and tool call, in order, each shown or not yet. */
  steps: StepView[];
}

/**
 * What the trace shows once the events `shown` accepts have played. Every
 * row is listed from the start, so the list never changes height.
 */
export function traceView(trace: BuildTrace, shown: (index: number) => boolean): TraceView {
  const todos = new Map<string, TodoStatus | null>();
  const steps: StepView[] = [];

  trace.events.forEach((event, index) => {
    const visible = shown(index);
    if (event.kind === "todo") {
      if (!todos.has(event.label)) todos.set(event.label, null);
      if (visible) todos.set(event.label, event.status);
      return;
    }
    steps.push({
      index,
      kind: event.kind,
      agent: event.agent,
      label: event.label,
      shown: visible,
      status: event.status,
      durationMs: event.durationMs,
      input: event.input,
      output: event.output,
      depth: event.kind === "tool" && event.agent !== "level-builder" ? 1 : 0,
    });
  });

  // A subagent task is running while its own tool calls are still playing:
  // it settles when a later event from another agent has shown.
  for (const step of steps) {
    if (step.kind !== "subagent" || !step.shown) continue;
    const later = trace.events.findIndex((e, i) => i > step.index && e.agent !== step.agent);
    if (!shown(later >= 0 ? later : trace.events.length - 1)) step.status = "in_progress";
  }

  return { todos: [...todos].map(([label, status]) => ({ label, status })), steps };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 13, 2026, 11:39 UTC": by hand, in UTC, so the server and the browser agree. */
export function formatRecordedAt(iso: string | undefined): string {
  if (!iso) return "time not recorded";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "time not recorded";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/**
 * The TraceList's header line (#17, R1-M2, R1-M5): "Recorded replay ·
 * <timestamp> · model turns: <what produced them>". The screen replays; the
 * model label says whose turns were recorded.
 */
export function recordedRunHeader(trace: Pick<BuildTrace, "recordedAt" | "model">): string {
  return ["Recorded replay", formatRecordedAt(trace.recordedAt), `model turns: ${trace.model ?? "not recorded"}`].join(" · ");
}

/** "3 ms", "1.2 s". */
export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}
