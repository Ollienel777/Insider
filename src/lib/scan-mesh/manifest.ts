// What the free-walk sandbox needs from one scan, and how the Model API's
// answer is cut down to it (issue 118). Pure: the server route feeds it the
// API's JSON, the tests feed it made-up data.
//
// The route relays short-lived signed links and never the assets themselves:
// the browser fetches the mesh and the panorama faces straight from the scan
// CDN (it answers cross-origin requests), so no scan byte passes through, or
// is stored by, our server. Every link is checked against `isAllowedAssetUrl`
// on the server before it is relayed and in the browser before it is fetched.
import { zUpQuatToYUp, zUpToYUp, type Quat, type Vec3 } from "./coords";

/** A scan's model id, as the kit's CSV writes it. */
export const MODEL_ID = /^[A-Za-z0-9]{6,20}$/;

export const PANO_RESOLUTIONS = ["low", "high", "2k", "4k"] as const;
export type PanoResolution = (typeof PANO_RESOLUTIONS)[number];
export const MESH_RESOLUTIONS = ["50k", "500k"] as const;
export type MeshResolution = (typeof MESH_RESOLUTIONS)[number];

export interface ScanMesh {
  /** A signed link to an OBJ file, z-up, in metres. */
  url: string;
  resolution: string;
}

export interface ScanPano {
  id: string;
  /** Where the camera stood, y-up. */
  position: Vec3;
  /** The spot on the floor under it, y-up; null when the scan has none. */
  floor: Vec3 | null;
  /** The camera's rotation, y-up. */
  rotation: Quat;
  /** Signed links to the six skybox faces, in the scan's own order; null when there are none. */
  faces: string[] | null;
  /** The resolution `faces` are at. */
  resolution: PanoResolution | null;
  /**
   * Signed links to the same six faces at the scan's lowest resolution, small
   * enough to keep every panorama's on the GPU at once; null when there are
   * none, or when `faces` already are the lowest.
   */
  preview: string[] | null;
  /** The floor spot this panorama stands on (several panoramas can share one); null when unknown. */
  anchor: string | null;
  /** The floor spots the scan recommends walking to from here. */
  neighbours: string[];
}

export interface ScanManifest {
  /** Null when the scan has no mesh the API will serve. */
  mesh: ScanMesh | null;
  panos: ScanPano[];
  /** The earliest moment any link here stops working (ISO), or null when none expires. */
  validUntil: string | null;
}

/** The query the route sends. `$faces` lists skybox resolutions, best first. */
export const MANIFEST_QUERY = `query ScanManifest($id: ID!, $faces: [String!]) {
  model(id: $id) {
    assets { meshes(formats: ["obj"]) { status format resolution url validUntil } }
    panoLocations {
      id
      position { x y z }
      rotation { x y z w }
      anchor { id position { x y z } neighbors }
      skyboxes(resolutions: $faces) { status resolution children validUntil }
    }
  }
}`;

/** The skybox resolutions to ask for when `wanted` is the one to show: it, then every lower one. */
export function faceResolutions(wanted: PanoResolution): PanoResolution[] {
  const at = PANO_RESOLUTIONS.indexOf(wanted);
  return PANO_RESOLUTIONS.slice(0, at + 1).reverse();
}

const ASSET_HOST = /^cdn(-\d+)?\.matterport\.com$/;

/**
 * Whether `url` is a link the scan CDN could have signed: https, a CDN host,
 * a path under `/models/`, no credentials and no odd port. Anything else the
 * API returned is dropped, so a changed answer can't point the browser
 * somewhere else.
 */
export function isAllowedAssetUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "https:" &&
    parsed.port === "" &&
    parsed.username === "" &&
    parsed.password === "" &&
    ASSET_HOST.test(parsed.hostname) &&
    parsed.pathname.startsWith("/models/")
  );
}

type Json = Record<string, unknown>;
const record = (v: unknown): Json | null => (typeof v === "object" && v !== null ? (v as Json) : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function point(v: unknown): Vec3 | null {
  const p = record(v);
  if (!p) return null;
  const { x, y, z } = p;
  if (![x, y, z].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return zUpToYUp(x as number, y as number, z as number);
}

function quaternion(v: unknown): Quat | null {
  const q = record(v);
  if (!q) return null;
  const { x, y, z, w } = q;
  if (![x, y, z, w].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const length = Math.hypot(x as number, y as number, z as number, w as number);
  if (length < 1e-6) return null;
  return zUpQuatToYUp((x as number) / length, (y as number) / length, (z as number) / length, (w as number) / length);
}

function isPanoResolution(v: unknown): v is PanoResolution {
  return (PANO_RESOLUTIONS as readonly unknown[]).includes(v);
}

/**
 * The manifest for the API's `data.model`, or null when there is no model.
 * `mesh` picks the resolution; `faces` is the best skybox resolution to use.
 */
export function buildManifest(
  model: unknown,
  want: { mesh: MeshResolution; faces: PanoResolution },
): ScanManifest | null {
  const m = record(model);
  if (!m) return null;
  const expiries: string[] = [];
  const expires = (v: unknown) => {
    if (typeof v === "string" && !Number.isNaN(Date.parse(v))) expiries.push(v);
  };

  let mesh: ScanMesh | null = null;
  for (const entry of list(record(m.assets)?.meshes)) {
    const e = record(entry);
    if (!e || e.status !== "available" || e.format !== "obj" || e.resolution !== want.mesh) continue;
    if (!isAllowedAssetUrl(e.url)) continue;
    mesh = { url: e.url, resolution: want.mesh };
    expires(e.validUntil);
    break;
  }

  const order = faceResolutions(want.faces);
  const panos: ScanPano[] = [];
  for (const entry of list(m.panoLocations)) {
    const e = record(entry);
    if (!e || typeof e.id !== "string") continue;
    const position = point(e.position);
    const rotation = quaternion(e.rotation);
    if (!position || !rotation) continue;

    let faces: string[] | null = null;
    let resolution: PanoResolution | null = null;
    const boxes = list(e.skyboxes).map(record);
    for (const wanted of order) {
      const box = boxes.find((b) => b && b.status === "available" && b.resolution === wanted);
      const children = list(box?.children);
      if (!box || children.length !== 6 || !children.every(isAllowedAssetUrl)) continue;
      faces = children as string[];
      resolution = wanted;
      expires(box.validUntil);
      break;
    }
    if (resolution !== null && !isPanoResolution(resolution)) continue;

    let preview: string[] | null = null;
    if (resolution !== null && resolution !== "low") {
      const box = boxes.find((b) => b && b.status === "available" && b.resolution === "low");
      const children = list(box?.children);
      if (box && children.length === 6 && children.every(isAllowedAssetUrl)) {
        preview = children as string[];
        expires(box.validUntil);
      }
    }

    const anchor = record(e.anchor);
    panos.push({
      id: e.id,
      position,
      floor: point(anchor?.position),
      rotation,
      faces,
      resolution,
      preview,
      anchor: typeof anchor?.id === "string" ? anchor.id : null,
      neighbours: list(anchor?.neighbors).filter((n): n is string => typeof n === "string"),
    });
  }

  expiries.sort((a, b) => Date.parse(a) - Date.parse(b));
  return { mesh, panos, validUntil: expiries[0] ?? null };
}
