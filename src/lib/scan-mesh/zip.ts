// Just enough of the zip format to pull one file out of a large archive by
// range requests (issue 118): the scan's Matterpak is hundreds of megabytes,
// and the detailed mesh inside it is a few. Pure: bytes in, offsets out.
//
// Reading order: the end of the archive (`findEnd`), then, for a zip64
// archive, its zip64 end record (`readZip64End`), then the central directory
// (`listEntries`), then the chosen file's local header (`dataOffset`), then
// its compressed bytes.

export interface ZipEnd {
  /** Where the central directory starts, and its length, in bytes. */
  offset: number;
  size: number;
  count: number;
}

export interface ZipEntry {
  name: string;
  /** 0 stored, 8 deflated. */
  method: number;
  compressedSize: number;
  size: number;
  /** Where the entry's local header starts. */
  localOffset: number;
}

const END = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_END = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX32 = 0xffffffff;

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const u64 = (v: DataView, at: number) => Number(v.getBigUint64(at, true));

/** How many bytes from the end of an archive hold its end record, at most. */
export const END_SEARCH = 65_557;

/**
 * The central directory's place, from `tail`, the last bytes of the archive
 * (up to `END_SEARCH` of them).
 * For a zip64 archive, `zip64` is where its zip64 end record starts instead.
 * Null when `tail` holds no end record.
 */
export function findEnd(tail: Uint8Array): ZipEnd | { zip64: number } | null {
  const v = view(tail);
  for (let at = tail.length - 22; at >= 0; at--) {
    if (v.getUint32(at, true) !== END) continue;
    const count = v.getUint16(at + 10, true);
    const size = v.getUint32(at + 12, true);
    const offset = v.getUint32(at + 16, true);
    if (offset === MAX32 || size === MAX32 || count === 0xffff) {
      const locator = at - 20;
      if (locator < 0 || v.getUint32(locator, true) !== ZIP64_LOCATOR) return null;
      return { zip64: u64(v, locator + 8) };
    }
    return { offset, size, count };
  }
  return null;
}

/** The central directory's place, from a zip64 end record. */
export function readZip64End(record: Uint8Array): ZipEnd | null {
  const v = view(record);
  if (record.length < 56 || v.getUint32(0, true) !== ZIP64_END) return null;
  return { count: u64(v, 32), size: u64(v, 40), offset: u64(v, 48) };
}

/** Every entry in a central directory. */
export function listEntries(directory: Uint8Array): ZipEntry[] {
  const v = view(directory);
  const out: ZipEntry[] = [];
  const decoder = new TextDecoder();
  let at = 0;
  while (at + 46 <= directory.length && v.getUint32(at, true) === CENTRAL) {
    const method = v.getUint16(at + 10, true);
    let compressedSize = v.getUint32(at + 20, true);
    let size = v.getUint32(at + 24, true);
    const nameLength = v.getUint16(at + 28, true);
    const extraLength = v.getUint16(at + 30, true);
    const commentLength = v.getUint16(at + 32, true);
    let localOffset = v.getUint32(at + 42, true);
    const name = decoder.decode(directory.subarray(at + 46, at + 46 + nameLength));
    // A zip64 extra field holds, in order, whichever of the three overflowed.
    let extra = at + 46 + nameLength;
    const extraEnd = extra + extraLength;
    while (extra + 4 <= extraEnd) {
      const tag = v.getUint16(extra, true);
      const length = v.getUint16(extra + 2, true);
      if (tag === 1) {
        let field = extra + 4;
        if (size === MAX32) {
          size = u64(v, field);
          field += 8;
        }
        if (compressedSize === MAX32) {
          compressedSize = u64(v, field);
          field += 8;
        }
        if (localOffset === MAX32) localOffset = u64(v, field);
      }
      extra += 4 + length;
    }
    out.push({ name, method, compressedSize, size, localOffset });
    at = extraEnd + commentLength;
  }
  return out;
}

/** The local header's length, from its first 30 bytes, or null when it isn't one: the data follows it. */
export function localHeaderLength(header: Uint8Array): number | null {
  const v = view(header);
  if (header.length < 30 || v.getUint32(0, true) !== LOCAL) return null;
  return 30 + v.getUint16(26, true) + v.getUint16(28, true);
}

/**
 * Room for the local header past its fixed 30 bytes: its name and extra
 * field, which can differ from the directory's copy. Read in the same
 * request as the data, so one range request fetches one file.
 */
export const LOCAL_SLACK = 1024;

/** The byte range (inclusive) to fetch for `entry`: its local header, with slack, and its data. */
export function entryRange(entry: ZipEntry): [number, number] {
  return [entry.localOffset, entry.localOffset + 30 + LOCAL_SLACK + entry.compressedSize - 1];
}

/**
 * The entry's compressed data, from the bytes `entryRange` fetched; null
 * when they don't start with its local header or the header is longer than
 * the slack allowed for.
 */
export function entryData(fetched: Uint8Array, entry: ZipEntry): Uint8Array | null {
  const header = localHeaderLength(fetched.subarray(0, 30));
  if (header === null || header + entry.compressedSize > fetched.length) return null;
  return fetched.subarray(header, header + entry.compressedSize);
}

/** What a Matterpak holds for its textured mesh: the mesh, its material library and its texture images. */
export interface MatterpakParts {
  obj: ZipEntry;
  mtl: ZipEntry | null;
  /** By file name, without any folder. */
  images: Map<string, ZipEntry>;
}

const baseName = (name: string) => name.slice(name.lastIndexOf("/") + 1);

/**
 * The textured mesh's files in a Matterpak's directory, or null with no
 * mesh: the largest OBJ, the material library beside it, and every JPEG or
 * PNG. Only files stored or deflated are of use.
 */
export function matterpakParts(entries: readonly ZipEntry[]): MatterpakParts | null {
  const usable = entries.filter((e) => e.method === 0 || e.method === 8);
  const obj = usable.filter((e) => /\.obj$/i.test(e.name)).sort((a, b) => b.size - a.size)[0];
  if (!obj) return null;
  const stem = obj.name.replace(/\.obj$/i, "");
  const mtls = usable.filter((e) => /\.mtl$/i.test(e.name));
  const mtl = mtls.find((e) => e.name.replace(/\.mtl$/i, "") === stem) ?? mtls[0] ?? null;
  const images = new Map<string, ZipEntry>();
  for (const e of usable) if (/\.(jpe?g|png)$/i.test(e.name)) images.set(baseName(e.name), e);
  return { obj, mtl, images };
}
