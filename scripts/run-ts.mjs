// Runs a TypeScript script against the app's own source: `node
// scripts/run-ts.mjs scripts/<name>.mts [args...]`. jiti transpiles it and
// resolves the `@/` alias the same way Next.js, tsc and Vitest do (from
// tsconfig.json, through alias.mjs), so a script imports `@/agents/...` like
// the app does.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createJiti } from "jiti";
import { aliasRoot } from "./alias.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [target, ...args] = process.argv.slice(2);
if (!target) {
  console.error("usage: node scripts/run-ts.mjs <script.mts> [args...]");
  process.exit(2);
}

const jiti = createJiti(import.meta.url, { alias: { "@/": `${aliasRoot(root)}/` }, fsCache: false });
process.argv = [process.argv[0], path.resolve(target), ...args];
await jiti.import(pathToFileURL(path.resolve(target)).href);
