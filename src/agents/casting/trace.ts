// The Casting Director's trace recorder (SPEC §4.4): what the cast screen
// replays in beat 2. Each agent in the deep agent (the director and its
// subagents) gets this recorder's middleware, which wraps every tool call
// that agent makes, so the trace is read from the calls the graph really
// executed:
//
// - `write_todos` becomes one `todo` event per todo in the list it wrote;
// - `task` becomes a `subagent` event, named for the subagent it dispatched,
//   timed from dispatch to that subagent's final answer;
// - any other tool becomes a `tool` event, timed, `failed` if it threw.
//
// Each tool and task event also keeps its input (the arguments, or the
// task's brief) and its output (the result, or the subagent's answer), cut
// to TRACE_TEXT_MAX characters. `toTrace` drops them, and every label the
// model wrote, when the run read data that is not the fixtures (SPEC §4.5).
//
// A tool that throws is answered with an error ToolMessage instead of ending
// the run, so a live model sees what went wrong and can call again.
import { ToolMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";
import type { CastingAgent, CastingTrace, CastingTraceEvent } from "@/domain";

interface TodoArg {
  content?: unknown;
  status?: unknown;
}

const TODO_STATUSES = new Set(["pending", "in_progress", "completed"]);

export const TRACE_TEXT_MAX = 2_000;

/** `value` as text, cut to TRACE_TEXT_MAX characters with the cut marked. */
export function traceText(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined) return "";
  if (text.length <= TRACE_TEXT_MAX) return text;
  return `${text.slice(0, TRACE_TEXT_MAX)}… [${text.length - TRACE_TEXT_MAX} more characters not recorded]`;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((b) => (b && typeof b === "object" && "text" in b ? String(b.text) : "")).join("\n");
  }
  return traceText(content);
}

/** A tool's answer as text: a ToolMessage's content, or the last message a Command (deepagents' `task`) carries. */
function resultText(result: unknown): string {
  if (ToolMessage.isInstance(result)) return contentText(result.content);
  const messages = (result as { update?: { messages?: unknown } } | undefined)?.update?.messages;
  if (Array.isArray(messages) && messages.length > 0) {
    return contentText((messages.at(-1) as { content?: unknown }).content);
  }
  return "";
}

export interface TraceRecorderOptions {
  /** The clock, in milliseconds. Tests pass a fake one. */
  now?: () => number;
}

export class CastingTraceRecorder {
  readonly events: CastingTraceEvent[] = [];
  private readonly now: () => number;
  private readonly startedAt: number;

  constructor(options: TraceRecorderOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.startedAt = this.now();
  }

  private elapsed(): number {
    return Math.max(0, Math.round(this.now() - this.startedAt));
  }

  /** Records the todo list one `write_todos` call wrote. */
  todos(agent: CastingAgent, todos: unknown): void {
    if (!Array.isArray(todos)) return;
    const atMs = this.elapsed();
    for (const todo of todos as TodoArg[]) {
      if (typeof todo?.content !== "string" || todo.content === "") continue;
      const status = TODO_STATUSES.has(String(todo.status)) ? (todo.status as CastingTraceEvent["status"]) : "pending";
      this.events.push({ atMs, kind: "todo", agent, label: todo.content, status });
    }
  }

  /** Starts a timed event; the returned function ends it with its output. */
  start(
    kind: "subagent" | "tool",
    agent: CastingAgent,
    label: string,
    input: unknown,
  ): (ok: boolean, output: string) => void {
    const startMs = this.now();
    const event: CastingTraceEvent = {
      atMs: this.elapsed(),
      kind,
      agent,
      label,
      status: "in_progress",
      input: traceText(input),
    };
    this.events.push(event);
    return (ok, output) => {
      event.status = ok ? "completed" : "failed";
      event.durationMs = Math.max(0, Math.round(this.now() - startMs));
      event.output = traceText(output);
    };
  }

  /** The middleware that records `agent`'s tool calls. */
  middleware(agent: CastingAgent) {
    return createMiddleware({
      name: "CastingTraceMiddleware",
      wrapToolCall: async (request, handler) => {
        const { name, args, id } = request.toolCall;
        if (name === "write_todos") {
          this.todos(agent, (args as { todos?: unknown }).todos);
          return handler(request);
        }
        const end =
          name === "task"
            ? this.start("subagent", subagentName(args), describeTask(args), args.description ?? "")
            : this.start("tool", agent, name, args);
        try {
          const result = await handler(request);
          end(!(ToolMessage.isInstance(result) && result.status === "error"), resultText(result));
          return result;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          end(false, `Error: ${message}`);
          return new ToolMessage({ content: `Error: ${message}`, tool_call_id: id ?? name, name, status: "error" });
        }
      },
    });
  }

  /**
   * The trace as the cast screen reads it, in the order events started. With
   * `liveData`, it holds no inputs or outputs and no label the model wrote:
   * todos read "Todo N" and tasks "task <subagent>"; tool names stay.
   */
  toTrace(extra: Pick<CastingTrace, "recordedAt" | "model" | "subagents"> & { liveData: boolean }): CastingTrace {
    let todo = 0;
    const events = this.events
      .map((event, i) => ({ event, i }))
      .sort((a, b) => a.event.atMs - b.event.atMs || a.i - b.i)
      .map(({ event }): CastingTraceEvent => {
        if (!extra.liveData) return { ...event };
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { input, output, ...kept } = event;
        if (event.kind === "todo") return { ...kept, label: `Todo ${++todo}` };
        if (event.kind === "subagent") return { ...kept, label: `task ${event.agent}` };
        return kept;
      });
    return { ...extra, events };
  }
}

function subagentName(args: Record<string, unknown>): CastingAgent {
  const name = args.subagent_type;
  return name === "location-scout" || name === "general-purpose" ? name : "casting-director";
}

function describeTask(args: Record<string, unknown>): string {
  const description = typeof args.description === "string" ? args.description.trim() : "";
  const name = typeof args.subagent_type === "string" ? args.subagent_type : "subagent";
  return description.split("\n")[0] || `Run ${name}`;
}
