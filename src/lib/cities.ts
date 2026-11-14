// How each city reads on screen. The domain keeps the short ids (`LA`); the
// top bar, the map's tabs and its empty state say the city's name.
import type { City } from "@/domain";

export const CITY_NAMES: Readonly<Record<City, string>> = { LA: "Los Angeles", Houston: "Houston" };

export function cityName(city: City): string {
  return CITY_NAMES[city];
}
