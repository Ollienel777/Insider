// The services forced to fixtures in the demo settings, for server
// components: read from this request's cookie (route handlers read it from
// their `Request` with `forcedFromRequest`).
import { cookies } from "next/headers";
import { FORCE_COOKIE, parseForced, type Service } from "./mode";

export async function forcedServices(): Promise<Set<Service>> {
  const jar = await cookies();
  return parseForced(jar.get(FORCE_COOKIE)?.value);
}
