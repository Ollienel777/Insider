// Sight drawn as light (issue 146): a guard's flashlight and a camera's cone.
//
// - `Flashlight`: a lens and a faint volumetric cone, pointing along its
//   group's +x. It draws no real light of its own, so any number cost little.
// - `FlashlightRig`: a few real spotlights, lent each frame to the
//   flashlights nearest the player, so the floor and the walls in front of
//   those guards really light up. The count never changes while it runs
//   (three.js recompiles every material when it does); once, if the frame
//   rate drops, the rig takes its lights away and the cones stay, unlit.
// - `sightCone`: the same faint cone for a camera, along +z, its holder's
//   forward.
//
// Each is a plain three.js object with no tie to the run or the floor, so a
// scan's scene (issue 118) can add them as they are.
import {
  AdditiveBlending,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  ShaderMaterial,
  SpotLight,
  Vector3,
  type BufferGeometry,
} from "three";

/**
 * An open cone with its tip at the origin and its mouth `length` along +x
 * (or +z), `halfAngle` wide, carrying `along`: 0 at the tip, 1 at the mouth.
 */
export function coneGeometry(length: number, halfAngle: number, axis: "x" | "z" = "x"): BufferGeometry {
  const geometry = new ConeGeometry(Math.tan(halfAngle) * length, length, 20, 4, true);
  // ConeGeometry's tip is at +y/2: put it at the origin, the mouth down -y, then turn -y to the axis.
  geometry.translate(0, -length / 2, 0);
  if (axis === "x") geometry.rotateZ(Math.PI / 2);
  else geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute("position");
  const along = new Float32Array(position.count);
  for (let i = 0; i < position.count; i++) {
    along[i] = Math.min(1, Math.abs(axis === "x" ? position.getX(i) : position.getZ(i)) / length);
  }
  geometry.setAttribute("along", new Float32BufferAttribute(along, 1));
  return geometry;
}

