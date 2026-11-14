#!/usr/bin/env node
// Checks hand-authored floor fixtures (fixtures/floors/*.json) for the graph
// properties the zod schema cannot express: the board is connected, every
// sightline names real nodes, every sightline is symmetric, and every edge
// that crosses rooms carries a door. Schema validity itself is checked by the
// unit tests against `FloorGraph`.
//
//   node scripts/check-floor.mjs                 every fixtures/floors/*.json
//   node scripts/check-floor.mjs path/to/F1.json one or more files
//
// Node built-ins only. Exits 1 and lists each problem when any file fails.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The problems with one floor graph, as human-readable lines; empty when it
 * passes. `oneWay` lists sightlines allowed to be one-way, as `"from>to"`.
 * @param {{ nodes?: {id: string, roomId: string}[], edges?: {a: string, b: string, door?: unknown}[], sightlines?: Record<string, string[]> }} graph
 * @param {{ oneWay?: Iterable<string> }} [options]
 * @returns {string[]}
 */
export function checkFloor(graph, { oneWay = [] } = {}) {
  const problems = [];
  const nodes = graph.nodes ?? [];
  const edges = graph.edges ?? [];
  const sightlines = graph.sightlines ?? {};
  const allowed = new Set(oneWay);
  const roomOf = new Map(nodes.map((n) => [n.id, n.roomId]));

  if (nodes.length === 0) return ["the floor has no nodes"];

  const adjacent = new Map(nodes.map((n) => [n.id, []]));
  for (const { a, b, door } of edges) {
    if (!roomOf.has(a) || !roomOf.has(b)) {
      problems.push(`edge ${a}–${b} ends at an unknown node`);
      continue;
    }
    adjacent.get(a).push(b);
    adjacent.get(b).push(a);
    if (roomOf.get(a) !== roomOf.get(b) && !door) {
      problems.push(`edge ${a}–${b} crosses from ${roomOf.get(a)} to ${roomOf.get(b)} without a door`);
    }
  }

  const start = nodes[0].id;
  const reached = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    for (const next of adjacent.get(queue.shift())) {
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }
  const unreached = nodes.map((n) => n.id).filter((id) => !reached.has(id));
  if (unreached.length > 0) {
    problems.push(`not connected: ${unreached.join(", ")} cannot be reached from ${start}`);
  }

  for (const [from, seen] of Object.entries(sightlines)) {
    if (!roomOf.has(from)) problems.push(`sightline from unknown node ${from}`);
    for (const to of seen) {
      if (!roomOf.has(to)) {
        problems.push(`sightline ${from} → ${to} targets an unknown node`);
      } else if (to === from) {
        problems.push(`sightline ${from} → ${from} sees itself`);
      } else if (!(sightlines[to] ?? []).includes(from) && !allowed.has(`${from}>${to}`)) {
        problems.push(`sightline ${from} → ${to} is one-way and not listed as such`);
      }
    }
  }
  return problems;
}

function main(argv) {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const dir = path.join(root, "fixtures", "floors");
  const files =
    argv.length > 0
      ? argv
      : readdirSync(dir)
          .filter((f) => f.endsWith(".json"))
          .sort()
          .map((f) => path.join(dir, f));
  let failed = 0;
  for (const file of files) {
    let problems;
    try {
      problems = checkFloor(JSON.parse(readFileSync(file, "utf8")));
    } catch (error) {
      problems = [`cannot read: ${error instanceof Error ? error.message : String(error)}`];
    }
    const name = path.relative(process.cwd(), file);
    if (problems.length === 0) {
      console.log(`check-floor: ${name}: ok`);
    } else {
      failed += 1;
      console.error(`check-floor: ${name}: ${problems.length} problem(s)`);
      for (const p of problems) console.error(`  - ${p}`);
    }
  }
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
