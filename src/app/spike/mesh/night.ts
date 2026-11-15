// The night look for the scan (issue 198): the picture as seen by torchlight.
//
// The scan's mesh has holes and its far picture is unclear, so for the Run's
// first person the scene is dark: a torch lights a cone along the view, soft
// at its edge, and everything fades to black a few metres out. A hole, and
// whatever is wrong far away, is then in the dark. Behind the scan's own
// floor and ceiling sit a plain floor and a plain ceiling, lit by the same
// torch, so a hole in either shows a surface and not a void.
//
// Off by default: the sandbox and every other caller draw the scan as before.
// Nothing here knows any building: the heights come from the caller, who
// measures them from the mesh at runtime.
import { DoubleSide, Group, Mesh, PlaneGeometry, ShaderMaterial, Vector3, Vector4 } from "three";

export interface NightLook {
  /** How much of the picture shows where the torch does not reach, 0 to 1. */
  ambient: number;
  /** The torch's strength in the middle of its beam: 1 shows the picture as it is. */
  torch: number;
  /** Where the picture has faded to black, metres from the eye. */
  reachM: number;
  /** The torch's half angle, degrees: the beam is full inside it and soft around it. */
  coneDeg: number;
  /** The height of a plain floor under the scan's own, in the scan's space; null for none. */
  floorY: number | null;
  /** The height of a plain ceiling over the scan's own; null for none. */
  ceilingY: number | null;
}

/**
 * `nightLit(colour, world)`: `colour` at `world` under the look, or as it is
 * when the look is off. Needs three's `cameraPosition` and `viewMatrix`.
 */
export const NIGHT_GLSL = /* glsl */ `
uniform float uNight;
/** x the ambient level, y the torch's strength, z where the fade to black ends (metres), w the cosine of the torch's half angle. */
uniform vec4 uTorch;
vec3 nightLit(vec3 colour, vec3 world) {
  if (uNight < 0.5) return colour;
  vec3 toPoint = world - cameraPosition;
  float far = length(toPoint);
  vec3 forward = -normalize(vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]));
  float along = dot(toPoint / max(far, 1e-4), forward);
  // The beam: full inside the half angle, soft around it, so the frame's edge is darker than its middle.
  float beam = smoothstep(uTorch.w - 0.3, uTorch.w + 0.1, along);
  float reach = 1.0 - smoothstep(uTorch.z * 0.3, uTorch.z, far);
  float around = uTorch.x * (1.0 - smoothstep(uTorch.z * 0.5, uTorch.z * 1.2, far));
  return colour * (around + uTorch.y * beam * reach) * vec3(0.94, 0.98, 1.06);
}
`;

/** The look's uniforms for one material, off. */
export function nightUniforms(): Record<string, { value: unknown }> {
  return { uNight: { value: 0 }, uTorch: { value: new Vector4(0.1, 1.1, 9, Math.cos((34 * Math.PI) / 180)) } };
}

/** Turns the look on a material that has `nightUniforms`, or off with null. */
export function applyNight(material: ShaderMaterial, look: NightLook | null): void {
  material.uniforms.uNight.value = look ? 1 : 0;
  if (look) (material.uniforms.uTorch.value as Vector4).set(look.ambient, look.torch, look.reachM, Math.cos((look.coneDeg * Math.PI) / 180));
}

const FILL_VERTEX = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FILL_FRAGMENT = /* glsl */ `
${NIGHT_GLSL}
uniform vec3 uTone;
varying vec3 vWorld;
void main() {
  gl_FragColor = vec4(nightLit(uTone, vWorld), 1.0);
}
`;

/** A dark carpet and a dark ceiling tile: neutral, so they read as surfaces in the torch and as nothing outside it. */
const FLOOR_TONE = new Vector3(0.2, 0.19, 0.18);
const CEILING_TONE = new Vector3(0.27, 0.27, 0.26);
/** The planes' side, metres: past any scan, and past the torch's reach many times over. */
const FILL_SIDE = 2000;

/**
 * The plain floor and ceiling of a look, as one group to add to the scan's
 * scene. They are drawn with the depth test like the mesh, so the scan's own
 * surfaces, being nearer the eye, cover them wherever the scan has any.
 */
export function createNightFill(look: NightLook): { group: Group; dispose(): void } {
  const group = new Group();
  group.name = "night-fill";
  const geometry = new PlaneGeometry(FILL_SIDE, FILL_SIDE);
  const materials: ShaderMaterial[] = [];
  const plane = (y: number, tone: Vector3) => {
    const material = new ShaderMaterial({
      uniforms: { ...nightUniforms(), uTone: { value: tone } },
      vertexShader: FILL_VERTEX,
      fragmentShader: FILL_FRAGMENT,
      side: DoubleSide,
      toneMapped: false,
    });
    applyNight(material, look);
    materials.push(material);
    const mesh = new Mesh(geometry, material);
    // Flat: the plane is made upright, facing +z.
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    mesh.frustumCulled = false;
    group.add(mesh);
  };
  if (look.floorY !== null) plane(look.floorY, FLOOR_TONE);
  if (look.ceilingY !== null) plane(look.ceilingY, CEILING_TONE);
  return {
    group,
    dispose() {
      group.removeFromParent();
      geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}
