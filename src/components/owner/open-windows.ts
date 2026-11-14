// Open windows (issue 120): the moments in a night when a crew could get in,
// take the objective and get back out without being seen or heard, from the
// floor plan alone. Coverage and unwatched routes ask where the watchers look
// at some point; this asks when, so a way in that is watched only part of the
// time counts for the turns it is not.
//
// The guards walk their rounds and the cameras sweep with nobody on the floor
// (the same night `watchedPositions` steps through), and the crew moves by the
// engine's own rules (`act` in src/engine/actions.ts), checked with the
// engine's own primitives:
// - a turn at turn number T: each node the crew enters (or the node it stays
//   on) is checked against T's cameras (`watched`) and the guards' sight
//   (`visibleFrom`); a sprint or a pick is then heard by any guard within the
//   level's hearing range (`hearingRange`, `withinHops`); unless the crew is
//   out, the guards move and look again at the crew's node, without cameras;
// - move one hop through an open door, wait, sprint two open hops (not to a
//   neighbour), take the objective, pick a locked door (`picksToOpen`
//   consecutive picks; a pick broken off starts over, so only whole picks are
//   searched); carrying the objective onto an exit ends the run there, with no
//   look after;
// - the run's turn limit (`AUTOPLAY_MAX_TURNS`): a way out that takes longer
//   is not a window.
// Any sighting or hearing by a guard or camera counts as being caught, though
// the engine only raises the alarm one step for it (capture needs Alert and a
// guard on the crew's node): this counts the clean nights, not the lucky ones.
// Night cleaners are left out, as in coverage: their sighting never catches.
// When the night is cut at `CYCLE_CAP`, turns past it are read as repeating it.
//
// Every start turn is answered at once: a backward search from "out with the
// objective" over (node, turn of the night, carrying, doors picked).
import { AUTOPLAY_MAX_TURNS, createRun, hearingRange, moveGuards, picksToOpen, visibleFrom, watched, withinHops } from "@/engine";
import type { Action, Level } from "@/engine";
import { cycleLength } from "./night";

export interface OpenWindow {
  /** The way in (its node). */
  entry: string;
  /** The turn of the night the crew steps in. */
  turn: number;
  /** Every node it stands on, in order, the way in first and the exit last. */
  route: string[];
  /** The engine actions that play it, one per turn: `act` on a run at that turn plays it out unseen. */
  actions: Action[];
}

export interface OpenWindows {
  /** (way in, start turn) pairs with a way in and out unseen. */
  open: number;
  /** Ways in × turns in the night. */
  moments: number;
  /** `open` as a share of `moments`, 0–100, rounded to a whole percent. */
  share: number;
  /** The earliest open window (by turn, then way in), for the line on screen; null when none is open. */
  first: OpenWindow | null;
}

/** One move of the search: the turns it takes, and the state it leaves (-1: out with the objective). */
interface Step {
  cost: number;
  to: number;
  /** Nodes entered on the way, for the route. */
  path: readonly number[];
  /** The engine actions it is, one per turn. */
  actions: readonly Action[];
}

const WIN = -1;

