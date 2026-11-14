// GET /api/buildings?city=LA|Houston: the buildings the map pins (SPEC §4).
// Without `city`, every city's buildings. The response says which adapter
// answered (`mode`), so the UI can show whether this is fixture data, and
// carries `fallback` once a live failure has put CoStar on fixtures.
import { City } from "@/domain";
import { getCoStar } from "@/adapters/costar";
import { forcedFromRequest } from "@/lib/mode";

/** The 502's one line: fixed, so nothing from the failure reaches the browser. */
const BUILDINGS_UNAVAILABLE = "CoStar could not list the buildings. Try again.";

export async function GET(request: Request): Promise<Response> {
  const param = new URL(request.url).searchParams.get("city");
  let cities: City[];
  if (param === null) {
    cities = City.options;
  } else {
    const parsed = City.safeParse(param);
    if (!parsed.success) {
      return Response.json(
        { error: `unknown city "${param}"; use one of ${City.options.join(", ")}` },
        { status: 400 },
      );
    }
    cities = [parsed.data];
  }

  const forced = forcedFromRequest(request).has("costar");
  const { adapter } = getCoStar({ forced });
  try {
    const buildings = (await Promise.all(cities.map((c) => adapter.listBuildings(c)))).flat();
    // Read after the call: a live failure during it has switched CoStar to fixtures.
    const { mode, fallback } = getCoStar({ forced });
    return Response.json({ mode, buildings, ...(fallback && { fallback }) });
  } catch (error) {
    // The detail stays in the server log; the browser gets a fixed line, never
    // a kit path or a schema dump (issue 27, R1-M1).
    console.error("GET /api/buildings: CoStar failed", error);
    return Response.json({ mode: getCoStar({ forced }).mode, error: BUILDINGS_UNAVAILABLE }, { status: 502 });
  }
}
