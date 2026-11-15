// Pulls the textured mesh out of the scan's Matterpak (issue 118), off the
// main thread: reads the archive's directory by range requests, fetches the
// mesh file's bytes (a few megabytes of a few hundred), inflates and parses
// it with its material library, and hands back the arrays. Then it repairs
// the mesh (which of it the panoramas saw, its shards, its flat surfaces and
// the gaps in them, its small holes) and hands back the mesh without what
// was left out, and the stand-ins. Then it fetches the texture images one range request each, nearest
// the eye first, and hands each back decoded small; on request, it decodes
// one again at full size for the textures near the eye. Memory only: fetches
// are `cache: "no-store"`, the images are held as blobs in this worker, and
// nothing outlives the page.
import { closeHoles } from "@/lib/scan-mesh/holes";
import { inpaint } from "@/lib/scan-mesh/inpaint";
import { isAllowedAssetUrl } from "@/lib/scan-mesh/manifest";
import { vertexOcclusion } from "@/lib/scan-mesh/occlusion";
import { fillPlanes, fitPlanes, flattenPlanes, PLANE_LIMITS, type PlanePatch } from "@/lib/scan-mesh/planes";
import { dropTriangles, findFloaters, findShards, FLOATER_LIMITS, SHARD_SCRAP } from "@/lib/scan-mesh/shards";
import { seenWork } from "./seen";
import { distanceToGroup, parseMtl, parseTexturedObj, type TexturedGroup } from "@/lib/scan-mesh/textured";
import {
  END_SEARCH,
  entryData,
  entryRange,
  findEnd,
  listEntries,
  matterpakParts,
  readZip64End,
  type ZipEntry,
} from "@/lib/scan-mesh/zip";

export type DetailRequest =
  | {
      kind: "load";
      url: string;
      /** The archive's length, from the route. */
      bytes: number;
      /** Fetch the texture images too. */
      textures: boolean;
      /** The size the small textures are decoded at, pixels square, and the full-size ones near the eye (null: as stored). */
      small: number;
      sharp: number | null;
      /** Where the scan's panoramas were taken, y-up: for telling what of the mesh any of them saw. */
      panos: [number, number, number][];
      /** Which repairs to make: the shards left out, the planes carried across their gaps. */
      repair: "all" | "none" | "shards" | "planes";
      /**
       * The clean view's repairs (issue 118): every shard out, seen or not,
       * smaller and thinner floating pieces out, larger gaps in planes closed,
       * and an occlusion value baked into each corner.
       */
      clean?: boolean;
    }
  /**
   * Fill the gaps (alpha under 128) of this picture of a surface from the
   * rest of it, and hand back the part `crop` names (x, y, width, height).
   */
  | { kind: "inpaint"; id: number; width: number; height: number; pixels: Uint8Array; crop: [number, number, number, number] }
  /** Where the eye is now: the next textures fetched are the nearest. */
  | { kind: "eye"; eye: [number, number, number] }
  /** Decode these groups' textures at full size. */
  | { kind: "sharp"; groups: number[] };

export type DetailReply =
  | {
      kind: "mesh";
      positions: Float32Array;
      uvs: Float32Array;
      index: Uint32Array;
      groups: TexturedGroup[];
      megabytes: number;
      seconds: number;
      /** Groups whose texture the archive holds. */
      textured: number;
    }
  /**
   * The mesh repaired, sent after the mesh so the mesh shows first: its
   * triangles again without its shards and the unseen ones a plane's patch
   * stands in for (`index` and `groups` replace the first), its corners again
   * with the large planes' made flat (`positions`), the patches (unindexed
   * corners and their places in each patch's box), and the triangles closing
   * the small holes no plane holds (`fans`).
   */
  | {
      kind: "repair";
      positions: Float32Array;
      index: Uint32Array;
      groups: TexturedGroup[];
      fans: Float32Array;
      patchPositions: Float32Array;
      patchUvs: Float32Array;
      patches: PlanePatch[];
      /** In the clean view: per corner of `positions`, 0 open to 1 shut in (lib/scan-mesh/occlusion.ts). */
      occlusion: Float32Array | null;
      stats: RepairStats;
    }
  /** A picture's gaps filled; null when it had nothing to fill them from. */
  | { kind: "inpainted"; id: number; pixels: Uint8ClampedArray | null; filled: number }
  | { kind: "texture"; group: number; sharp: boolean; image: ImageBitmap }
  /** Every texture fetched and sent small; `megabytes` fetched. */
  | { kind: "textures-done"; megabytes: number; seconds: number }
  | { kind: "failed"; failed: string };

