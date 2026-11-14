// The key never reaches the log or a response (#30). Two ways it could:
// - a provider answers an HTTP error whose body echoes the key, and
//   structuredCall logs that message before the recorded answer stands in;
// - an agent throws an error carrying the key, and a route's 500 path puts
//   its message in the response (crew, Chief) or the log (drill narrator).
// Each route is driven down both. The key here is fake, and `fetch` is
// stubbed, so nothing here reaches the network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { FIXTURE_BUILDINGS } from "@/adapters/costar/fake";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { POST as postChief } from "@/app/api/chief/route";
import { POST as postCrew } from "@/app/api/crew/route";
import { POST as postNarrative } from "@/app/api/drill/narrative/route";
import { drillFacts, simulateDrill } from "@/drill";
import { REDACTED, redactSecrets, selectChatModel, structuredCall } from "./index";

/** When one is set, that agent throws it instead of answering, so its route's 500 path runs. */
const agentFailure = vi.hoisted(() => ({ crew: null as Error | null, chief: null as Error | null, drill: null as Error | null }));

vi.mock("@/agents/crew", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/agents/crew")>();
  return {
    ...actual,
    briefCrew: (...args: Parameters<typeof actual.briefCrew>) =>
      agentFailure.crew ? Promise.reject(agentFailure.crew) : actual.briefCrew(...args),
  };
});
vi.mock("@/agents/chief", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/agents/chief")>();
  return {
    ...actual,
    replanChief: (...args: Parameters<typeof actual.replanChief>) =>
      agentFailure.chief ? Promise.reject(agentFailure.chief) : actual.replanChief(...args),
  };
});
vi.mock("@/agents/drill", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/agents/drill")>();
  return {
    ...actual,
    narrateDrill: (...args: Parameters<typeof actual.narrateDrill>) =>
      agentFailure.drill ? Promise.reject(agentFailure.drill) : actual.narrateDrill(...args),
  };
});

const FAKE_KEY = "sk-ant-api03-FAKEKEYfortests0123456789abcdefghijklmnop-AAAA";
const OTHER_SHAPE = "sk-ant-admin01-AnotherFakeKey_9876543210";

/** Every line the app wrote to the console during a test. */
function captureConsole() {
  const lines: string[] = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    });
  }
  return lines;
}

/** A provider failure whose message carries the key, as a proxy echoing the request might. */
const leakyError = () => new Error(`401 invalid x-api-key: ${FAKE_KEY} (headers: {"x-api-key":"${FAKE_KEY}"})`);

/**
 * The HTTP answer a provider or proxy might give with the key echoed in its body. Returned, not thrown: the
 * SDK turns a thrown `fetch` into "Connection error.", which carries no key, so only a returned error
 * response puts the key in the message the app sees.
 */
const leakyProviderResponse = () =>
  new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: `invalid x-api-key ${FAKE_KEY}` } }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });

function expectNoKey(log: string, body: string) {
  for (const text of [log, body]) {
    expect(text).not.toContain(FAKE_KEY);
    expect(text).not.toMatch(/sk-ant-/);
  }
}

const crewRequest = () =>
  new Request("http://localhost/api/crew", {
    method: "POST",
    body: JSON.stringify({ buildingId: "F1", order: "Go in through the dock, wait for the 2 am round to pass, take the records room." }),
  });

const chiefRequest = () =>
  new Request("http://localhost/api/chief", {
    method: "POST",
    body: JSON.stringify({
      buildingId: "F1",
      transition: { turn: 1, from: "calm", to: "alert", cause: { kind: "camera", id: "C2" } },
      lastKnownZone: "dock-corridor",
      guards: [{ id: "G1", zoneId: "main-corridor", intent: "converge" }],
      zones: [
        { id: "objective", name: "Records room" },
        { id: "dock-corridor", name: "Dock Corridor" },
        { id: "main-corridor", name: "Main Corridor" },
      ],
    }),
  });

/** F1's default drill, which has a recorded narrative to stand in. */
function narrativeRequest() {
  const building = FIXTURE_BUILDINGS.find((b) => b.id === "F1")!;
  const floor = FIXTURE_FLOORS.F1;
  const report = simulateDrill(building, floor, { floor: "staged" });
  const baseline = simulateDrill(building, floor, { floor: "staged", blockedStair: null });
  const facts = drillFacts(report, baseline, floor);
  return new Request("http://localhost/api/drill/narrative", { method: "POST", body: JSON.stringify({ facts }) });
}

