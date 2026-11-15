import { describe, expect, it } from "vitest";
import { dropTriangles, findFloaters, findShards, SHARD_LONG, SHARD_SCRAP, SHARD_SLIVER, SHARD_STRETCH } from "./shards";

/** A flat grid of `n` by `n` squares, `size` metres each, two triangles a square, with texture coordinates across it. */
function grid(n: number, size: number) {
  const positions: number[] = [];
  const uvs: number[] = [];
  for (let y = 0; y <= n; y++) {
    for (let x = 0; x <= n; x++) {
      positions.push(x * size, 0, y * size);
      uvs.push(x / n, y / n);
    }
  }
  const index: number[] = [];
  const at = (x: number, y: number) => y * (n + 1) + x;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) index.push(at(x, y), at(x + 1, y), at(x + 1, y + 1), at(x, y), at(x + 1, y + 1), at(x, y + 1));
  }
  return { positions, uvs, index };
}

describe("findShards", () => {
  it("finds none in an even mesh", () => {
    const g = grid(8, 0.15);
    const index = Uint32Array.from(g.index);
    const shards = findShards(Float32Array.from(g.positions), Float32Array.from(g.uvs), index, index, [{ start: 0, count: index.length }]);
    expect(shards.count).toBe(0);
    expect(shards.typicalEdge).toBeCloseTo(0.15 * Math.SQRT2, 3);
  });

  it("flags a triangle that spans a gap many times the mesh's usual edge", () => {
    const g = grid(8, 0.15);
    const v = g.positions.length / 3;
    g.positions.push(4, 0, 0, 4, 2, 0);
    g.uvs.push(0, 0, 0, 0);
    g.index.push(0, v, v + 1);
    const index = Uint32Array.from(g.index);
    const shards = findShards(Float32Array.from(g.positions), null, index);
    expect(shards.long).toBe(1);
    expect(shards.flags[shards.flags.length - 1] & SHARD_LONG).toBe(SHARD_LONG);
    expect(shards.count).toBe(1);
  });

  it("flags a long sliver, and leaves a small thin triangle alone", () => {
    const g = grid(8, 0.15);
    const v = g.positions.length / 3;
    // 0.6 m long and 5 mm high; then 5 cm long and half a millimetre high.
    g.positions.push(0, 1, 0, 0.6, 1, 0, 0.3, 1.005, 0, 0, 2, 0, 0.05, 2, 0, 0.025, 2.0005, 0);
    g.index.push(v, v + 1, v + 2, v + 3, v + 4, v + 5);
    const index = Uint32Array.from(g.index);
    const shards = findShards(Float32Array.from(g.positions), null, index);
    expect(shards.sliver).toBe(1);
    expect(shards.flags[shards.flags.length - 2] & SHARD_SLIVER).toBe(SHARD_SLIVER);
    expect(shards.flags[shards.flags.length - 1]).toBe(0);
  });

  it("flags a triangle whose texture is pulled over many times the surface its neighbours' is", () => {
    const g = grid(8, 0.15);
    const v = g.positions.length / 3;
    // Half a metre of surface from a sliver of the texture.
    g.positions.push(0, 1, 0, 0.6, 1, 0, 0.3, 1.5, 0);
    g.uvs.push(0.5, 0.5, 0.52, 0.5, 0.51, 0.52);
    g.index.push(v, v + 1, v + 2);
    const index = Uint32Array.from(g.index);
    const shards = findShards(Float32Array.from(g.positions), Float32Array.from(g.uvs), index, null, [{ start: 0, count: index.length }]);
    expect(shards.stretched).toBe(1);
    expect(shards.flags[shards.flags.length - 1] & SHARD_STRETCH).toBe(SHARD_STRETCH);
  });

  it("flags a small piece joined to nothing, and keeps a large one", () => {
    const g = grid(8, 0.15);
    const v = g.positions.length / 3;
    g.positions.push(5, 1, 0, 5.1, 1, 0, 5, 1.1, 0);
    g.index.push(v, v + 1, v + 2);
    const index = Uint32Array.from(g.index);
    const shards = findShards(Float32Array.from(g.positions), null, index, index);
    expect(shards.scrap).toBe(1);
    expect(shards.flags[shards.flags.length - 1]).toBe(SHARD_SCRAP);
    expect(shards.flags[0]).toBe(0);
  });
});

