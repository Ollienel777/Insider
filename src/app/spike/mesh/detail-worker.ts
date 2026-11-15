// Pulls the textured mesh out of the scan's Matterpak (issue 118), off the
// main thread: reads the archive's directory by range requests, fetches the
// mesh file's bytes (a few megabytes of a few hundred), inflates and parses
// it with its material library, closes its small holes, and hands back the
// arrays. Then it fetches the texture images one range request each, nearest
// the eye first, and hands each back decoded small; on request, it decodes
// one again at full size for the textures near the eye. Memory only: fetches
// are `cache: "no-store"`, the images are held as blobs in this worker, and
// nothing outlives the page.
import { closeHoles } from "@/lib/scan-mesh/holes";
import { isAllowedAssetUrl } from "@/lib/scan-mesh/manifest";
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
      /** The size the small textures are decoded at, pixels square. */
      small: number;
    }
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
      /** Triangles closing the mesh's small holes, unindexed. */
      fill: Float32Array;
      holes: number;
      megabytes: number;
      seconds: number;
      /** Groups whose texture the archive holds. */
      textured: number;
    }
  | { kind: "texture"; group: number; sharp: boolean; image: ImageBitmap }
  /** Every texture fetched and sent small; `megabytes` fetched. */
  | { kind: "textures-done"; megabytes: number; seconds: number }
  | { kind: "failed"; failed: string };

interface WorkerScope {
  onmessage: ((event: MessageEvent<DetailRequest>) => void) | null;
  postMessage(message: DetailReply, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
/** Range requests in flight at once for the textures. */
const PARALLEL = 6;

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
      const image = await decode(blob, null);
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
    groups = mesh.groups;
    const closed = closeHoles(mesh.vertices, mesh.welded);
    const textured = request.textures ? groups.filter((g) => g.image && parts.images.has(g.image)).length : 0;
    scope.postMessage(
      {
        kind: "mesh",
        positions: mesh.positions,
        uvs: mesh.uvs,
        index: mesh.index,
        groups,
        fill: closed.triangles,
        holes: closed.holes,
        megabytes: parts.obj.compressedSize / 1e6,
        seconds: (performance.now() - started) / 1000,
        textured,
      },
      [mesh.positions.buffer, mesh.uvs.buffer, mesh.index.buffer, closed.triangles.buffer],
    );
    if (textured > 0) await fetchTextures(url, total, parts.images);
  } catch (error) {
    scope.postMessage({ kind: "failed", failed: error instanceof Error ? error.message : "failed" });
  }
}

scope.onmessage = (event) => {
  const request = event.data;
  if (request.kind === "load") void load(request);
  else if (request.kind === "eye") eye = request.eye;
  else if (request.kind === "sharp") void sendSharp(request.groups);
};
