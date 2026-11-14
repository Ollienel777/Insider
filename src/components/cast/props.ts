// What the cast page hands the browser beyond the pins (pins.ts): the trace
// without what each tool read and returned, and a massing view per finalist
// that has a fixture aerial. Pure, so a test can check both.
import type { Aerial, Candidate, CastingTrace } from "@/domain";
import { buildMassing, type MassingView } from "@/components/scout/massing";

/** The trace's rows only: tool and task payloads (`input`, `output`) stay on the server. */
export function clientTrace(trace: CastingTrace): CastingTrace {
  const events = trace.events.map(({ atMs, kind, agent, label, status, durationMs }) =>
    durationMs === undefined ? { atMs, kind, agent, label, status } : { atMs, kind, agent, label, status, durationMs },
  );
  return { ...trace, events };
}

/** The view the thumbnail shows: the Scout screen's first oblique. */
const THUMBNAIL_VIEW = "N";

/** One massing view per finalist with an aerial in `aerials`, by id. */
export function castThumbnails(
  finalists: readonly Pick<Candidate, "id" | "stories">[],
  aerials: ReadonlyMap<string, Aerial>,
): Record<string, MassingView> {
  const out: Record<string, MassingView> = {};
  for (const c of finalists) {
    const aerial = aerials.get(c.id);
    const view = aerial ? buildMassing(aerial, c.stories).find((v) => v.dir === THUMBNAIL_VIEW) : undefined;
    if (view) out[c.id] = view;
  }
  return out;
}
