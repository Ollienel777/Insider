// /spike/mesh#m=MODEL_ID: a sandbox for walking freely inside one real scan
// (issue 118). Our own three.js renderer over the scan's mesh, painted from
// its panoramas. Off the demo path; needs the Model API key and live mode,
// and says so when it has neither. The id goes after `#`, which the browser
// never sends, so the server's request log never shows it (model-hash.ts).
//
// Options: `faces=high|2k|4k` (panorama sharpness, default 2k),
// `mesh=50k|500k`, `detail=0` (no Matterpak mesh), `debug=1`.
import type { Metadata } from "next";
import { MESH_RESOLUTIONS, PANO_RESOLUTIONS, type MeshResolution, type PanoResolution } from "@/lib/scan-mesh/manifest";
import { ScanWalkScreen } from "./scan-walk";

export const metadata: Metadata = {
  title: "Scan free walk · Hobbs",
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

export default async function ScanMeshPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  return (
    <ScanWalkScreen
      faces={pick<PanoResolution>(one(search.faces), PANO_RESOLUTIONS, "2k")}
      mesh={pick<MeshResolution>(one(search.mesh), MESH_RESOLUTIONS, "50k")}
      detail={one(search.detail) !== "0"}
      debug={one(search.debug) === "1"}
    />
  );
}
