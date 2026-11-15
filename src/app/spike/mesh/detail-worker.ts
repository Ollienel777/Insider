// Pulls the detailed mesh out of the scan's Matterpak (issue 118), off the
// main thread: reads the archive's directory by range requests, fetches only
// the mesh file's bytes (a few megabytes of a few hundred), inflates and
// parses them, and hands back the vertex and triangle arrays. Memory only:
// fetches are `cache: "no-store"`, and nothing is kept between messages.
import { isAllowedAssetUrl } from "@/lib/scan-mesh/manifest";
import { parseObj } from "@/lib/scan-mesh/obj";
import { END_SEARCH, findEnd, listEntries, localHeaderLength, readZip64End } from "@/lib/scan-mesh/zip";

export interface DetailRequest {
  url: string;
  /** The archive's length, from the route. */
  bytes: number;
}

export type DetailReply =
  | { positions: Float32Array; index: Uint32Array; megabytes: number; seconds: number }
  | { failed: string };

interface WorkerScope {
  onmessage: ((event: MessageEvent<DetailRequest>) => void) | null;
  postMessage(message: DetailReply, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

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


scope.onmessage = async (event) => {
  const started = performance.now();
  try {
    const { url, bytes: total } = event.data;
    if (!isAllowedAssetUrl(url)) throw new Error("not a scan link");
    if (!Number.isSafeInteger(total) || total <= 0) throw new Error("no size");
    const tailStart = Math.max(0, total - END_SEARCH);
    const end = findEnd(await bytes(url, tailStart, total - 1));
    if (!end) throw new Error("not an archive");
    const place = "zip64" in end ? readZip64End(await bytes(url, end.zip64, end.zip64 + 55)) : end;
    if (!place) throw new Error("no directory");
    const entries = listEntries(await bytes(url, place.offset, place.offset + place.size - 1));
    const mesh = entries.filter((e) => /\.obj$/i.test(e.name)).sort((a, b) => b.size - a.size)[0];
    if (!mesh || (mesh.method !== 0 && mesh.method !== 8)) throw new Error("no mesh in the archive");
    const header = localHeaderLength(await bytes(url, mesh.localOffset, mesh.localOffset + 29));
    if (header === null) throw new Error("bad entry");
    const start = mesh.localOffset + header;
    const packed = await bytes(url, start, start + mesh.compressedSize - 1);
    let text: string;
    if (mesh.method === 8) {
      const stream = new Blob([packed as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      text = await new Response(stream).text();
    } else {
      text = new TextDecoder().decode(packed);
    }
    const parsed = parseObj(text);
    if (parsed.index.length === 0) throw new Error("empty mesh");
    scope.postMessage(
      {
        positions: parsed.positions,
        index: parsed.index,
        megabytes: mesh.compressedSize / 1e6,
        seconds: (performance.now() - started) / 1000,
      },
      [parsed.positions.buffer, parsed.index.buffer],
    );
  } catch (error) {
    scope.postMessage({ failed: error instanceof Error ? error.message : "failed" });
  }
};
