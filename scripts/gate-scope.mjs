#!/usr/bin/env node
// Whether a change needs the gate (issue 130). A change that touches only docs
// no test reads does not: the workflow records it as passing without
// installing or building, so it costs under a minute of Actions time.
//
// Node built-ins only, like the gate, so it runs before `npm ci`.
//
//   printf '%s\n' path/one path/two | node scripts/gate-scope.mjs
//
// prints `code=true` or `code=false`, in the form $GITHUB_OUTPUT takes.
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Docs no test, script or build step reads. Anything not listed here needs the
 * gate, so a new doc is gated until someone adds it.
 *
 * `hackathon/DESIGN.md` must stay off this list: `src/app/tokens.test.ts`
 * holds `globals.css` to its tokens.
 */
export const UNGATED_DOCS = [
  /^README\.md$/,
  /^CLAUDE\.md$/,
  /^hackathon\/(DECISION|EVENT|README|SPEC)\.md$/,
  /^hackathon\/tracks\/.+$/,
];

/**
 * True unless every changed path is an ungated doc. No paths at all means the
 * list could not be read, and then the gate runs.
 */
export function needsGate(paths) {
  const changed = paths.map((p) => p.trim()).filter(Boolean);
  if (changed.length === 0) return true;
  return !changed.every((p) => UNGATED_DOCS.some((doc) => doc.test(p)));
}

// .native returns the on-disk case, as in gate.mjs.
const real = (p) => realpathSync.native(p);

if (process.argv[1] && real(fileURLToPath(import.meta.url)) === real(process.argv[1])) {
  const paths = readFileSync(0, "utf8").split(/\r?\n/);
  console.log(`code=${needsGate(paths)}`);
}
