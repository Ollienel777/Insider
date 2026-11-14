import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { demoReset, EPOCH_PATH } from "./demo-reset.mjs";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "demo-reset.mjs");

/** A throwaway git repo with one committed cached level. */
function repo() {
  const root = mkdtempSync(path.join(os.tmpdir(), "heist-reset-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "test");
  // Hermetic line endings: a global core.autocrlf=true would restore CRLF.
  git("config", "core.autocrlf", "false");
  mkdirSync(path.join(root, "data", "levels"), { recursive: true });
  writeFileSync(path.join(root, "data", "levels", "F1.json"), '{"buildingId":"F1"}\n');
  writeFileSync(path.join(root, "data", "levels", "F1.trace.json"), '{"steps":[]}\n');
  writeFileSync(path.join(root, ".gitignore"), ".heist/\n");
  git("add", ".");
  git("commit", "-q", "-m", "levels");
  return root;
}

describe("npm run demo:reset", () => {
  let root;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("restores edited and deleted cached levels, removes untracked ones, and writes a new epoch", () => {
    root = repo();
    const levels = path.join(root, "data", "levels");
    writeFileSync(path.join(levels, "F1.json"), '{"buildingId":"F1","rebuilt":true}\n');
    rmSync(path.join(levels, "F1.trace.json"));
    writeFileSync(path.join(levels, "F2.json"), "{}\n");

    const result = demoReset({ root, now: () => new Date("2026-11-15T12:00:00.000Z") });

    expect(result.restored.sort()).toEqual(["data/levels/F1.json", "data/levels/F1.trace.json"]);
    expect(result.removed).toEqual(["data/levels/F2.json"]);
    expect(readFileSync(path.join(levels, "F1.json"), "utf8")).toBe('{"buildingId":"F1"}\n');
    expect(existsSync(path.join(levels, "F1.trace.json"))).toBe(true);
    expect(existsSync(path.join(levels, "F2.json"))).toBe(false);
    expect(existsSync(path.join(root, result.trash, "data", "levels", "F2.json"))).toBe(true);
    expect(readFileSync(path.join(root, EPOCH_PATH), "utf8")).toBe("2026-11-15T12:00:00.000Z\n");
  });

  it("deletes nothing: the edited and untracked levels are kept under .heist/trash/, and it says where (R1-M1)", () => {
    root = repo();
    const levels = path.join(root, "data", "levels");
    writeFileSync(path.join(levels, "F1.json"), '{"buildingId":"F1","rebuilt":true}\n');
    mkdirSync(path.join(levels, "new"));
    writeFileSync(path.join(levels, "new", "F2.json"), '{"buildingId":"F2"}\n');

    const result = demoReset({ root, now: () => new Date("2026-11-15T12:00:00.000Z") });

    expect(result.trash).toBe(path.join(".heist", "trash", "2026-11-15T12-00-00-000Z"));
    const kept = path.join(root, result.trash);
    expect(readFileSync(path.join(kept, "data", "levels", "F1.json"), "utf8")).toBe('{"buildingId":"F1","rebuilt":true}\n');
    expect(readFileSync(path.join(kept, "data", "levels", "new", "F2.json"), "utf8")).toBe('{"buildingId":"F2"}\n');
    expect(existsSync(path.join(levels, "new", "F2.json"))).toBe(false);
    // The trash is gitignored: the tree is clean.
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" })).toBe("");
  });

  it("touches nothing outside data/levels/ and removes no committed file", () => {
    root = repo();
    const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
    mkdirSync(path.join(root, "data", "other"), { recursive: true });
    writeFileSync(path.join(root, "data", "other", "kept.json"), "committed\n");
    writeFileSync(path.join(root, "data", "levels.json"), "committed\n");
    git("add", ".");
    git("commit", "-q", "-m", "more");
    // Edits and untracked files beside the levels, under a prefix that looks alike.
    writeFileSync(path.join(root, "data", "other", "kept.json"), "edited\n");
    writeFileSync(path.join(root, "data", "levels.json"), "edited\n");
    writeFileSync(path.join(root, "data", "levels-draft.json"), "untracked\n");
    writeFileSync(path.join(root, "notes.txt"), "untracked\n");

    const result = demoReset({ root });

    expect(result).toMatchObject({ restored: [], removed: [], trash: null });
    expect(readFileSync(path.join(root, "data", "other", "kept.json"), "utf8")).toBe("edited\n");
    expect(readFileSync(path.join(root, "data", "levels.json"), "utf8")).toBe("edited\n");
    expect(readFileSync(path.join(root, "data", "levels-draft.json"), "utf8")).toBe("untracked\n");
    expect(readFileSync(path.join(root, "notes.txt"), "utf8")).toBe("untracked\n");
    for (const file of git("ls-files").split("\n").filter(Boolean)) expect(existsSync(path.join(root, file))).toBe(true);
  });

  it("on a clean tree changes nothing but the epoch, and each run writes a new one", () => {
    root = repo();
    const first = demoReset({ root, now: () => new Date("2026-11-15T12:00:00.000Z") });
    const second = demoReset({ root, now: () => new Date("2026-11-15T12:00:01.000Z") });
    expect(first).toMatchObject({ restored: [], removed: [] });
    expect(second.epoch).not.toBe(first.epoch);
    expect(readFileSync(path.join(root, EPOCH_PATH), "utf8").trim()).toBe(second.epoch);
  });

  it("runs from the command line and reports what it did", () => {
    // Run on a copy: the script resets the repository it lives in.
    root = repo();
    mkdirSync(path.join(root, "scripts"));
    writeFileSync(path.join(root, "scripts", "demo-reset.mjs"), readFileSync(script));
    const run = spawnSync(process.execPath, [path.join(root, "scripts", "demo-reset.mjs")], { encoding: "utf8" });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("demo:reset: cached levels: 0 restored, 0 removed");
    expect(run.stdout).toContain("reload the demo browser");
    expect(existsSync(path.join(root, EPOCH_PATH))).toBe(true);
  });
});
