// Which services run on fixtures, from the environment (SPEC §7).
// `HEIST_MODE=live` turns live mode on; anything else, or nothing, is fake.
// Each service's own variable overrides it. A service requested live still
// serves fixtures while a variable it needs is missing (`missingForLive`);
// every adapter's `index.ts` and the mode chip read that one rule, so the chip
// says what each adapter actually serves.

export type ServiceMode = "fake" | "live";

export const SERVICES = {
  llm: { label: "Model", variable: "LLM_MODE" },
  costar: { label: "CoStar", variable: "COSTAR_MODE" },
  vexcel: { label: "Vexcel", variable: "VEXCEL_MODE" },
  matterport: { label: "Matterport", variable: "NEXT_PUBLIC_MATTERPORT_MODE" },
} as const;

export type Service = keyof typeof SERVICES;
export type ServiceModes = Record<Service, ServiceMode>;

export const SERVICE_IDS = Object.keys(SERVICES) as Service[];

type Env = Record<string, string | undefined>;

function parse(value: string | undefined): ServiceMode | undefined {
  if (value === "live") return "live";
  if (value === "fake") return "fake";
  return undefined;
}

/** The mode each service is *asked* for, from the switches alone. */
export function serviceModes(env: Env): ServiceModes {
  const base = parse(env.HEIST_MODE) ?? "fake";
  const modes = {} as ServiceModes;
  for (const [service, { variable }] of Object.entries(SERVICES)) {
    modes[service as Service] = parse(env[variable]) ?? base;
  }
  return modes;
}

/**
 * The variables a service needs before it can answer live, and which of
 * them `env` lacks. The model's depend on `LLM_PROVIDER`: Anthropic needs its
 * key; Bedrock needs `BEDROCK_ENABLED=1` (and is refused without it).
 */
export function missingForLive(service: Service, env: Env): string[] {
  const unset = (names: string[]) => names.filter((name) => !env[name]);
  switch (service) {
    case "costar":
      return unset(["COSTAR_KIT_DIR"]);
    case "vexcel":
      return unset(["VEXCEL_API_BASE", "VEXCEL_API_KEY"]);
    case "matterport":
      return unset(["NEXT_PUBLIC_MATTERPORT_SDK_KEY"]);
    case "llm":
      if (env.LLM_PROVIDER === "bedrock") return env.BEDROCK_ENABLED === "1" ? [] : ["BEDROCK_ENABLED"];
      return unset(["ANTHROPIC_API_KEY"]);
  }
}

/**
 * The mode each service serves from `env` alone: live only when it is asked
 * for and nothing it needs is missing. A live call that fails later, or a
 * service forced to fixtures in the demo settings, is applied on top.
 */
export function configuredModes(env: Env): ServiceModes {
  const requested = serviceModes(env);
  const modes = {} as ServiceModes;
  for (const service of SERVICE_IDS) {
    modes[service] = requested[service] === "live" && missingForLive(service, env).length === 0 ? "live" : "fake";
  }
  return modes;
}

export interface ModeChip {
  /** `FIXTURES` when every service is on fixtures, otherwise `LIVE`. */
  label: "FIXTURES" | "LIVE";
  /** Labels of the services still on fixtures, for the chip's tooltip. */
  onFixtures: string[];
}

export function modeChip(modes: ServiceModes): ModeChip {
  const onFixtures = SERVICE_IDS.filter((service) => modes[service] === "fake").map((service) => SERVICES[service].label);
  const allFake = onFixtures.length === SERVICE_IDS.length;
  return { label: allFake ? "FIXTURES" : "LIVE", onFixtures };
}

// ---- forcing a service to fixtures (the demo settings, Shift+?) ------------

/**
 * The session cookie that holds the services forced to fixtures, e.g.
 * `costar.vexcel`. The browser writes it; the server reads it on every
 * request, so the next request after a toggle already uses the fake.
 */
export const FORCE_COOKIE = "heist-fixtures";

/** The forced services in a cookie value; unknown names are ignored. */
export function parseForced(value: string | null | undefined): Set<Service> {
  const forced = new Set<Service>();
  for (const name of (value ?? "").split(".")) {
    if ((SERVICE_IDS as string[]).includes(name)) forced.add(name as Service);
  }
  return forced;
}

/** The forced services in a `Cookie` request header. */
export function forcedFromCookieHeader(header: string | null | undefined): Set<Service> {
  for (const part of (header ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== FORCE_COOKIE) continue;
    try {
      return parseForced(decodeURIComponent(rest.join("=")));
    } catch {
      // A malformed value (`%E0`) forces nothing rather than failing the request.
      return new Set();
    }
  }
  return new Set();
}

/** The cookie value for a set of forced services, in a stable order. */
export function forcedCookieValue(forced: ReadonlySet<Service>): string {
  return SERVICE_IDS.filter((service) => forced.has(service)).join(".");
}

/** The forced services of a route handler's request. */
export function forcedFromRequest(request: Request): Set<Service> {
  return forcedFromCookieHeader(request.headers.get("cookie"));
}
