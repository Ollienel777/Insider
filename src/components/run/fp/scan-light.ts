// The set's light (issue 118): what makes the flat-coloured rooms read as the
// bright, airy office the panoramas show, all worked out at load from the
// plan, with nothing of the scan's photographs drawn:
// - an occlusion field over the floor plan (how shut in each spot is by the
//   walls and furniture round it), which darkens corners, the feet of walls,
//   the ceiling's edges and the floor under and beside desks;
// - the ceiling's 2 × 4 ft troffers on the drop ceiling's grid, glowing, each
//   with a soft halo (a cheap bloom) and a pool of light on the floor and
//   walls under it;
// - windows, where the photographs saw the sky at eye height on a wall:
//   bright panes with a sky gradient, blinds and mullions, spilling light
//   onto the floor inside.
// The set's own shader (scan-photo.ts) reads the field and the lights, and
// tone maps (ACES) with an exposure set for the photographs' whites.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  RedFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector3,
} from "three";
import type { Seg, Vec } from "./ground";
import { distanceTo } from "./motion";
import { fromCellFrame, onPlanFloor, PLAN, type ScanPlan } from "./scan-plan";

/** Every number the light is tuned by. */
export const LIGHT = Object.freeze({
  /** The occlusion field's cell, metres. */
  aoCellM: 0.1,
  /** How far a wall's shadow reaches across the floor, metres, and how dark it is at the wall. */
  aoReachM: 0.35,
  aoDepth: 0.38,
  /** Under a piece of furniture, the floor's light. */
  underFurniture: 0.55,
  /** The troffers: a 2 × 4 ft panel every 8 × 8 ft of ceiling, kept off the walls. */
  panelSpacingM: 2.44,
  panelLongM: 1.22,
  panelShortM: 0.61,
  panelWallM: 0.7,
  /** Exposure before the ACES curve: the photographs' walls come out near white. */
  exposure: 1.05,
});

/** A light the shader reads: where (plan x, y), its height, its reach and strength. */
export interface SetLight {
  x: number;
  y: number;
  reach: number;
  strength: number;
}

/** The occlusion field over the floor plan, in the plan's cell frame. */
export interface Occlusion {
  texture: DataTexture;
  u0: number;
  v0: number;
  width: number;
  height: number;
}

/** Bakes the occlusion field: walls (and glass) shadow the floor near them, furniture shades under and beside it. */
export function bakeOcclusion(plan: ScanPlan): Occlusion {
  const { floor } = plan;
  const cell = LIGHT.aoCellM;
  const u0 = floor.u0;
  const v0 = floor.v0;
  const width = Math.ceil((floor.cols * floor.cell) / cell);
  const height = Math.ceil((floor.rows * floor.cell) / cell);
  const data = new Uint8Array(width * height).fill(255);
  // Walls and the furniture's edges, bucketed by 1 m squares of the plan.
  const BUCKET = 1;
  const buckets = new Map<string, { s: Seg; furniture: boolean; box?: number }[]>();
  const add = (s: Seg, furniture: boolean, box?: number) => {
    const reach = LIGHT.aoReachM * 3;
    for (let bx = Math.floor((Math.min(s.a.x, s.b.x) - reach) / BUCKET); bx <= Math.floor((Math.max(s.a.x, s.b.x) + reach) / BUCKET); bx++) {
      for (let by = Math.floor((Math.min(s.a.y, s.b.y) - reach) / BUCKET); by <= Math.floor((Math.max(s.a.y, s.b.y) + reach) / BUCKET); by++) {
        const key = `${bx}:${by}`;
        const list = buckets.get(key);
        if (list) list.push({ s, furniture, box });
        else buckets.set(key, [{ s, furniture, box }]);
      }
    }
  };
  for (const w of plan.walls) add(w, false);
  for (const g of plan.glass) add(g, false);
  plan.furniture.forEach((box, index) => box.corners.forEach((p, k) => add({ a: p, b: box.corners[(k + 1) % 4] }, true, index)));
  const inside = (p: Vec, boxes: Set<number>) =>
    [...boxes].map((k) => plan.furniture[k]).some((box) => {
      const [a, b, , d] = box.corners;
      const ab = { x: b.x - a.x, y: b.y - a.y };
      const ad = { x: d.x - a.x, y: d.y - a.y };
      const ap = { x: p.x - a.x, y: p.y - a.y };
      const s = (ap.x * ab.x + ap.y * ab.y) / (ab.x * ab.x + ab.y * ab.y || 1);
      const t = (ap.x * ad.x + ap.y * ad.y) / (ad.x * ad.x + ad.y * ad.y || 1);
      return s >= 0 && s <= 1 && t >= 0 && t <= 1;
    });
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const p = fromCellFrame(floor, u0 + (i + 0.5) * cell, v0 + (j + 0.5) * cell);
      const list = buckets.get(`${Math.floor(p.x / BUCKET)}:${Math.floor(p.y / BUCKET)}`) ?? [];
      // Light reaching the spot: each wall near it takes a share, the nearer the more.
      let light = 1;
      for (const { s, furniture } of list) {
        const d = distanceTo(s, p);
        const depth = furniture ? LIGHT.aoDepth * 0.6 : LIGHT.aoDepth;
        light *= 1 - depth * Math.exp(-d / LIGHT.aoReachM);
      }
      const boxes = new Set(list.filter((e) => e.box !== undefined).map((e) => e.box!));
      if (boxes.size > 0 && inside(p, boxes)) light *= LIGHT.underFurniture;
      data[j * width + i] = Math.round(Math.max(0, Math.min(1, light)) * 255);
    }
  }
  const texture = new DataTexture(data, width, height, RedFormat, UnsignedByteType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return { texture, u0, v0, width: width * cell, height: height * cell };
}

