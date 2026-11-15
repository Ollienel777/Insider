// A tiny made-up archive, built here byte by byte, in both plain and zip64 form.
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { END_SEARCH, findEnd, listEntries, localHeaderLength, readZip64End } from "./zip";

interface File {
  name: string;
  data: Buffer;
  deflate: boolean;
}

/** An archive of `files`; with `zip64`, sizes and offsets live in zip64 fields. */
function archive(files: File[], zip64 = false): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const body = f.deflate ? deflateRawSync(f.data) : f.data;
    const name = Buffer.from(f.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(f.deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const localExtra = Buffer.from([0xca, 0xfe, 0, 0]);
    local.writeUInt16LE(localExtra.length, 28);
    parts.push(local, name, localExtra, body);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(f.deflate ? 8 : 0, 10);
    let extra = Buffer.alloc(0);
    if (zip64) {
      entry.writeUInt32LE(0xffffffff, 20);
      entry.writeUInt32LE(0xffffffff, 24);
      entry.writeUInt32LE(0xffffffff, 42);
      extra = Buffer.alloc(4 + 24);
      extra.writeUInt16LE(1, 0);
      extra.writeUInt16LE(24, 2);
      extra.writeBigUInt64LE(BigInt(f.data.length), 4);
      extra.writeBigUInt64LE(BigInt(body.length), 12);
      extra.writeBigUInt64LE(BigInt(offset), 20);
    } else {
      entry.writeUInt32LE(body.length, 20);
      entry.writeUInt32LE(f.data.length, 24);
      entry.writeUInt32LE(offset, 42);
    }
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt16LE(extra.length, 30);
    central.push(entry, name, extra);
    offset += 30 + name.length + localExtra.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  const tail: Buffer[] = [];
  if (zip64) {
    const record = Buffer.alloc(56);
    record.writeUInt32LE(0x06064b50, 0);
    record.writeBigUInt64LE(BigInt(files.length), 32);
    record.writeBigUInt64LE(BigInt(directory.length), 40);
    record.writeBigUInt64LE(BigInt(offset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(BigInt(offset + directory.length), 8);
    end.writeUInt16LE(0xffff, 10);
    end.writeUInt32LE(0xffffffff, 12);
    end.writeUInt32LE(0xffffffff, 16);
    tail.push(record, locator);
  } else {
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
  }
  return Buffer.concat([...parts, directory, ...tail, end]);
}

const FILES: File[] = [
  { name: "readme.pdf", data: Buffer.from("not a pdf"), deflate: false },
  { name: "room/mesh.obj", data: Buffer.from("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n".repeat(20)), deflate: true },
];

/** Pulls `name` out of `zip` the way the page does: by the end, the directory, the local header. */
function extract(zip: Buffer, name: string): Buffer {
  const tailStart = Math.max(0, zip.length - END_SEARCH);
  const end = findEnd(new Uint8Array(zip.subarray(tailStart)));
  if (!end) throw new Error("no end");
  const place = "zip64" in end ? readZip64End(new Uint8Array(zip.subarray(end.zip64, end.zip64 + 56))) : end;
  if (!place) throw new Error("no zip64 end");
  const entries = listEntries(new Uint8Array(zip.subarray(place.offset, place.offset + place.size)));
  expect(entries).toHaveLength(place.count);
  const entry = entries.find((e) => e.name === name)!;
  const header = localHeaderLength(new Uint8Array(zip.subarray(entry.localOffset, entry.localOffset + 30)));
  if (header === null) throw new Error("no local header");
  const start = entry.localOffset + header;
  return zip.subarray(start, start + entry.compressedSize);
}

describe("the zip reader", () => {
  it.each([false, true])("pulls one file out (zip64: %s)", (zip64) => {
    const zip = archive(FILES, zip64);
    const plain = extract(zip, "readme.pdf");
    expect(plain.toString()).toBe("not a pdf");
    const mesh = extract(zip, "room/mesh.obj");
    expect(inflateRawSync(mesh).toString()).toBe(FILES[1].data.toString());
  });

  it("lists names, methods and sizes", () => {
    const zip = archive(FILES, true);
    const end = findEnd(new Uint8Array(zip)) as { zip64: number };
    const place = readZip64End(new Uint8Array(zip.subarray(end.zip64)))!;
    const entries = listEntries(new Uint8Array(zip.subarray(place.offset, place.offset + place.size)));
    expect(entries.map((e) => [e.name, e.method, e.size])).toEqual([
      ["readme.pdf", 0, 9],
      ["room/mesh.obj", 8, FILES[1].data.length],
    ]);
  });

  it("finds nothing in bytes that aren't an archive", () => {
    const junk = new Uint8Array(100).fill(7);
    expect(findEnd(junk)).toBeNull();
    expect(readZip64End(junk)).toBeNull();
    expect(listEntries(junk)).toEqual([]);
    expect(localHeaderLength(junk)).toBeNull();
  });
});