/** The open windows on a placed level, for its ways in (deduplicated, in order). */
export function openWindows(level: Level, entries: readonly string[], maxTurns: number = AUTOPLAY_MAX_TURNS): OpenWindows {
  const run = createRun(level);
  const { board } = run;
  const C = cycleLength(board);
  const ids = level.floor.nodes.map((n) => n.id);
  const N = ids.length;
  const index = new Map(ids.map((id, i) => [id, i]));
  const doors = [...new Set(level.lockedDoors)];
  const doorBit = new Map(doors.map((d, i) => [d, 1 << i]));
  const masks = 1 << doors.length;
  const exits = new Set(level.exits.map((id) => index.get(id)!));
  const objective = index.get(level.objective)!;

  // The night: guards at each turn 0…C (turn C closes the loop for the look after turn C-1).
  const guardsAt = [run.guards];
  for (let t = 0; t < C; t++) guardsAt.push(moveGuards(board, guardsAt[t]));
  const sight = (t: number) => {
    const seen = new Uint8Array(N);
    for (const g of guardsAt[t]) for (const id of visibleFrom(board, g)) seen[index.get(id)!] = 1;
    return seen;
  };
  const guardSight = Array.from({ length: C + 1 }, (_, t) => sight(t));
  /** Seen in the crew's half of turn t: cameras and the guards where they stand. */
  const seenNow = Array.from({ length: C }, (_, t) => {
    const seen = Uint8Array.from(guardSight[t]);
    for (const camera of board.cameras) for (const id of watched(camera, t)) seen[index.get(id)!] = 1;
    return seen;
  });
  /** Seen after turn t's guard move: the guards where they now stand, no cameras. */
  const seenAfter = (t: number) => guardSight[t + 1];
  const earshot = ids.map((id) => [...withinHops(board, id, hearingRange(board, id))].map((n) => index.get(n)!));
  /** Heard making noise on node n at turn t. */
  const heard = Array.from({ length: C }, (_, t) => {
    const at = new Set(guardsAt[t].map((g) => index.get(g.nodeId)!));
    return Uint8Array.from(earshot, (near) => (near.some((n) => at.has(n)) ? 1 : 0));
  });
  const adjacency = ids.map((id) =>
    (board.adjacency.get(id) ?? []).map((e) => ({ to: index.get(e.to)!, door: e.doorId !== undefined ? (doorBit.get(e.doorId) ?? 0) : 0, doorId: e.doorId })),
  );

  const stateOf = (n: number, t: number, carrying: number, mask: number) => ((mask * 2 + carrying) * C + t) * N + n;
  const S = N * C * 2 * masks;

  function steps(s: number): Step[] {
    const n = s % N;
    const t = Math.floor(s / N) % C;
    const carrying = Math.floor(s / (N * C)) % 2;
    const mask = Math.floor(s / (N * C * 2));
    const next = (t + 1) % C;
    const out: Step[] = [];
    const open = (door: number) => door === 0 || (mask & door) !== 0;
    /** Ends a one-turn action standing on m: out if carrying onto an exit, else the look after the guards move. */
    const land = (m: number, path: readonly number[], action: Action, took = carrying) => {
      if (took && exits.has(m)) out.push({ cost: 1, to: WIN, path, actions: [action] });
      else if (!seenAfter(t)[m]) out.push({ cost: 1, to: stateOf(m, next, took, mask), path, actions: [action] });
    };
    const now = seenNow[t];

    if (!now[n]) land(n, [], { kind: "wait" });
    if (!carrying && n === objective && !now[n]) land(n, [], { kind: "take" }, 1);
    for (const e of adjacency[n]) {
      if (!open(e.door)) continue;
      if (!now[e.to]) land(e.to, [e.to], { kind: "move", to: ids[e.to] });
    }
    // Sprint: two open hops to a node that is not a neighbour; noisy where it stops.
    const neighbours = new Set(adjacency[n].map((e) => e.to));
    const sprinted = new Set<number>();
    for (const first of adjacency[n]) {
      if (!open(first.door) || now[first.to]) continue;
      for (const second of adjacency[first.to]) {
        const m = second.to;
        if (m === n || neighbours.has(m) || !open(second.door) || now[m] || heard[t][m]) continue;
        const key = first.to * N + m;
        if (sprinted.has(key)) continue;
        sprinted.add(key);
        land(m, [first.to, m], { kind: "sprint", to: ids[m], via: ids[first.to] });
      }
    }
    // Pick: whole picks on the spot, each turn unseen, unheard and unseen after.
    for (const e of adjacency[n]) {
      if (e.door === 0 || (mask & e.door) !== 0) continue;
      const k = picksToOpen(level, e.doorId!);
      let ok = true;
      for (let i = 0; i < k && ok; i++) {
        const u = (t + i) % C;
        ok = !seenNow[u][n] && !heard[u][n] && !guardSight[u + 1][n];
      }
      const actions = Array.from({ length: k }, (): Action => ({ kind: "pick", doorId: e.doorId! }));
      if (ok) out.push({ cost: k, to: stateOf(n, (t + k) % C, carrying, mask | e.door), path: [], actions });
    }
    return out;
  }

  // Backward: the fewest turns from each state to out with the objective.
  // Each predecessor is kept with its step's cost, packed as state × 64 + cost (a pick takes far fewer than 64 turns).
  const reverse: number[][] = Array.from({ length: S }, () => []);
  const winners: number[] = [];
  for (let s = 0; s < S; s++) {
    for (const step of steps(s)) {
      if (step.to === WIN) winners.push(s);
      else reverse[step.to].push(s * 64 + Math.min(step.cost, 63));
    }
  }
  const dist = new Float64Array(S).fill(Infinity);
  const buckets: number[][] = [];
  const push = (s: number, d: number) => {
    if (d >= dist[s] || d > maxTurns) return;
    dist[s] = d;
    (buckets[d] ??= []).push(s);
  };
  for (const s of winners) push(s, 1);
  for (let d = 1; d < buckets.length; d++) {
    for (const s of buckets[d] ?? []) {
      if (dist[s] !== d) continue;
      for (const packed of reverse[s]) push(Math.floor(packed / 64), d + (packed % 64));
    }
  }

  const ways = [...new Set(entries)].filter((id) => index.has(id));
  let open = 0;
  let first: OpenWindow | null = null;
  for (let t = 0; t < C; t++) {
    for (const entry of ways) {
      const s = stateOf(index.get(entry)!, t, 0, 0);
      if (dist[s] > maxTurns) continue;
      open++;
      first ??= { entry, turn: t, ...routeFrom(s) };
    }
  }

  /** The route a shortest open window takes from state s: each next step the one on a shortest way out. */
  function routeFrom(start: number): { route: string[]; actions: Action[] } {
    const route = [start % N];
    const actions: Action[] = [];
    let s = start;
    while (s !== WIN) {
      const d = dist[s];
      const step = steps(s).find((st) => (st.to === WIN ? d === st.cost : dist[st.to] + st.cost === d))!;
      for (const n of step.path) if (route[route.length - 1] !== n) route.push(n);
      actions.push(...step.actions);
      s = step.to;
    }
    return { route: route.map((i) => ids[i]), actions };
  }

  const moments = ways.length * C;
  return { open, moments, share: moments === 0 ? 0 : Math.round((100 * open) / moments), first };
}