describe("dropTriangles", () => {
  it("leaves the flagged triangles out and moves each group's run", () => {
    const index = Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const welded = Uint32Array.from([0, 1, 2, 2, 1, 3, 4, 5, 6, 6, 5, 7]);
    const groups = [
      { start: 0, count: 6, image: "a" },
      { start: 6, count: 6, image: "b" },
    ];
    const out = dropTriangles(index, welded, groups, Uint8Array.from([0, 1, 0, 0]));
    expect([...out.index]).toEqual([0, 1, 2, 6, 7, 8, 9, 10, 11]);
    expect([...out.welded]).toEqual([0, 1, 2, 4, 5, 6, 6, 5, 7]);
    expect(out.groups).toEqual([
      { start: 0, count: 3, image: "a" },
      { start: 3, count: 6, image: "b" },
    ]);
  });

  it("keeps the order of a mesh with no groups", () => {
    const index = Uint32Array.from([0, 1, 2, 3, 4, 5]);
    const out = dropTriangles(index, index, [], Uint8Array.from([2, 0]));
    expect([...out.index]).toEqual([3, 4, 5]);
  });
});

describe("findFloaters", () => {
  /** A box `size` metres a side with its low corner at (x, y, z): twelve triangles, one piece. */
  function box(x: number, y: number, z: number, size: [number, number, number], base: number) {
    const positions: number[] = [];
    for (const dz of [0, 1]) for (const dy of [0, 1]) for (const dx of [0, 1]) positions.push(x + dx * size[0], y + dy * size[1], z + dz * size[2]);
    const quads = [
      [0, 1, 3, 2],
      [4, 6, 7, 5],
      [0, 4, 5, 1],
      [2, 3, 7, 6],
      [0, 2, 6, 4],
      [1, 5, 7, 3],
    ];
    const index: number[] = [];
    for (const [a, b, c, d] of quads) index.push(base + a, base + b, base + c, base + a, base + c, base + d);
    return { positions, index };
  }
  const camera: [number, number, number][] = [[0, 1.4, 0]];
  const flagsOf = (parts: { positions: number[]; index: number[] }[]) => {
    const positions = Float32Array.from(parts.flatMap((p) => p.positions));
    const welded = Uint32Array.from(parts.flatMap((p) => p.index));
    return findFloaters(positions, welded, null, camera);
  };

  it("finds a piece hanging in the air, and keeps one standing on the floor and one on the ceiling", () => {
    const hanging = box(1, 0.9, 1, [0.3, 0.5, 0.3], 0);
    const bin = box(2, 0, 1, [0.3, 0.6, 0.3], 8);
    const lamp = box(1, 2.2, 2, [0.4, 0.5, 0.4], 16);
    const out = flagsOf([hanging, bin, lamp]);
    expect(out.pieces).toBe(1);
    expect(out.count).toBe(12);
    expect([...out.flags.subarray(0, 12)]).toEqual(new Array(12).fill(1));
    expect([...out.flags.subarray(12)]).toEqual(new Array(24).fill(0));
  });

  it("keeps a piece as large as a room, wherever it is", () => {
    const room = box(0, 0.5, 0, [2, 1.5, 2], 0);
    expect(flagsOf([room]).count).toBe(0);
  });

  it("finds a needle even where it touches the floor", () => {
    const needle = box(1, 0, 1, [0.03, 1.2, 0.03], 0);
    expect(flagsOf([needle]).count).toBe(12);
  });

  it("leaves out of the count what is already left out", () => {
    const hanging = box(1, 0.9, 1, [0.3, 0.5, 0.3], 0);
    const positions = Float32Array.from(hanging.positions);
    const welded = Uint32Array.from(hanging.index);
    const skip = new Uint8Array(12);
    skip.fill(1, 0, 4);
    const out = findFloaters(positions, welded, skip, camera);
    expect(out.count).toBe(8);
    expect([...out.flags.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
  });

  it("finds only needles when it is not told where the cameras were", () => {
    const hanging = box(1, 0.9, 1, [0.3, 0.5, 0.3], 0);
    expect(findFloaters(Float32Array.from(hanging.positions), Uint32Array.from(hanging.index), null, []).count).toBe(0);
  });

  it("takes out a small piece on the floor that no panorama saw well, and keeps one that was seen", () => {
    const bin = box(2, 0, 1, [0.3, 0.6, 0.3], 0);
    const ghost = box(3, 0, 1, [0.3, 0.6, 0.3], 8);
    const positions = Float32Array.from([...bin.positions, ...ghost.positions]);
    const welded = Uint32Array.from([...bin.index, ...ghost.index]);
    const seen = new Uint8Array(24);
    seen.fill(1, 0, 12);
    const out = findFloaters(positions, welded, null, camera, undefined, seen);
    expect(out.pieces).toBe(1);
    expect([...out.flags.subarray(0, 12)]).toEqual(new Array(12).fill(0));
    expect([...out.flags.subarray(12)]).toEqual(new Array(12).fill(1));
  });
});

