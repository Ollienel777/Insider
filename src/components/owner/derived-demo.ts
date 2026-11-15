// The demo pair on a showcase building (issue 205). F1's pair is written out
// in demo-setups.ts; a showcase building's cannot be, since nothing of a kit
// building or its scan may enter the repo. So it is worked out here, in the
// browser, from the level placed on the board: the generated security as it
// stands, and the same with one camera moved or turned by a rule. Both are ordinary
// owner setups, made up for the demo, and say so on screen.
//
// The rule: of every move of one camera to a node at most two steps from where
// it hangs, facing any way, take the few whose cameras together see the most
// of the ways from the entries to the objective (then the most of the floor),
// measure each over the nights the batch plays, and keep the one that leaves
// the fewest open windows (then the most coverage). A move that does no better
// than the generated security on either is no demo: then there is no pair.
import type { FloorGraph, LevelManifest } from "@/domain";
import type { OwnerSetup } from "@/domain/owner-setup";
import { cameraCover } from "@/level/owner-setup";
import type { PlacedLevel } from "@/level/placer";
import { objectiveNoun } from "@/lib/objective-noun";
import type { DemoSetup } from "./demo-setups";
import { COMPASS, setupFromPlaced, updateCamera } from "./owner-edit";
import { measureSetup, type SetupMeasure } from "./setup-measure";

/** The demo's starting point. */
export const DERIVED_BASE_NAME = "Demo: generated security";

/** How many steps a camera may move. */
const REACH = 2;
/** How many of the best-seeing moves are measured in full. */
const SHORTLIST = 6;

type Adjacency = Map<string, string[]>;

function adjacencyOf(floor: FloorGraph): Adjacency {
  const adj: Adjacency = new Map(floor.nodes.map((n) => [n.id, []]));
  for (const e of floor.edges) {
    adj.get(e.a)?.push(e.b);
    adj.get(e.b)?.push(e.a);
  }
  return adj;
}

function hops(adj: Adjacency, from: string): Map<string, number> {
  const dist = new Map([[from, 0]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i];
    for (const next of adj.get(at) ?? []) {
      if (dist.has(next)) continue;
      dist.set(next, dist.get(at)! + 1);
      queue.push(next);
    }
  }
  return dist;
}

/** Every node on a shortest way from any entry to the objective. */
function waysIn(adj: Adjacency, placed: PlacedLevel): Set<string> {
  const toObjective = hops(adj, placed.objective.nodeId);
  const on = new Set<string>();
  for (const entry of placed.entries) {
    const fromEntry = hops(adj, entry.nodeId);
    const d = toObjective.get(entry.nodeId);
    if (d === undefined) continue;
    for (const [id, x] of fromEntry) if (x + (toObjective.get(id) ?? Infinity) === d) on.add(id);
  }
  return on;
}

/** What the setup's cameras see between them, over a whole sweep. */
function seen(floor: FloorGraph, setup: OwnerSetup): Set<string> {
  return new Set(setup.cameras.flatMap((c) => c.cover ?? cameraCover(floor, c.node, c.facing, c.kind)));
}

/** Fewer open windows, then more coverage: negative when `a` is the better setup. */
function better(a: SetupMeasure, b: SetupMeasure): number {
  const open = (m: SetupMeasure) => (m.windows.measured ? m.windows.open : Infinity);
  return open(a) !== open(b) ? open(a) - open(b) : b.coverage - a.coverage;
}

export interface DerivedPair {
  demos: readonly DemoSetup[];
  /** How long the rule took, in ms. */
  ms: number;
}

/** The showcase building's demo pair, from the level placed on its board; none when no camera move helps. */
export function derivedDemoPair(manifest: LevelManifest, floor: FloorGraph, placed: PlacedLevel): DerivedPair {
  const started = performance.now();
  const done = (demos: readonly DemoSetup[]): DerivedPair => ({ demos, ms: Math.round(performance.now() - started) });
  const base = setupFromPlaced(placed, DERIVED_BASE_NAME);
  const baseMeasure = measureSetup(manifest, floor, base);
  if (!baseMeasure || base.cameras.length === 0) return done([]);

  const adj = adjacencyOf(floor);
  const way = waysIn(adj, placed);
  const score = (s: Set<string>) => [[...s].filter((id) => way.has(id)).length, s.size] as const;
  const baseScore = score(seen(floor, base));
  const moves: { setup: OwnerSetup; cameraId: string; node: string; score: readonly [number, number] }[] = [];
  for (const camera of base.cameras) {
    const near = [...hops(adj, camera.node)].filter(([, d]) => d <= REACH).map(([id]) => id).sort();
    const others = new Set(base.cameras.filter((c) => c.id !== camera.id).map((c) => c.node));
    for (const node of near) {
      if (others.has(node)) continue;
      for (const facing of COMPASS) {
        const setup = updateCamera(base, camera.id, { node, facing });
        if (setup === base) continue;
        const s = score(seen(floor, setup));
        if (s[0] < baseScore[0] || (s[0] === baseScore[0] && s[1] <= baseScore[1])) continue;
        moves.push({ setup, cameraId: camera.id, node, score: s });
      }
    }
  }
  moves.sort((a, b) => b.score[0] - a.score[0] || b.score[1] - a.score[1]);

  let best: { move: (typeof moves)[number]; measure: SetupMeasure } | null = null;
  for (const move of moves.slice(0, SHORTLIST)) {
    const measure = measureSetup(manifest, floor, move.setup);
    if (measure && (!best || better(measure, best.measure) < 0)) best = { move, measure };
  }
  if (!best || better(best.measure, baseMeasure) >= 0) return done([]);

  const { move } = best;
  const room = floor.rooms.find((r) => r.id === floor.nodes.find((n) => n.id === move.node)?.roomId)?.label ?? move.node;
  const noun = objectiveNoun(placed.level.missionId);
  // A camera that stays where it hangs was turned, not moved, and its name says which.
  const turned = base.cameras.find((c) => c.id === move.cameraId)?.node === move.node;
  const facing = move.setup.cameras.find((c) => c.id === move.cameraId)?.facing.toUpperCase();
  const moved: OwnerSetup = { ...move.setup, name: `${DERIVED_BASE_NAME}, ${move.cameraId} ${turned ? "turned" : "moved"}` };
  return done([
    {
      setup: base,
      note: "Made up for the demo: the level's generated security, not this building's.",
    },
    {
      setup: moved,
      note: turned
        ? `The same with ${move.cameraId} turned to face ${facing}, so the cameras see more of the ways to the ${noun}.`
        : `The same with ${move.cameraId} moved into ${room}, where the cameras see more of the ways to the ${noun}.`,
    },
  ]);
}
