// GET /api/buildings?city=LA|Houston: the buildings the map pins (SPEC §4).
// Without `city`, every city's buildings. The response says which adapter
// answered (`mode`), so the UI can show whether this is fixture data.
import { City } from "@/domain";
import { getCoStar } from "@/adapters/costar";

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

  const { adapter, mode } = getCoStar();
  try {
    const buildings = (await Promise.all(cities.map((c) => adapter.listBuildings(c)))).flat();
    return Response.json({ mode, buildings });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ mode, error: message }, { status: 502 });
  }
}
