import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// Pin the project root to this directory. In a worktree under
// .claude/worktrees/, Next.js would otherwise find the main checkout's
// lockfile above it and infer that as the root (SPEC §6, R1-M4). The gate's
// build step checks the root Next.js actually recorded.
const root = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  outputFileTracingRoot: root,
  outputFileTracingExcludes: { "*": [".claude/**"] },
  turbopack: { root },
};

export default nextConfig;