describe("redactSecrets", () => {
  it("replaces the environment's key, and anything shaped like an Anthropic key", () => {
    const env = { ANTHROPIC_API_KEY: FAKE_KEY };
    const out = redactSecrets(`a ${FAKE_KEY} b ${OTHER_SHAPE} c`, env);
    expect(out).toBe(`a ${REDACTED} b ${REDACTED} c`);
    // A key of another shape is still caught by its value.
    expect(redactSecrets("key=plain-secret-value-1234", { ANTHROPIC_API_KEY: "plain-secret-value-1234" })).toBe(`key=${REDACTED}`);
    expect(redactSecrets("nothing to hide", env)).toBe("nothing to hide");
  });
});

describe("a provider error that carries the key", () => {
  let lines: string[];
  beforeEach(() => {
    lines = captureConsole();
    for (const name of ["HEIST_MODE", "LLM_MODE", "LLM_PROVIDER", "ANTHROPIC_BASE_URL", "ANTHROPIC_API_URL"]) vi.stubEnv(name, "");
    vi.stubEnv("LLM_MODE", "live");
    vi.stubEnv("ANTHROPIC_API_KEY", FAKE_KEY);
    vi.stubEnv("LLM_TIMEOUT_MS", "2000");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("structuredCall: the recorded answer stands in, and neither the log nor the answer holds the key", async () => {
    const create = async () => {
      throw leakyError();
    };
    const selection = selectChatModel("fast", process.env, {
      createAnthropicClient: () => ({ messages: { create }, beta: { messages: { create } } }) as never,
    });
    expect(selection.mode).toBe("live");
    const answer = await structuredCall(z.object({ say: z.string() }), "hello", { fake: { say: "recorded" }, selection });
    expect(answer).toEqual({ value: { say: "recorded" }, recorded: true, reason: "error" });
    expect(lines.join("\n")).toContain("the recorded answer stands in");
    expect(lines.join("\n")).toContain(REDACTED);
    expect(lines.join("\n")).not.toContain(FAKE_KEY);
    expect(lines.join("\n")).not.toMatch(/sk-ant-/);
    expect(JSON.stringify(answer)).not.toContain(FAKE_KEY);
  });

  it.each([
    ["crew", () => postCrew(crewRequest()), "crew_plan"],
    ["chief", () => postChief(chiefRequest()), "chief_orders"],
    ["drill/narrative", () => postNarrative(narrativeRequest()), "drill_narrative"],
  ] as const)(
    "POST /api/%s, when the provider answers 401 with the key in its body: 200, recorded, and the error logged redacted",
    async (_route, post, toolName) => {
      const fetch = vi.fn(async () => leakyProviderResponse());
      vi.stubGlobal("fetch", fetch);

      const response = await post();

      expect(fetch).toHaveBeenCalled();
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(JSON.parse(text)).toMatchObject({ recorded: true, reason: "error", fallback: { service: "llm" } });
      const log = lines.join("\n");
      // The provider's message reached the log, so only redaction kept the key out of it.
      expectNoKey(log, text);
      expect(log).toContain(`structuredCall(${toolName}): the recorded answer stands in (error: 401`);
      expect(log).toContain(`invalid x-api-key ${REDACTED}`);
    },
    20_000,
  );
});

describe("a route's 500 path, on an agent error that carries the key", () => {
  let lines: string[];
  beforeEach(() => {
    lines = captureConsole();
    vi.stubEnv("ANTHROPIC_API_KEY", FAKE_KEY);
  });
  afterEach(() => {
    agentFailure.crew = agentFailure.chief = agentFailure.drill = null;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("POST /api/crew: 500, and the response names the failure with the key redacted", async () => {
    agentFailure.crew = leakyError();
    const response = await postCrew(crewRequest());
    expect(response.status).toBe(500);
    const text = await response.text();
    expectNoKey(lines.join("\n"), text);
    expect(JSON.parse(text).error).toContain(`the crew could not answer: 401 invalid x-api-key: ${REDACTED}`);
  });

  it("POST /api/chief: 500, and the response names the failure with the key redacted", async () => {
    agentFailure.chief = leakyError();
    const response = await postChief(chiefRequest());
    expect(response.status).toBe(500);
    const text = await response.text();
    expectNoKey(lines.join("\n"), text);
    expect(JSON.parse(text).error).toContain(`the Chief could not answer: 401 invalid x-api-key: ${REDACTED}`);
  });

  it("POST /api/drill/narrative: 500 with a generic message, and the log names the failure with the key redacted", async () => {
    agentFailure.drill = leakyError();
    const response = await postNarrative(narrativeRequest());
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: "the narrator could not answer" });
    const log = lines.join("\n");
    expectNoKey(log, text);
    expect(log).toContain(`POST /api/drill/narrative: 401 invalid x-api-key: ${REDACTED}`);
  });
});
