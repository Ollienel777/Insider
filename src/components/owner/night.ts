// The night a setup is measured over (issue 120): one full turn of every
// guard's round and every camera's sweep, with nobody on the floor.
import { roundOf } from "@/engine/autoplay";
import type { Board } from "@/engine";

/**
 * The longest cycle `cycleLength` reports. A night is the least common
 * multiple of every guard's round (its hops times its tempo) and every
 * camera's sweep (2 or 3 turns); with odd round lengths that can grow large,
 * so it stops at 240 turns. Coverage steps no further than an attempt lasts
 * (`AUTOPLAY_MAX_TURNS`, 120 turns).
 */
export const CYCLE_CAP = 240;

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const lcm = (a: number, b: number) => (a / gcd(a, b)) * b;

/** The night's length on this board: the least common multiple of the rounds and sweeps, capped. */
export function cycleLength(board: Board): number {
  const { level } = board;
  const tempo = (id: string) => level.guardTempo?.[id] ?? level.patrolTempo;
  const lengths = [
    ...level.guards.map((g) => roundOf(board, g.patrol).length * tempo(g.id)),
    ...board.cameras.map((c) => c.parts.length),
  ];
  let cycle = 1;
  for (const n of lengths) {
    cycle = lcm(cycle, Math.max(1, n));
    if (cycle >= CYCLE_CAP) return CYCLE_CAP;
  }
  return cycle;
}

