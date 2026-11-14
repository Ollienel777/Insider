import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { aliasRoot } from "./scripts/alias.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  resolve: {
    // The same `@/` mapping as tsconfig.json, via the gate's own resolver.
    alias: [{ find: /^@\//, replacement: `${aliasRoot(root)}/` }],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"],
    exclude: [".claude/**", "**/node_modules/**", ".next/**", "tests/smoke/**"],
  },
});