export interface RepairStats {
  /**
   * Triangles left out as shards (lib/scan-mesh/shards.ts): loose scraps,
   * and the slivers, spans and stretched ones that no panorama saw. `found`
   * is how many the mesh had by shape alone, seen or not.
   */
  shards: number;
  found: number;
  /** Triangles left out with the pieces that hung in the air (shards.ts's findFloaters), and how many pieces. */
  floating: number;
  floaters: number;
  /** Vertices moved onto their wall's, floor's or ceiling's plane, and their root mean square distance from it before and after, metres. */
  flattened: number;
  rippleBefore: number;
  rippleAfter: number;
  /** Triangles no panorama saw, and of those the ones a patch now stands in for. */
  unseen: number;
  replaced: number;
  /** Unseen surface taken over by patches, m². */
  unseenArea: number;
  planes: number;
  /** Small holes closed with fans, and gaps in planes left open (a doorway, or too large). */
  holes: number;
  open: number;
  seconds: number;
  /** Seconds each step took: what was seen, the planes, their patches, the holes. */
  steps: [number, number, number, number];
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<DetailRequest>) => void) | null;
  postMessage(message: DetailReply, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
/** Triangles tested for being seen before the thread is let go for a moment. */
const SEEN_SLICE = 15_000;
/** Range requests in flight at once for the textures. */
const PARALLEL = 6;
/** The clean view's limits: smaller and thinner pieces count as floating, and larger gaps are closed. */
const CLEAN_FLOATERS = { ...FLOATER_LIMITS, maxArea: 4, needle: 0.2, needleLong: 0.4, minSeen: 0.7 };
const CLEAN_PLANES = { ...PLANE_LIMITS, maxWallArea: 9, maxLevelArea: 40, minPatch: 0.01 };
const CLEAN_HOLES = { maxEdges: 400, maxSpan: 2.2 };

async function bytes(url: string, start: number, end: number): Promise<Uint8Array> {
  const response = await fetch(url, {
    headers: { Range: `bytes=${start}-${end}` },
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (response.status !== 206 && response.status !== 200) throw new Error(`range ${response.status}`);
  const all = new Uint8Array(await response.arrayBuffer());
  // A server that ignores the range sends the whole file: take the part asked for.
  return response.status === 200 ? all.subarray(start, end + 1) : all;
}

async function inflate(packed: Uint8Array, method: number): Promise<Blob> {
  if (method === 0) return new Blob([packed as BlobPart]);
  const stream = new Blob([packed as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).blob();
}

/** One entry's bytes, inflated: one range request. */
async function entryBlob(url: string, entry: ZipEntry, total: number): Promise<Blob> {
  const [start, end] = entryRange(entry);
  const fetched = await bytes(url, start, Math.min(end, total - 1));
  const packed = entryData(fetched, entry);
  if (!packed) throw new Error("bad entry");
  return inflate(packed, entry.method);
}

let eye: [number, number, number] = [0, 0, 0];
let groups: TexturedGroup[] = [];
const blobs = new Map<number, Blob>();
let small = 512;
let sharpSize: number | null = null;

async function decode(blob: Blob, size: number | null): Promise<ImageBitmap> {
  const options: ImageBitmapOptions = { colorSpaceConversion: "none", premultiplyAlpha: "none" };
  if (size !== null) Object.assign(options, { resizeWidth: size, resizeHeight: size, resizeQuality: "medium" });
  return createImageBitmap(blob, options);
}

async function sendSharp(list: number[]): Promise<void> {
  for (const group of list) {
    const blob = blobs.get(group);
    if (!blob) continue;
    try {
      const image = await decode(blob, sharpSize);
      scope.postMessage({ kind: "texture", group, sharp: true, image }, [image]);
    } catch {
      // The small one stays.
    }
  }
}

async function fetchTextures(url: string, total: number, images: Map<string, ZipEntry>): Promise<void> {
  const started = performance.now();
  const waiting = new Set<number>();
  groups.forEach((g, i) => {
    if (g.image && images.has(g.image)) waiting.add(i);
  });
  let megabytes = 0;
  const next = (): number | null => {
    let best: number | null = null;
    let near = Infinity;
    for (const i of waiting) {
      const d = distanceToGroup(groups[i], eye);
      if (d < near) {
        near = d;
        best = i;
      }
    }
    if (best !== null) waiting.delete(best);
    return best;
  };
  const lane = async () => {
    for (let i = next(); i !== null; i = next()) {
      const entry = images.get(groups[i].image as string) as ZipEntry;
      try {
        const blob = await entryBlob(url, entry, total);
        megabytes += entry.compressedSize / 1e6;
        blobs.set(i, blob);
        const image = await decode(blob, small);
        scope.postMessage({ kind: "texture", group: i, sharp: false, image }, [image]);
      } catch {
        // Left untextured: the panoramas paint it.
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, lane));
  scope.postMessage({ kind: "textures-done", megabytes, seconds: (performance.now() - started) / 1000 });
}

async function load(request: Extract<DetailRequest, { kind: "load" }>): Promise<void> {
  const started = performance.now();
  try {
    const { url, bytes: total } = request;
    small = request.small;
    sharpSize = request.sharp;
    if (!isAllowedAssetUrl(url)) throw new Error("not a scan link");
    if (!Number.isSafeInteger(total) || total <= 0) throw new Error("no size");
    const tailStart = Math.max(0, total - END_SEARCH);
    const end = findEnd(await bytes(url, tailStart, total - 1));
    if (!end) throw new Error("not an archive");
    const place = "zip64" in end ? readZip64End(await bytes(url, end.zip64, end.zip64 + 55)) : end;
    if (!place) throw new Error("no directory");
    const parts = matterpakParts(listEntries(await bytes(url, place.offset, place.offset + place.size - 1)));
    if (!parts) throw new Error("no mesh in the archive");
    const [objBlob, mtlBlob] = await Promise.all([
      entryBlob(url, parts.obj, total),
      request.textures && parts.mtl ? entryBlob(url, parts.mtl, total) : Promise.resolve(null),
    ]);
    const materials = mtlBlob ? parseMtl(await mtlBlob.text()) : new Map<string, string>();
    const mesh = parseTexturedObj(await objBlob.text(), materials);
    if (mesh.index.length === 0) throw new Error("empty mesh");
    const shards = findShards(mesh.positions, mesh.uvs, mesh.index, mesh.welded, mesh.groups);
    groups = mesh.groups;
    const textured = request.textures ? groups.filter((g) => g.image && parts.images.has(g.image)).length : 0;
    const first = mesh.index.slice();
    scope.postMessage(
      {
        kind: "mesh",
        positions: mesh.positions,
        uvs: mesh.uvs,
        index: first,
        groups,
        megabytes: parts.obj.compressedSize / 1e6,
        seconds: (performance.now() - started) / 1000,
        textured,
      },
      [mesh.positions.buffer, mesh.uvs.buffer, first.buffer],
    );
    // The textures' requests go out first; the repair holds this thread for a few seconds while they travel.
    const fetched = textured > 0 ? fetchTextures(url, total, parts.images) : null;
    try {
      await repair(mesh.vertices, mesh.index, mesh.welded, shards.flags, request.panos, request.repair, request.clean === true);
    } catch {
      // The mesh stays as it was first sent.
    }
    await fetched;
  } catch (error) {
    scope.postMessage({ kind: "failed", failed: error instanceof Error ? error.message : "failed" });
  }
}

/**
 * The mesh repaired. Shards go: loose scraps, and the slivers, spans and
 * stretched triangles that no panorama saw (one that was seen is painted
 * from the photograph and reads as the surface it is). What no panorama saw
 * of each flat surface, and the gaps in it, get patches in the surface's
 * plane, and the small holes are closed with fans. `index` is the drawn
 * mesh's triangles and `welded` the same triangles over `vertices`, each
 * vertex once; `shards` is findShards's flag for each.
 */
async function repair(
  vertices: Float32Array,
  index: Uint32Array,
  welded: Uint32Array,
  shards: Uint8Array,
  panos: [number, number, number][],
  which: "all" | "none" | "shards" | "planes",
  clean = false,
): Promise<void> {
  const started = performance.now();
  if (which === "none" || which === "planes") shards.fill(0);
  // A slice at a time: the textures' decoding shares this thread.
  const work = seenWork(vertices, welded, panos);
  for (let from = 0; from < work.seen.length; from += SEEN_SLICE) {
    work.run(from, from + SEEN_SLICE);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const seenAll = work.seen;
  const afterSeen = performance.now();
  let found = 0;
  let dropped = 0;
  let unseen = 0;
  const seen = new Uint8Array(seenAll.length);
  let keptCount = 0;
  for (let t = 0; t < shards.length; t++) {
    if (!seenAll[t]) unseen++;
    if (shards[t] === 0) {
      seen[keptCount++] = seenAll[t];
      continue;
    }
    found++;
    // The clean view has no photograph to make a seen shard read as the surface it is: every one goes.
    if (clean || shards[t] & SHARD_SCRAP || !seenAll[t]) dropped++;
    else {
      shards[t] = 0;
      seen[keptCount++] = seenAll[t];
    }
  }
  // Pieces left hanging in the air, among what is still in.
  const floaters = which === "all" || which === "shards" ? findFloaters(vertices, welded, shards, panos, clean ? CLEAN_FLOATERS : undefined, seenAll) : { flags: new Uint8Array(0), count: 0, pieces: 0 };
  if (floaters.count > 0) {
    keptCount = 0;
    for (let t = 0; t < shards.length; t++) {
      if (floaters.flags[t]) shards[t] = SHARD_SCRAP;
      if (shards[t] === 0) seen[keptCount++] = seenAll[t];
    }
  }
  const kept = dropTriangles(index, welded, groups, shards);
  const planes = which === "all" || which === "planes";
  const fit = planes ? fitPlanes(vertices, kept.welded) : { planes: [], owner: new Int32Array(kept.welded.length / 3).fill(-1) };
  // Walls, floors and ceilings made flat: their vertices moved onto their planes.
  const flat = planes ? flattenPlanes(vertices, kept.welded, fit) : { moved: 0, before: 0, after: 0 };
  // The drawn mesh's corners again, from the moved vertices: each is one of them, split where its texture has a seam.
  let corners = 0;
  for (let i = 0; i < index.length; i++) if (index[i] >= corners) corners = index[i] + 1;
  const positions = new Float32Array(corners * 3);
  for (let i = 0; i < index.length; i++) {
    const to = index[i] * 3;
    const from = welded[i] * 3;
    positions[to] = vertices[from];
    positions[to + 1] = vertices[from + 1];
    positions[to + 2] = vertices[from + 2];
  }
  const afterFit = performance.now();
  const fill = fillPlanes(
    vertices,
    kept.welded,
    fit,
    clean ? CLEAN_PLANES : undefined,
    // Only true gaps are closed. What no panorama saw of a plane keeps the mesh's own surface and texture:
    // a patch laid over it reads as a slab set into the wall, its outline in steps.
    null,
    panos.map((p) => p[1]),
    work.clearTo,
  );
  work.done();
  const afterFill = performance.now();
  const trimmed = dropTriangles(kept.index, kept.welded, kept.groups, fill.replaced);
  groups = trimmed.groups;
  const closed = closeHoles(vertices, kept.welded, clean ? CLEAN_HOLES : undefined);
  let occlusion: Float32Array | null = null;
  if (clean) {
    // What is drawn, and its stand-ins, hide the space over each vertex.
    const shut = vertexOcclusion(vertices, trimmed.welded);
    occlusion = new Float32Array(corners);
    for (let i = 0; i < index.length; i++) occlusion[index[i]] = shut[welded[i]];
  }
  let replaced = 0;
  for (let t = 0; t < fill.replaced.length; t++) if (fill.replaced[t]) replaced++;
  scope.postMessage(
    {
      kind: "repair",
      positions,
      index: trimmed.index,
      groups,
      fans: closed.triangles,
      patchPositions: fill.positions,
      patchUvs: fill.uvs,
      patches: fill.patches,
      occlusion,
      stats: {
        shards: dropped + floaters.count,
        found,
        floating: floaters.count,
        floaters: floaters.pieces,
        flattened: flat.moved,
        rippleBefore: flat.before,
        rippleAfter: flat.after,
        unseen,
        replaced,
        unseenArea: fill.unseenArea,
        planes: fit.planes.length,
        holes: closed.holes,
        open: fill.open,
        seconds: (performance.now() - started) / 1000,
        steps: [(afterSeen - started) / 1000, (afterFit - afterSeen) / 1000, (afterFill - afterFit) / 1000, (performance.now() - afterFill) / 1000],
      },
    },
    [positions.buffer, trimmed.index.buffer, closed.triangles.buffer, fill.positions.buffer, fill.uvs.buffer, ...(occlusion ? [occlusion.buffer] : [])],
  );
}

/** One picture's gaps filled from the rest of it (lib/scan-mesh/inpaint.ts). */
function fillPicture(request: Extract<DetailRequest, { kind: "inpaint" }>): void {
  const { id, width, height, pixels, crop } = request;
  const known = new Uint8Array(width * height);
  for (let p = 0; p < known.length; p++) known[p] = pixels[p * 4 + 3] >= 128 ? 1 : 0;
  let out: ReturnType<typeof inpaint> = null;
  try {
    out = inpaint(pixels, known, width, height, undefined, crop);
  } catch {
    out = null;
  }
  if (!out) {
    scope.postMessage({ kind: "inpainted", id, pixels: null, filled: 0 });
    return;
  }
  const [x0, y0, w, h] = crop;
  const part = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) part.set(out.pixels.subarray(((y0 + y) * width + x0) * 4, ((y0 + y) * width + x0 + w) * 4), y * w * 4);
  scope.postMessage({ kind: "inpainted", id, pixels: part, filled: out.filled }, [part.buffer]);
}

scope.onmessage = (event) => {
  const request = event.data;
  if (request.kind === "load") void load(request);
  else if (request.kind === "inpaint") fillPicture(request);
  else if (request.kind === "eye") eye = request.eye;
  else if (request.kind === "sharp") void sendSharp(request.groups);
};
