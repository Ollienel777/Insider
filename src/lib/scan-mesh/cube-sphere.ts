// A sphere as a cube blown up round (issue 118): each of the cube's six
// faces cut into a grid, every corner pushed out to the unit sphere. Pure.
//
// A panorama is drawn on one of these, centred where it was taken, each
// vertex moved out along its direction to as far as the panorama saw that
// way: the photograph with its own depth. A cube's grid has no poles to
// pinch at, and its faces are the panorama's own.

export interface CubeSphere {
  /** A unit direction for each vertex, x y z. */
  directions: Float32Array;
  /** Three vertices a triangle. */
  index: Uint32Array;
}

/**
 * The sphere with `cells` squares along each edge of each face: six faces
 * of (cells + 1)² vertices, two triangles a square. Neighbouring faces have
 * their own copies of the vertices along the edge they share, at the same
 * directions, so no gap opens between them.
 */
export function cubeSphere(cells: number): CubeSphere {
  const n = Math.max(1, Math.floor(cells));
  const side = n + 1;
  const directions = new Float32Array(6 * side * side * 3);
  const index = new Uint32Array(6 * n * n * 6);
  // Each face: the axis it faces along, and the two it spans.
  const faces: [number[], number[], number[]][] = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
  ];
  let v = 0;
  let i = 0;
  faces.forEach(([out, a, b], face) => {
    const base = face * side * side;
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        // Evenly spaced in angle, not along the face: the squares come out nearly the same size on the sphere.
        const s = Math.tan(((x / n) * 2 - 1) * (Math.PI / 4));
        const t = Math.tan(((y / n) * 2 - 1) * (Math.PI / 4));
        const px = out[0] + a[0] * s + b[0] * t;
        const py = out[1] + a[1] * s + b[1] * t;
        const pz = out[2] + a[2] * s + b[2] * t;
        const length = Math.sqrt(px * px + py * py + pz * pz);
        directions[v++] = px / length;
        directions[v++] = py / length;
        directions[v++] = pz / length;
      }
    }
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const p = base + y * side + x;
        index[i++] = p;
        index[i++] = p + 1;
        index[i++] = p + side + 1;
        index[i++] = p;
        index[i++] = p + side + 1;
        index[i++] = p + side;
      }
    }
  });
  return { directions, index };
}
