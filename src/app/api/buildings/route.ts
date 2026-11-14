// GET /api/buildings?city=LA|Houston: the buildings the map pins (SPEC §4).
// Without `city`, every city's buildings. The response says which adapter
// answered (`mode`), so the UI can show whether this is fixture data, and
// carries `fallback` once a live failure has put CoStar on fixtures.
import { City } from "@/domain";
import { getCoStar } from "@/adapters/costar";
import { forcedFromRequest } from "@/lib/mode";

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
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ mode: getCoStar({ forced }).mode, error: message }, { status: 502 });
  }
}
