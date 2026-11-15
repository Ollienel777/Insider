// The seam between the first-person view and whatever floor it stands on
// (issue 115). The controller, the mapping to engine moves and the actors
// read a floor only through `Ground`: node positions in metres, one function
// that moves a body and stops it at what is solid, and a line-of-sight test.
// The fixture floors implement it from their room rectangles (world.ts); a
// scan's mesh (issue 118) can implement the same four things and reuse the
// rest unchanged.

export interface Vec {
  x: number;
  y: number;
}

/** A wall, a door jamb or a shut door, seen from above. */
export interface Seg {
  a: Vec;
  b: Vec;
}

export interface GroundNode extends Vec {
  id: string;
}

/** A door that can stand shut across a doorway. */
export interface GroundDoor {
  doorId: string;
  centre: Vec;
  /** The door's face across the doorway. */
  bar: Seg;
  /** The engine's edge through it: the node on each side. */
  a: string;
  b: string;
}

export interface Collision {
  pos: Vec;
  /** The velocity left once what pushes into a wall is taken out. */
  vel: Vec;
  /** The shut doors the body pressed against, each with the direction it was pushed back in. */
  pressed: readonly { doorId: string; n: Vec }[];
}

export interface Ground {
  /** Metres to one floor-plan unit, for what the level places in plan units (a camera's mount). */
  unitM: number;
  /** Every engine node's place on the floor, in metres. */
  nodes: ReadonlyMap<string, GroundNode>;
  /** The doors that can be shut. Which are shut now is the run's `locked` list, passed in. */
  doors: readonly GroundDoor[];
  /**
   * Moves a body from `pos` at `vel` for `dt`, sliding along what is solid:
   * the walls, and each door in `locked`. It never tunnels and never leaves
   * the floor.
   */
  collide(pos: Vec, vel: Vec, dt: number, locked: readonly string[]): Collision;
  /** Whether nothing solid lies on the straight line from `p` to `q`. */
  clear(p: Vec, q: Vec, locked: readonly string[]): boolean;
  /** The way to walk the engine's edge from node `a` to node `b`: through its doorway, not the wall. */
  path(a: string, b: string): Vec[];
  /**
   * The node whose area `pos` stands in, or null off the floor, or where no
   * node can be reached without crossing a wall (the walker then keeps the
   * body in the area it was in). The floor is
   * split into one area per node: each point belongs to exactly one node,
   * reachable from it without crossing a wall, and each node's area is in one
   * piece. Standing in an area is standing on that node, as the engine sees it.
   */
  regionOf(pos: Vec): string | null;
}
