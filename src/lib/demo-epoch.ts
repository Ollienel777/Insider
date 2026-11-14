// The demo epoch: `npm run demo:reset` writes a new one to `.heist/demo-epoch`
// (gitignored). The server reads it on every page and every CoStar or Vexcel
// use (route handlers included); when it changes, the server forgets every
// live failure in the process (CoStar and Vexcel try live again), and the
// browser clears what it kept of earlier runs (`DEMO_EPOCH_SCRIPT`) on its
// next page load, so the debrief starts empty.
import { readFileSync } from "node:fs";
import path from "node:path";
import { lastEpoch, rememberEpoch, resetServerSlots } from "./server-breakers";

/** Where `demo:reset` writes the epoch: `.heist/` in the app's directory, or `HEIST_STATE_DIR` (tests). */
export function demoStateDir(): string {
  return process.env.HEIST_STATE_DIR || path.join(process.cwd(), ".heist");
}
export const EPOCH_FILE = "demo-epoch";

/** The current epoch, or null before the first reset. */
export function readDemoEpoch(dir: string = demoStateDir()): string | null {
  try {
    return readFileSync(path.join(dir, EPOCH_FILE), "utf8").trim() || null;
  } catch {
    return null;
  }
}

/**
 * Reads the epoch; on a change since the last read, resets every server-side
 * breaker (`resetServerSlots`). The record is process-wide, so whichever
 * bundle reads the new epoch first resets them for all.
 */
export function syncDemoEpoch(dir: string = demoStateDir()): string | null {
  const epoch = readDemoEpoch(dir);
  const last = lastEpoch(dir);
  if (last !== undefined && epoch !== last) resetServerSlots();
  rememberEpoch(dir, epoch);
  return epoch;
}

/**
 * The inline script the page runs before it hydrates: when the browser last
 * saw a different epoch, it removes every `heist:` key from localStorage and
 * sessionStorage (run logs, crew plans, toasts seen) and the forced-fixtures
 * cookie, then remembers this epoch. It runs before any component reads
 * storage, so no screen sees a stale run. When it expired a cookie that
 * forced a service, it reloads once: the server rendered this page with that
 * service on fixtures, and nothing on screen may pass that data off as live.
 */
export function demoEpochScript(epoch: string): string {
  return `(function(e){try{var k="heist:demo-epoch",l=window.localStorage;if(l.getItem(k)===e)return;var f=document.cookie.split(";").some(function(c){c=c.trim();return c.indexOf("heist-fixtures=")===0&&c.length>15});[l,window.sessionStorage].forEach(function(s){for(var i=s.length-1;i>=0;i--){var n=s.key(i);if(n&&n.indexOf("heist:")===0)s.removeItem(n)}});document.cookie="heist-fixtures=; path=/; Max-Age=0; SameSite=Lax";l.setItem(k,e);if(f)window.location.reload()}catch(_){}})(${JSON.stringify(epoch).replace(/</g, "\\u003c")})`;
}
