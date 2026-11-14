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
// A tool that throws is answered with an error ToolMessage instead of ending
// the run, so a live model sees what went wrong and can call again.
//
// The same middleware also keeps every model turn (`turns`): what each agent
// was asked and what it answered. `npm run record:builds` saves them as a
// ScriptedChatModel script (record.ts).
import { type BaseMessage, type MessageContent, ToolMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";
import type { BuilderAgent, BuildTrace, BuildTraceEvent } from "@/domain";

interface TodoArg {
  content?: unknown;
  status?: unknown;
}

const TODO_STATUSES = new Set(["pending", "in_progress", "completed"]);

export interface TraceRecorderOptions {
  /** The clock, in milliseconds. Tests pass a fake one. */
  now?: () => number;
}

/** One model call, in the order the calls returned. */
export interface RecordedTurn {
  agent: BuilderAgent;
  /** The task message the agent was answering: the user's request, or the subagent's task. */
  task: string;
  content: string;
  toolCalls: { name: string; args: Record<string, unknown> }[];
}

export class TraceRecorder {
  readonly events: BuildTraceEvent[] = [];
  readonly turns: RecordedTurn[] = [];
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
  todos(agent: BuilderAgent, todos: unknown): void {
    if (!Array.isArray(todos)) return;
    const atMs = this.elapsed();
    for (const todo of todos as TodoArg[]) {
      if (typeof todo?.content !== "string" || todo.content === "") continue;
      const status = TODO_STATUSES.has(String(todo.status)) ? (todo.status as BuildTraceEvent["status"]) : "pending";
      this.events.push({ atMs, kind: "todo", agent, label: todo.content, status });
    }
  }

  /** Starts a timed event; the returned function ends it. */
  start(kind: "subagent" | "tool", agent: BuilderAgent, label: string): (ok: boolean) => void {
    const startMs = this.now();
    const event: BuildTraceEvent = { atMs: this.elapsed(), kind, agent, label, status: "in_progress" };
    this.events.push(event);
    return (ok) => {
      event.status = ok ? "completed" : "failed";
      event.durationMs = Math.max(0, Math.round(this.now() - startMs));
    };
  }

  /** The middleware that records `agent`'s tool calls. */
  middleware(agent: BuilderAgent) {
    return createMiddleware({
      name: "BuildTraceMiddleware",
      wrapModelCall: async (request, handler) => {
        const response = await handler(request);
        this.turns.push({
          agent,
          task: lastTask(request.messages),
          content: text(response.content),
          toolCalls: (response.tool_calls ?? []).map(({ name, args }) => ({ name, args: { ...args } })),
        });
        return response;
      },
      wrapToolCall: async (request, handler) => {
        const { name, args, id } = request.toolCall;
        if (name === "write_todos") {
          this.todos(agent, (args as { todos?: unknown }).todos);
          return handler(request);
        }
        const end =
          name === "task"
            ? this.start("subagent", subagentName(args), describeTask(args))
            : this.start("tool", agent, name);
        try {
          const result = await handler(request);
          end(!(ToolMessage.isInstance(result) && result.status === "error"));
          return result;
        } catch (error) {
          end(false);
          const message = error instanceof Error ? error.message : String(error);
          return new ToolMessage({ content: `Error: ${message}`, tool_call_id: id ?? name, name, status: "error" });
        }
      },
    });
  }

  /** The trace as the dossier reads it, in the order events started. */
  toTrace(buildingId: string, extra: Pick<BuildTrace, "recordedAt" | "model"> = {}): BuildTrace {
    const events = this.events
      .map((event, i) => ({ event, i }))
      .sort((a, b) => a.event.atMs - b.event.atMs || a.i - b.i)
      .map(({ event }) => ({ ...event }));
    return { buildingId, ...extra, events };
  }
}

/** The text blocks of a message, joined. */
function text(content: MessageContent): string {
  if (typeof content === "string") return content;
  return content
    .map((block) => (block.type === "text" && typeof block.text === "string" ? block.text : ""))
    .join("\n");
}

/** The last human message: what the agent is working on. */
function lastTask(messages: BaseMessage[]): string {
  const human = messages.filter((m) => m.getType() === "human").at(-1);
  return human ? text(human.content) : "";
}

function subagentName(args: Record<string, unknown>): BuilderAgent {
  const name = args.subagent_type;
  return name === "data-analyst" || name === "game-master" ? name : "level-builder";
}

function describeTask(args: Record<string, unknown>): string {
  const description = typeof args.description === "string" ? args.description.trim() : "";
  const name = typeof args.subagent_type === "string" ? args.subagent_type : "subagent";
  return description || `Run ${name}`;
}
