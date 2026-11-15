import { describe, expect, it } from "vitest";
import { distanceToGroup, parseMtl, parseTexturedObj } from "./textured";

const MTL = `
newmtl wall
map_Ka wall.jpg
map_Kd wall.jpg

newmtl floor
map_Kd -s 1 1 1 textures\\floor.jpg
newmtl bare
`;

// Two squares, z-up: a floor (z = 0) and a wall (y = 2), sharing the edge
// from vertex 3 to vertex 4 but not its texture coordinates there.
const OBJ = `mtllib room.mtl
v 0 0 0
v 2 0 0
v 2 2 0
v 0 2 0
v 0 2 2
v 2 2 2
vt 0 0
vt 1 0
vt 1 1
vt 0 1
vt 0.5 0.25
usemtl floor
f 1/1 2/2 3/3
f 1/1 3/3 4/4
usemtl wall
f 4/5 3/2 6/3 5/4
usemtl floor
f -6/1 -4/3 -3/4
`;

describe("parseMtl", () => {
  it("maps each material to its texture's file name, without folders or options", () => {
    expect([...parseMtl(MTL)]).toEqual([
      ["wall", "wall.jpg"],
      ["floor", "floor.jpg"],
    ]);
  });
});

describe("parseTexturedObj", () => {
  const mesh = parseTexturedObj(OBJ, parseMtl(MTL));

  it("puts each material's triangles in one run, in order of first use", () => {
    expect(mesh.groups.map((g) => [g.image, g.start, g.count])).toEqual([
      ["floor.jpg", 0, 9],
      ["wall.jpg", 9, 6],
    ]);
    expect(mesh.index.length).toBe(15);
  });

  it("splits a vertex once per texture coordinate it has, and no more", () => {
    // Floor: 4 (vertex, coordinate) pairs; wall: 4 more, none shared with the floor's.
    expect(mesh.positions.length / 3).toBe(8);
    expect(mesh.uvs.length / 2).toBe(8);
  });

  it("turns positions y-up and flips v", () => {
    const corner = (i: number) => [...mesh.positions.subarray(i * 3, i * 3 + 3)];
    const uv = (i: number) => [...mesh.uvs.subarray(i * 2, i * 2 + 2)];
    // The floor's third corner is z-up (2, 2, 0), y-up (2, 0, -2), at coordinate (1, 1).
    const third = mesh.index[2];
    expect(corner(third)).toEqual([2, 0, -2]);
    expect(uv(third)).toEqual([1, 0]);
    // The wall's first corner is vertex 4 at coordinate (0.5, 0.25).
    const wall = mesh.index[9];
    expect(corner(wall)).toEqual([0, 0, -2]);
    expect(uv(wall)).toEqual([0.5, 0.75]);
  });

  it("keeps the welded mesh: the OBJ's own vertices and the triangles over them", () => {
    expect(mesh.vertices.length).toBe(18);
    expect([...mesh.welded]).toEqual([0, 1, 2, 0, 2, 3, 0, 2, 3, 3, 2, 5, 3, 5, 4]);
  });

  it("boxes each group, y-up", () => {
    expect(mesh.groups[1].centre).toEqual([1, 1, -2]);
    expect(mesh.groups[1].extent).toEqual([1, 1, 0]);
    expect(distanceToGroup(mesh.groups[1], [1, 1, 0])).toBeCloseTo(2, 6);
    expect(distanceToGroup(mesh.groups[1], [1, 1, -2])).toBe(0);
  });

  it("reads faces with no material or no coordinates", () => {
    const bare = parseTexturedObj("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\nf 1//1 2//1 3//1\n");
    expect(bare.groups).toHaveLength(1);
    expect(bare.groups[0].image).toBeNull();
    expect(bare.index.length).toBe(6);
    expect(bare.positions.length / 3).toBe(3);
  });
});
