// Many small pictures on a few large ones (issue 118). Pure.
//
// Each patch that closes a gap in the scan's mesh has a small texture of its
// own. A texture each would be a draw call each, thousands of them; packed
// onto a few square pages they draw as one mesh a page. Shelf packing: the
// pictures tallest first, left to right along a shelf as tall as its first,
// a new shelf when the row is full and a new page when the page is.

export interface Placement {
  page: number;
  /** The picture's corner on its page, pixels. */
  x: number;
  y: number;
}

/**
 * Where each of `sizes` (width and height, pixels) goes on pages `page`
 * pixels square, with `gutter` pixels clear round each so that neighbours do
 * not bleed into each other when the page is sampled small. The answer is
 * in the order of `sizes`. A picture larger than a page has a page to
 * itself, at its corner.
 */
export function packShelves(sizes: readonly (readonly [number, number])[], page: number, gutter: number): { placements: Placement[]; pages: number } {
  const order = sizes.map((_, i) => i).sort((a, b) => sizes[b][1] - sizes[a][1] || sizes[b][0] - sizes[a][0] || a - b);
  const placements: Placement[] = sizes.map(() => ({ page: 0, x: 0, y: 0 }));
  let at = 0;
  let x = gutter;
  let y = gutter;
  let shelf = 0;
  let used = false;
  for (const i of order) {
    const [w, h] = sizes[i];
    if (x + w + gutter > page && x > gutter) {
      // The row is full: the next shelf.
      x = gutter;
      y += shelf + gutter;
      shelf = 0;
    }
    if (y + h + gutter > page && (y > gutter || x > gutter)) {
      at++;
      x = gutter;
      y = gutter;
      shelf = 0;
    }
    placements[i] = { page: at, x, y };
    used = true;
    x += w + gutter;
    if (h > shelf) shelf = h;
  }
  return { placements, pages: used ? at + 1 : 0 };
}