/** The cone's glow: brightest at the lens, gone at the mouth, softest at its edges. Additive, so it only adds light. */
export function beamMaterial(colour: Color, opacity: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { colour: { value: colour.clone() }, opacity: { value: opacity } },
    vertexShader: /* glsl */ `
      attribute float along;
      varying float vAlong;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vAlong = along;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 colour;
      uniform float opacity;
      varying float vAlong;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float edge = pow(abs(dot(normalize(vNormal), normalize(vView))), 1.6);
        float fall = pow(1.0 - vAlong, 1.3);
        gl_FragColor = vec4(colour, opacity * edge * fall);
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
}

/** A beam's opacity in the cone shader, and the real light's strength, by default. */
export const BEAM_OPACITY = 0.22;
export const SPOT_INTENSITY = 26;

export interface FlashlightOptions {
  colour: Color;
  /** How far the light reaches at most, in metres. */
  range: number;
  /** Half the cone's angle, in radians. */
  halfAngle: number;
}

export class Flashlight {
  readonly group = new Group();
  readonly range: number;
  readonly halfAngle: number;
  private readonly beam: Mesh;
  private readonly material: ShaderMaterial;
  private readonly lens: Mesh;
  private readonly lensMaterial: MeshBasicMaterial;
  private readonly geometries: BufferGeometry[];
  /** How far the beam reaches now: short of the first wall, when the owner says where that is. */
  reach: number;

  constructor(opts: FlashlightOptions) {
    this.range = opts.range;
    this.halfAngle = opts.halfAngle;
    this.reach = opts.range;
    const coneShape = coneGeometry(1, opts.halfAngle);
    const lensShape = new CylinderGeometry(0.045, 0.035, 0.16, 8);
    lensShape.rotateZ(Math.PI / 2);
    this.geometries = [coneShape, lensShape];
    this.material = beamMaterial(opts.colour, BEAM_OPACITY);
    this.beam = new Mesh(coneShape, this.material);
    this.beam.scale.setScalar(opts.range);
    this.beam.renderOrder = 2;
    this.beam.frustumCulled = false;
    this.lensMaterial = new MeshBasicMaterial({ color: opts.colour });
    this.lens = new Mesh(lensShape, this.lensMaterial);
    this.group.add(this.lens, this.beam);
  }

  /** Shortens the beam to `metres` (a wall in the way); its width at the mouth keeps the same angle. */
  setReach(metres: number): void {
    this.reach = Math.max(0.3, Math.min(this.range, metres));
    this.beam.scale.setScalar(this.reach);
  }

  setColour(colour: Color, opacity = BEAM_OPACITY): void {
    (this.material.uniforms.colour.value as Color).copy(colour);
    this.material.uniforms.opacity.value = opacity;
    this.lensMaterial.color.copy(colour);
  }

  /** The beam's colour now. */
  get colour(): Color {
    return this.material.uniforms.colour.value as Color;
  }

  /** Where the beam starts and which way it points, in world space. */
  aim(origin: Vector3, direction: Vector3): void {
    this.group.updateWorldMatrix(true, false);
    this.group.getWorldPosition(origin);
    direction.set(1, 0, 0).transformDirection(this.group.matrixWorld);
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.material.dispose();
    this.lensMaterial.dispose();
    this.group.removeFromParent();
  }
}

/** A camera's cone, `length` along +z from its lens, for its holder to carry. */
export function sightCone(length: number, halfAngle: number, colour: Color): { mesh: Mesh; material: ShaderMaterial; dispose: () => void } {
  const geometry = coneGeometry(length, halfAngle, "z");
  const material = beamMaterial(colour, BEAM_OPACITY);
  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return {
    mesh,
    material,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

/** Frames seen before the rate is judged: the first second or two after a load is never steady. */
export const WATCH_WARMUP_S = 3;
/** The window the rate is averaged over. */
export const WATCH_WINDOW_S = 2;
/** Below this, the real lights go. */
export const WATCH_MIN_FPS = 32;

/**
 * Watches the frame rate and says, once, when it has dropped too low for
 * real lights. Pure but for the state it keeps: fed each frame's `dt`.
 */
export class FrameRateWatch {
  private elapsed = 0;
  private window: number[] = [];
  private sum = 0;
  dropped = false;

  /** Feeds a frame's length in seconds. True the one time the rate is first found too low. */
  frame(dt: number): boolean {
    if (this.dropped) return false;
    this.elapsed += dt;
    if (this.elapsed < WATCH_WARMUP_S) return false;
    this.window.push(dt);
    this.sum += dt;
    while (this.sum > WATCH_WINDOW_S && this.window.length > 1) this.sum -= this.window.shift()!;
    if (this.sum < WATCH_WINDOW_S * 0.9) return false;
    const fps = this.window.length / this.sum;
    if (fps < WATCH_MIN_FPS) {
      this.dropped = true;
      return true;
    }
    return false;
  }

  /** The average rate over the last window, for a readout. */
  get fps(): number {
    return this.sum > 0 ? this.window.length / this.sum : 0;
  }
}

/** A few real spotlights, lent each frame to the flashlights nearest the player. */
export class FlashlightRig {
  readonly group = new Group();
  private readonly lights: SpotLight[] = [];
  private on = true;
  private readonly origin = new Vector3();
  private readonly direction = new Vector3();

  constructor(count: number, colour: Color) {
    this.group.name = "flashlight-rig";
    for (let i = 0; i < count; i++) {
      const light = new SpotLight(colour, 0, 10, 0.4, 0.45, 1.6);
      const target = new Object3D();
      light.target = target;
      this.group.add(light, target);
      this.lights.push(light);
    }
  }

  /** Whether the rig still has its lights. */
  get lit(): boolean {
    return this.on;
  }

  /** Takes the lights away for good: the cones stay, unlit. */
  drop(): void {
    if (!this.on) return;
    this.on = false;
    for (const light of this.lights) {
      this.group.remove(light, light.target);
      light.dispose();
    }
  }

  /** Lends the lights to the first of `flashlights` (nearest first); the rest stay dark, the spare lights at nothing. */
  assign(flashlights: readonly Flashlight[], intensity = SPOT_INTENSITY): void {
    if (!this.on) return;
    this.lights.forEach((light, i) => {
      const f = flashlights[i];
      if (!f) {
        light.intensity = 0;
        return;
      }
      f.aim(this.origin, this.direction);
      light.position.copy(this.origin);
      light.target.position.copy(this.origin).addScaledVector(this.direction, f.reach);
      light.angle = f.halfAngle * 1.15;
      // A little past the beam's end, so the wall it stops on is lit.
      light.distance = f.reach + 0.4;
      light.intensity = intensity;
      light.color.copy(f.colour);
    });
  }

  dispose(): void {
    this.drop();
    this.group.removeFromParent();
  }
}
