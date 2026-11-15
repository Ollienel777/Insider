// A made-up mesh: one square of floor, written the ways an OBJ file may.
import { describe, expect, it } from "vitest";
import { parseObj } from "./obj";

describe("parseObj", () => {
  it("reads vertices y-up and triangles zero-based", () => {
    const mesh = parseObj(["v 0 0 0", "v 2 0 0", "v 2 3 0", "v 0 3 1", "f 1 2 3", "f 1 3 4"].join("\n"));
    // z-up (x, y, z) becomes (x, z, -y).
    expect([...mesh.positions]).toEqual([0, 0, 0, 2, 0, 0, 2, 0, -3, 0, 1, -3]);
    expect([...mesh.index]).toEqual([0, 1, 2, 0, 2, 3]);
    expect(mesh.bounds).toEqual({ min: [0, 0, -3], max: [2, 1, 0] });
  });

  it("fans a face with more than three corners into triangles", () => {
    const mesh = parseObj("v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n");
    expect([...mesh.index]).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it("takes the vertex number out of v/vt/vn corners, and counts negative ones from the end", () => {
    const mesh = parseObj("v 0 0 0\nv 1 0 0\nv 1 1 0\nf 1/5/9 2//7 3/2\nf -3 -2 -1\n");
    expect([...mesh.index]).toEqual([0, 1, 2, 0, 1, 2]);
  });

  it("ignores groups, comments, normals, texture coordinates, and Windows line ends", () => {
    const text = "# made up\r\ng room\r\nv 0 0 0\r\nvn 0 0 1\r\nvt 0.5 0.5\r\nv 1 0 0\r\nv 0 1 0\r\nusemtl x\r\nf 1 2 3\r\n";
    const mesh = parseObj(text);
    expect(mesh.positions.length).toBe(9);
    expect([...mesh.index]).toEqual([0, 1, 2]);
  });

  it("drops a face that points at a vertex that isn't there", () => {
    const mesh = parseObj("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 9\nf 1 2 3\n");
    expect([...mesh.index]).toEqual([0, 1, 2]);
  });

  it("is empty, with no bounds, for an empty file", () => {
    const mesh = parseObj("");
    expect(mesh.positions.length).toBe(0);
    expect(mesh.index.length).toBe(0);
    expect(mesh.bounds).toBeNull();
  });
});
