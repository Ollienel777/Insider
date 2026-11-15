// /spike/mesh#m=MODEL_ID: a sandbox for walking freely inside one real scan
// (issue 118). Our own three.js renderer over the scan's mesh, painted from
// its panoramas. Off the demo path; needs the Model API key and live mode,
// and says so when it has neither. The id goes after `#`, which the browser
// never sends, so the server's request log never shows it (model-hash.ts).
//
// Options: `faces=high|2k|4k` (panorama sharpness, default 2k),
// `mesh=50k|500k`, `detail=0` (no Matterpak mesh), `textured=0` (paint it
// from the panoramas alone, without its textures under them), `fill=0`
// (leave holes open), `repair=0` (the mesh as scanned: shards in, no planes
// carried across gaps; `shards` or `planes` for one of the two), `view=mesh`
// (draw the mesh, painted from the panoramas and its textures), `view=spheres`
// (the panoramas as depth spheres over the mesh), `view=photo` (the nearest
// panorama alone, warped a little), or by default `view=demo` (the nearest
// panorama as a plain skybox, zooming toward the walk; V shows the mesh), `reach=0.38`
// (how far the photo view's picture follows the eye, metres; [ and ] change it), `debug=1`.
import type { Metadata } from "next";
import { MESH_RESOLUTIONS, PANO_RESOLUTIONS, type MeshResolution, type PanoResolution } from "@/lib/scan-mesh/manifest";
import { ScanWalkScreen } from "./scan-walk";

export const metadata: Metadata = {
  title: "Scan free walk · Heist Anywhere",
  robots: { index: false, follow: false },
  // The scan's links are signed for whoever holds them: never send them on.
  referrer: "no-referrer",
};

type Search = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value ?? "") ? (value as T) : fallback;
}

/** `reach=0.35`: the photo view's reach, metres, from 0 to 1.5; anything else is the default. */
function reachOf(value: string | null): number | null {
  const metres = value === null ? NaN : Number(value);
  return Number.isFinite(metres) && metres >= 0 && metres <= 1.5 ? metres : null;
}

export default async function ScanMeshPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  return (
    <ScanWalkScreen
      faces={pick<PanoResolution>(one(search.faces), PANO_RESOLUTIONS, "2k")}
      mesh={pick<MeshResolution>(one(search.mesh), MESH_RESOLUTIONS, "50k")}
      detail={one(search.detail) !== "0"}
      textured={one(search.textured) !== "0"}
      fill={one(search.fill) !== "0"}
      repair={one(search.repair) === "0" ? "none" : pick(one(search.repair), ["all", "shards", "planes"] as const, "all")}
      view={pick(one(search.view), ["mesh", "spheres", "photo", "demo"] as const, "demo")}
      reach={reachOf(one(search.reach))}
      debug={one(search.debug) === "1"}
    />
  );
}
