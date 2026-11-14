// Which services run on fixtures, from the environment (SPEC §7).
// `HEIST_MODE=live` turns live mode on; anything else, or nothing, is fake.
// Each service's own variable overrides it. Adapters (later tickets) also fall
// back to fake when a key is missing; this module only reads the switches.

export type ServiceMode = "fake" | "live";

export const SERVICES = {
  llm: { label: "Model", variable: "LLM_MODE" },
  costar: { label: "CoStar", variable: "COSTAR_MODE" },
  vexcel: { label: "Vexcel", variable: "VEXCEL_MODE" },
  matterport: { label: "Matterport", variable: "NEXT_PUBLIC_MATTERPORT_MODE" },
} as const;

export type Service = keyof typeof SERVICES;
export type ServiceModes = Record<Service, ServiceMode>;

type Env = Record<string, string | undefined>;

function parse(value: string | undefined): ServiceMode | undefined {
  if (value === "live") return "live";
  if (value === "fake") return "fake";
  return undefined;
}

export function serviceModes(env: Env): ServiceModes {
  const base = parse(env.HEIST_MODE) ?? "fake";
  const modes = {} as ServiceModes;
  for (const [service, { variable }] of Object.entries(SERVICES)) {
    modes[service as Service] = parse(env[variable]) ?? base;
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
  const onFixtures = (Object.keys(SERVICES) as Service[])
    .filter((service) => modes[service] === "fake")
    .map((service) => SERVICES[service].label);
  const allFake = onFixtures.length === Object.keys(SERVICES).length;
  return { label: allFake ? "FIXTURES" : "LIVE", onFixtures };
}
