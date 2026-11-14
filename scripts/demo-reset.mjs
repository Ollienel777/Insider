#!/usr/bin/env node
// `npm run demo:reset`: back to a clean demo between rehearsals and before
// the pitch (SPEC §2).
//
// 1. The cached levels in data/levels/ go back to the committed versions:
//    edited files are restored, and files git does not track are taken out.
//    Nothing is deleted: the edited and untracked files are moved to
//    .heist/trash/<epoch>/ (gitignored) first, so a level built with
//    `npm run build:levels` and not yet committed can be put back. Nothing
//    outside data/levels/ is touched, and no committed file is removed.
// 2. A new demo epoch is written to .heist/demo-epoch (gitignored). The
//    running server sees it on its next page or API call and forgets every
//    live failure; the browser, on its next page load, clears what it kept of
//    earlier runs (run logs, crew plans, fallbacks seen) and any service
//    forced to fixtures in the demo settings. The debrief then shows its
//    empty state.
//
// No restart is needed. Node built-ins and git only.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const LEVELS = "data/levels";
export const EPOCH_PATH = path.join(".heist", "demo-epoch");
export const TRASH_DIR = path.join(".heist", "trash");

/**
 * Resets the demo state under `root`. Returns what it changed, and where the
 * files it took out went (`trash`, relative to `root`; null when none).
 * @param {{ root: string, now?: () => Date }} options
 * @returns {{ restored: string[], removed: string[], epoch: string, trash: string | null }}
 */
export function demoReset({ root, now = () => new Date() }) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const lines = (text) => text.split("\n").filter(Boolean);
  // git scopes both listings to data/levels/; this keeps it so whatever git prints.
  const inLevels = (file) => file.startsWith(`${LEVELS}/`) && !file.split("/").includes("..");

  const epoch = now().toISOString();
  const trash = path.join(TRASH_DIR, epoch.replace(/[:.]/g, "-"));
  let trashed = false;
  const toTrash = (file, move) => {
    const target = path.join(root, trash, file);
    mkdirSync(path.dirname(target), { recursive: true });
    (move ? renameSync : copyFileSync)(path.join(root, file), target);
    trashed = true;
  };

  const restored = lines(git("diff", "--name-only", "HEAD", "--", LEVELS)).filter(inLevels);
  for (const file of restored) {
    // An edited file is kept as it was; a deleted one has nothing to keep.
    if (existsSync(path.join(root, file))) toTrash(file, false);
  }
  if (restored.length > 0) git("checkout", "HEAD", "--", LEVELS);
  const removed = lines(git("ls-files", "--others", "--exclude-standard", "--", LEVELS)).filter(inLevels);
  for (const file of removed) toTrash(file, true);

  mkdirSync(path.join(root, path.dirname(EPOCH_PATH)), { recursive: true });
  writeFileSync(path.join(root, EPOCH_PATH), `${epoch}\n`);
  return { restored, removed, epoch, trash: trashed ? trash : null };
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { restored, removed, epoch, trash } = demoReset({ root });
  console.log(`demo:reset: cached levels: ${restored.length} restored, ${removed.length} removed`);
  for (const file of restored) console.log(`  restored ${file}`);
  for (const file of removed) console.log(`  removed  ${file}`);
  if (trash) console.log(`demo:reset: the previous copies are kept in ${trash.split(path.sep).join("/")}/`);
  console.log(`demo:reset: new demo epoch ${epoch}`);
  console.log("demo:reset: reload the demo browser; its next page clears run logs, crew plans and forced fixtures.");
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
