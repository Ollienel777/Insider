// The Level Builder's trace recorder (SPEC §4.4): what the dossier replays in
// beat 3. Each agent in the deep agent (the builder and its two subagents)
// gets this recorder's middleware, which wraps every tool call that agent
// makes, so the trace is read from the calls the graph really executed:
//
// - `write_todos` becomes one `todo` event per todo in the list it wrote;
// - `task` becomes a `subagent` event, named for the subagent it dispatched,
//   timed from dispatch to that subagent's final answer;
// - any other tool becomes a `tool` event, timed, `failed` if it threw.
//
// Subagent and tool events keep what went in (the task's brief, the tool's
// arguments as JSON) and what came back (the answer, the tool's result or its
// error), each cut to TRACE_TEXT_MAX characters, so the dossier can show them.
// A run on live CoStar or Vexcel data records neither (`recordPayloads:
// false`), and no model-written text either: todos become "Step 2 of 3" and
// tasks "Run <subagent>", since the model writes them from that data.
// Nothing derived from a kit record is ever committed (SPEC §4.5).
//
// A tool that throws is answered with an error ToolMessage instead of ending
// the run, so a live model sees what went wrong and can call again.
import { ToolMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";
import { BuilderAgent, type BuildTrace, type BuildTraceEvent } from "@/domain";

interface TodoArg {
  content?: unknown;
  status?: unknown;
}

const TODO_STATUSES = new Set(["pending", "in_progress", "completed"]);

/** The most characters of a recorded input or output the trace keeps. */
export const TRACE_TEXT_MAX = 2000;

/** `text` cut to TRACE_TEXT_MAX characters, saying how many it dropped; undefined if empty. */
export function traceText(text: string): string | undefined {
  if (text === "") return undefined;
  if (text.length <= TRACE_TEXT_MAX) return text;
  return `${text.slice(0, TRACE_TEXT_MAX)}… [${text.length - TRACE_TEXT_MAX} more characters not recorded]`;
}

export interface TraceRecorderOptions {
  /** The clock, in milliseconds. Tests pass a fake one. */
  now?: () => number;
  /** False when live data served the run: events then keep no input or output. Defaults to true. */
  recordPayloads?: boolean;
}

export class TraceRecorder {
  readonly events: BuildTraceEvent[] = [];
  private readonly now: () => number;
  private readonly startedAt: number;
  private readonly recordPayloads: boolean;

  constructor(options: TraceRecorderOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.recordPayloads = options.recordPayloads ?? true;
    this.startedAt = this.now();
  }

  private elapsed(): number {
    return Math.max(0, Math.round(this.now() - this.startedAt));
  }

  /** Records the todo list one `write_todos` call wrote. */
  todos(agent: BuilderAgent, todos: unknown): void {
    if (!Array.isArray(todos)) return;
    const atMs = this.elapsed();
    const written = (todos as TodoArg[]).filter((todo) => typeof todo?.content === "string" && todo.content !== "");
    written.forEach((todo, i) => {
      const status = TODO_STATUSES.has(String(todo.status)) ? (todo.status as BuildTraceEvent["status"]) : "pending";
      const label = this.recordPayloads ? (todo.content as string) : `Step ${i + 1} of ${written.length}`;
      this.events.push({ atMs, kind: "todo", agent, label, status });
    });
  }

  /** Starts a timed event with what went in; the returned function ends it with what came back. */
  start(
    kind: "subagent" | "tool",
    agent: BuilderAgent,
    label: string,
    input?: string,
  ): (ok: boolean, output?: string, failure?: BuildTraceEvent["failure"]) => void {
    const startMs = this.now();
    const event: BuildTraceEvent = { atMs: this.elapsed(), kind, agent, label, status: "in_progress" };
    const recordedInput = input === undefined || !this.recordPayloads ? undefined : traceText(input);
    if (recordedInput !== undefined) event.input = recordedInput;
    this.events.push(event);
    return (ok, output, failure) => {
      event.status = ok ? "completed" : "failed";
      event.durationMs = Math.max(0, Math.round(this.now() - startMs));
      if (!ok && failure) event.failure = failure;
      const recordedOutput = output === undefined || !this.recordPayloads ? undefined : traceText(output);
      if (recordedOutput !== undefined) event.output = recordedOutput;
    };
  }

  /** The middleware that records `agent`'s tool calls. */
  middleware(agent: BuilderAgent) {
    return createMiddleware({
      name: "BuildTraceMiddleware",
      wrapToolCall: async (request, handler) => {
        const { name, args, id } = request.toolCall;
        if (name === "write_todos") {
          this.todos(agent, (args as { todos?: unknown }).todos);
          return handler(request);
        }
        const end =
          name === "task"
            ? this.start("subagent", subagentName(args), this.recordPayloads ? describeTask(args) : runLabel(args), describeTask(args))
            : this.start("tool", agent, name, JSON.stringify(args, null, 2));
        try {
          const result = await handler(request);
          // deepagents' `task` throws when the subagent's run fails, so an
          // error result here is a call that returned an error, not a failed run.
          const message = toolMessageOf(result);
          const ok = message?.status !== "error";
          end(ok, message ? contentText(message.content) : undefined, ok ? undefined : "returned");
          return result;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          // A `task` that throws is the subagent's whole run failing, not one tool's error (R1-M1).
          const content = name === "task" ? `Error: the ${String(args.subagent_type)} subagent's run failed: ${message}` : `Error: ${message}`;
          end(false, content, "thrown");
          return new ToolMessage({ content, tool_call_id: id ?? name, name, status: "error" });
        }
      },
    });
  }

  /** The trace as the dossier reads it, in the order events started. */
  toTrace(buildingId: string, extra: Pick<BuildTrace, "recordedAt" | "model" | "liveData" | "subagents"> = {}): BuildTrace {
    const events = this.events
      .map((event, i) => ({ event, i }))
      .sort((a, b) => a.event.atMs - b.event.atMs || a.i - b.i)
      .map(({ event }) => ({ ...event }));
    return { buildingId, ...extra, events };
  }
}

/** The subagent a `task` dispatched; an unknown name falls back to the builder itself. */
function subagentName(args: Record<string, unknown>): BuilderAgent {
  const parsed = BuilderAgent.safeParse(args.subagent_type);
  return parsed.success && parsed.data !== "level-builder" ? parsed.data : "level-builder";
}

/** The ToolMessage a tool answered with: itself, or the last one in a `task`'s Command update. */
function toolMessageOf(result: unknown): ToolMessage | undefined {
  if (ToolMessage.isInstance(result)) return result;
  const messages = (result as { update?: { messages?: unknown } } | undefined)?.update?.messages;
  return Array.isArray(messages) ? messages.findLast((m): m is ToolMessage => ToolMessage.isInstance(m)) : undefined;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  return JSON.stringify(content, null, 2) ?? "";
}

/** A task's label on live data: the subagent's name only, if it is one the builder has. */
function runLabel(args: Record<string, unknown>): string {
  const parsed = BuilderAgent.safeParse(args.subagent_type);
  return parsed.success && parsed.data !== "level-builder" ? `Run ${parsed.data}` : "Run a subagent";
}

function describeTask(args: Record<string, unknown>): string {
  const description = typeof args.description === "string" ? args.description.trim() : "";
  const name = typeof args.subagent_type === "string" ? args.subagent_type : "subagent";
  return description || `Run ${name}`;
}
