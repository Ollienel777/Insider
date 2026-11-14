// Vitest's own `@/` resolution, checked from inside Vitest: the module this
// test imports through the alias must be this worktree's src/, not the main
// checkout's or an installed copy. Gate step 0 checks the same mapping before
// install; this proves Vitest actually applies it.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { moduleUrl } from "@/lib/locate";

describe("the @/ alias under Vitest", () => {
  it("resolves into this worktree's src/", () => {
    const top = realpathSync(
      execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim(),
    );
    const resolved = realpathSync(fileURLToPath(moduleUrl));
    expect(path.relative(top, resolved)).toBe(path.join("src", "lib", "locate.ts"));
  });
});