/** The troffers on the drop ceiling's grid, where there is floor under them and no wall too near. */
export function troffers(plan: ScanPlan): { centre: Vec; along: Vec }[] {
  const { floor } = plan;
  const step = LIGHT.panelSpacingM;
  const out: { centre: Vec; along: Vec }[] = [];
  const uB = floor.u0 + floor.cols * floor.cell;
  const vB = floor.v0 + floor.rows * floor.cell;
  const along = fromCellFrame(floor, 1, 0);
  const origin = fromCellFrame(floor, 0, 0);
  const dir = { x: along.x - origin.x, y: along.y - origin.y };
  for (let u = Math.ceil(floor.u0 / step) * step + step / 2; u < uB; u += step) {
    for (let v = Math.ceil(floor.v0 / step) * step + step / 2; v < vB; v += step) {
      const p = fromCellFrame(floor, u, v);
      if (!onPlanFloor(floor, p.x, p.y)) continue;
      if (plan.walls.some((w) => distanceTo(w, p) < LIGHT.panelWallM) || plan.glass.some((g) => distanceTo(g, p) < LIGHT.panelWallM)) continue;
      out.push({ centre: p, along: dir });
    }
  }
  return out;
}

/** The troffers drawn: glowing panels under the ceiling, each with a soft halo. */
export function trofferGroup(plan: ScanPlan, panels: readonly { centre: Vec; along: Vec }[]): Group {
  const group = new Group();
  group.name = "troffers";
  const y = plan.ceilingY - 0.008;
  const quads = (half: Vec, by: number) => {
    const positions: number[] = [];
    const uvs: number[] = [];
    for (const { centre, along } of panels) {
      const across = { x: -along.y, y: along.x };
      const corner = (a: number, b: number) => ({ x: centre.x + along.x * half.x * a * by + across.x * half.y * b * by, y: centre.y + along.y * half.x * a * by + across.y * half.y * b * by });
      const c = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
      const uv = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ];
      for (const k of [0, 1, 2, 0, 2, 3]) {
        positions.push(c[k].x, y - (by > 1 ? 0.002 : 0), c[k].y);
        uvs.push(uv[k][0], uv[k][1]);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
    return geometry;
  };
  const half = { x: LIGHT.panelLongM / 2, y: LIGHT.panelShortM / 2 };
  // The lens: bright, a touch warm, a parabolic louvre's faint cells.
  const lens = new Mesh(
    quads(half, 1),
    new ShaderMaterial({
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec2 vUv;
void main() {
  vec2 cells = abs(fract(vUv * vec2(6.0, 3.0)) - 0.5);
  float louvre = 0.93 + 0.07 * smoothstep(0.35, 0.5, max(cells.x, cells.y));
  float edge = smoothstep(0.0, 0.04, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
  gl_FragColor = vec4(mix(vec3(0.82), vec3(1.0, 0.995, 0.97) * louvre, edge), 1.0);
}`,
      side: DoubleSide,
    }),
  );
  // The halo: a soft glow round each, added on: the photographs' slight bloom.
  const halo = new Mesh(
    quads(half, 2.2),
    new ShaderMaterial({
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec2 vUv;
void main() {
  vec2 d = (vUv - 0.5) * 2.0;
  float glow = pow(max(0.0, 1.0 - length(d * vec2(1.0, 1.0))), 2.0) * 0.22;
  gl_FragColor = vec4(vec3(1.0, 0.98, 0.94) * glow, 1.0);
}`,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    }),
  );
  halo.renderOrder = 3;
  group.add(lens, halo);
  return group;
}

/** A window found on a wall face: its stretch along the face (plan points), and the face's outward normal. */
export interface SetWindow {
  a: Vec;
  b: Vec;
  n: Vec;
}

/** The windows drawn: bright panes with a sky's gradient, blinds and mullions, just in front of their wall. */
export function windowGroup(plan: ScanPlan, windows: readonly SetWindow[]): Group {
  const group = new Group();
  group.name = "windows";
  if (windows.length === 0) return group;
  const sill = plan.floorY + 0.8;
  const head = Math.min(plan.ceilingY - 0.15, plan.floorY + 2.4);
  const positions: number[] = [];
  const uvs: number[] = [];
  const widths: number[] = [];
  for (const w of windows) {
    const off = PLAN.thickM / 2 + 0.01;
    const a = { x: w.a.x + w.n.x * off, y: w.a.y + w.n.y * off };
    const b = { x: w.b.x + w.n.x * off, y: w.b.y + w.n.y * off };
    const width = Math.hypot(b.x - a.x, b.y - a.y);
    const c = [new Vector3(a.x, sill, a.y), new Vector3(b.x, sill, b.y), new Vector3(b.x, head, b.y), new Vector3(a.x, head, a.y)];
    const uv = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      positions.push(c[k].x, c[k].y, c[k].z);
      uvs.push(uv[k][0], uv[k][1]);
      widths.push(width);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setAttribute("width", new BufferAttribute(new Float32Array(widths), 1));
  const pane = new Mesh(
    geometry,
    new ShaderMaterial({
      uniforms: { uHeight: { value: head - sill } },
      vertexShader: `attribute float width; varying vec2 vUv; varying float vWidth; void main() { vUv = uv; vWidth = width; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uHeight; varying vec2 vUv; varying float vWidth;
void main() {
  // A bright hazy sky over a pale distance, through horizontal blinds half drawn.
  vec3 sky = mix(vec3(0.93, 0.95, 0.97), vec3(0.72, 0.84, 0.95), smoothstep(0.35, 1.0, vUv.y));
  vec3 c = mix(vec3(0.9, 0.9, 0.88), sky, smoothstep(0.15, 0.4, vUv.y));
  float y = vUv.y * uHeight;
  float blinds = step(0.55, vUv.y) * (0.5 + 0.5 * step(0.5, fract(y / 0.025)));
  c = mix(c, vec3(0.86, 0.86, 0.84), blinds * 0.35);
  // Mullions every 1.2 m, a frame round the edge.
  float x = vUv.x * vWidth;
  float mullion = 1.0 - smoothstep(0.02, 0.035, abs(fract(x / 1.2 + 0.5) - 0.5) * 1.2);
  float frame = 1.0 - smoothstep(0.03, 0.05, min(min(x, vWidth - x), min(y, uHeight - y)));
  c = mix(c, vec3(0.16, 0.16, 0.17), max(mullion, frame));
  gl_FragColor = vec4(c, 1.0);
}`,
      side: DoubleSide,
    }),
  );
  pane.name = "window-panes";
  group.add(pane);
  return group;
}

/** The lights for the shader: a pool under each troffer, a wider spill inside each window. */
export function setLights(panels: readonly { centre: Vec }[], windows: readonly SetWindow[]): SetLight[] {
  const out: SetLight[] = [];
  for (const w of windows) {
    const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    const steps = Math.max(1, Math.round(len / 2));
    for (let k = 0; k < steps; k++) {
      const t = (k + 0.5) / steps;
      out.push({ x: w.a.x + (w.b.x - w.a.x) * t + w.n.x * 1.2, y: w.a.y + (w.b.y - w.a.y) * t + w.n.y * 1.2, reach: 2.2, strength: 0.28 });
    }
  }
  for (const p of panels) out.push({ x: p.centre.x, y: p.centre.y, reach: 1.6, strength: 0.16 });
  return out;
}

/** The light pools baked over the same grid as the occlusion field: how much each spot of floor is lit beyond the room's own light. */
export function bakeLightField(plan: ScanPlan, lights: readonly SetLight[], occlusion: Occlusion): DataTexture {
  const { floor } = plan;
  const cell = LIGHT.aoCellM;
  const width = Math.round(occlusion.width / cell);
  const height = Math.round(occlusion.height / cell);
  const data = new Uint8Array(width * height);
  const BUCKET = 3;
  const buckets = new Map<string, SetLight[]>();
  for (const l of lights) {
    for (let bx = Math.floor((l.x - 2 * l.reach) / BUCKET); bx <= Math.floor((l.x + 2 * l.reach) / BUCKET); bx++) {
      for (let by = Math.floor((l.y - 2 * l.reach) / BUCKET); by <= Math.floor((l.y + 2 * l.reach) / BUCKET); by++) {
        const key = `${bx}:${by}`;
        const list = buckets.get(key);
        if (list) list.push(l);
        else buckets.set(key, [l]);
      }
    }
  }
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const p = fromCellFrame(floor, occlusion.u0 + (i + 0.5) * cell, occlusion.v0 + (j + 0.5) * cell);
      let lit = 0;
      for (const l of buckets.get(`${Math.floor(p.x / BUCKET)}:${Math.floor(p.y / BUCKET)}`) ?? []) {
        const d2 = (p.x - l.x) ** 2 + (p.y - l.y) ** 2;
        lit += l.strength * Math.exp(-d2 / (l.reach * l.reach));
      }
      data[j * width + i] = Math.round(Math.min(1, lit) * 255);
    }
  }
  const texture = new DataTexture(data, width, height, RedFormat, UnsignedByteType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
