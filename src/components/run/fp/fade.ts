// The floor's watched-node markings, cross-faded from one turn to the next
// (issue 115). Each turn's markings come in as the last turn's go out, over
// the turn's length, so a disc that moves seems to slide rather than jump.
// Under `prefers-reduced-motion` the new ones are there at once.
//
// It owns the meshes it is handed: their geometry, and the copy of the
// material each is drawn with (the opacity is the mesh's own).
import type { Group, Material, Mesh, MeshBasicMaterial } from "three";

/** How far a fade of `ms` milliseconds is, `elapsedMs` in: 0 to 1, eased in and out. */
export function fadeProgress(elapsedMs: number, ms: number): number {
  if (ms <= 0) return 1;
  const k = Math.min(1, Math.max(0, elapsedMs / ms));
  return k * k * (3 - 2 * k);
}

type Flat = Mesh & { material: MeshBasicMaterial };

export class CrossFade {
  private incoming: { mesh: Flat; to: number }[] = [];
  private outgoing: { mesh: Flat; from: number }[] = [];
  private at = 0;

  constructor(
    private readonly group: Group,
    /** The fade's length in milliseconds: a turn. */
    private readonly ms: number,
    /** Under `prefers-reduced-motion`: no fade. */
    private readonly still: boolean,
  ) {}

  /**
   * This turn's markings, each a mesh and the material it is drawn with, at
   * its full opacity. The material is copied. The last turn's start going out
   * from wherever their fade had got to.
   */
  show(meshes: readonly { mesh: Mesh; material: MeshBasicMaterial }[], now: number): void {
    for (const { mesh } of this.outgoing) this.drop(mesh);
    this.outgoing = this.incoming.map(({ mesh }) => ({ mesh, from: mesh.material.opacity }));
    this.incoming = meshes.map(({ mesh, material }) => {
      const own = material.clone();
      const to = material.opacity;
      own.opacity = this.still ? to : 0;
      mesh.material = own;
      this.group.add(mesh);
      return { mesh: mesh as Flat, to };
    });
    this.at = now;
    this.update(now);
  }

  /** Advances the fade to `now`. */
  update(now: number): void {
    const k = fadeProgress(now - this.at, this.still ? 0 : this.ms);
    for (const { mesh, to } of this.incoming) mesh.material.opacity = to * k;
    for (const { mesh, from } of this.outgoing) mesh.material.opacity = from * (1 - k);
    if (k >= 1 && this.outgoing.length > 0) {
      for (const { mesh } of this.outgoing) this.drop(mesh);
      this.outgoing = [];
    }
  }

  /** Every mesh it holds now, coming in and going out. */
  get meshes(): readonly Mesh[] {
    return [...this.outgoing, ...this.incoming].map(({ mesh }) => mesh);
  }

  dispose(): void {
    for (const { mesh } of [...this.outgoing, ...this.incoming]) this.drop(mesh);
    this.incoming = [];
    this.outgoing = [];
  }

  private drop(mesh: Mesh): void {
    mesh.geometry.dispose();
    (mesh.material as Material).dispose();
    this.group.remove(mesh);
  }
}
