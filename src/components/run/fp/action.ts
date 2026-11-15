// What E is doing, in words (the play-tester's "say 'picking lock'"): the
// verb under the crosshair while E is aimed or held, and the line when it
// lands. What the player carries is the objective line's (#192). Pure: read off the walker's prompt, the
// placed level and the engine's run state, so it is the same on a fixture
// floor and on a scan.
//
// The verb follows what locks the door. The rules table gives every lock on
// a floor the era's kind (SPEC §4.3: analog key locks, card-era magstripe
// readers that need a cloned card, prox badge readers, smart badge plus
// PIN); an owner's setup sets each door's own, a key lock or a badge reader.
// The engine itself only counts picks, so the kind is the level's, not the
// engine's.
import type { LockKind } from "@/domain/manifest";
import type { PlacedLevel } from "@/level/placer";
import type { Prompt } from "./walker";

/** How a door is opened, as the player is told it. */
export type LockFeel = LockKind | "badge";

export interface ActionWords {
  /** After "Hold E ·": "Pick the lock". */
  prompt: string;
  /** While E is held: "Picking the lock…". */
  doing: string;
  /** The line when it lands: "Lock picked". */
  done: string;
}

const LOCK_WORDS: Readonly<Record<LockFeel, ActionWords>> = {
  key: { prompt: "Pick the lock", doing: "Picking the lock…", done: "Lock picked" },
  magstripe: { prompt: "Clone the keycard", doing: "Cloning the keycard…", done: "Keycard cloned" },
  prox: { prompt: "Clone the badge", doing: "Cloning the badge…", done: "Badge cloned" },
  badge: { prompt: "Clone the badge", doing: "Cloning the badge…", done: "Badge cloned" },
  "badge-pin": { prompt: "Spoof the badge and PIN", doing: "Spoofing the badge and PIN…", done: "Reader spoofed" },
};

const KINDS = new Set<string>(["key", "magstripe", "prox", "badge-pin", "badge"]);

/**
 * What locks `doorId`: an owner's own lock on that door first, then the
 * floor's kind from the rules table, else a key lock (what every level said
 * before the eras had words).
 */
export function lockOf(placed: Pick<PlacedLevel, "locks">, doorId: string, floorKind?: LockKind | null): LockFeel {
  const own = (placed.locks.find((l) => l.doorId === doorId) as { lock?: unknown } | undefined)?.lock;
  if (typeof own === "string" && KINDS.has(own)) return own as LockFeel;
  return floorKind ?? "key";
}

export function lockWords(feel: LockFeel): ActionWords {
  return LOCK_WORDS[feel];
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function takeWords(noun: string): ActionWords {
  return { prompt: `Take the ${noun}`, doing: `Taking the ${noun}…`, done: `${capital(noun)} collected` };
}

/** The label under the crosshair: aimed (a prompt), held (with how far along), or landed. */
export type ActionLabel =
  | { phase: "aim"; kind: "pick" | "take"; words: ActionWords; done: number; of: number }
  | { phase: "hold"; kind: "pick" | "take"; words: ActionWords; done: number; of: number }
  | { phase: "landed"; kind: "pick"; text: string };

/**
 * The label for what E acts on now. `landed` is the door the engine last
 * opened at the player's pick (moment.ts), said while there is nothing new to
 * aim at. The objective taken is the toast's to say, not this label's.
 */
export function actionLabel(
  prompt: Prompt,
  using: boolean,
  wordsFor: (doorId: string) => ActionWords,
  noun: string,
  landed: { doorId: string } | null,
): ActionLabel | null {
  if (prompt?.kind === "pick") {
    const words = wordsFor(prompt.doorId);
    // Under way and held, or the first pick asked for: the label says it is happening.
    return { phase: using ? "hold" : "aim", kind: "pick", words, done: prompt.done, of: prompt.of };
  }
  if (prompt?.kind === "take") return { phase: using ? "hold" : "aim", kind: "take", words: takeWords(noun), done: 0, of: 1 };
  if (!prompt && landed) return { phase: "landed", kind: "pick", text: `${wordsFor(landed.doorId).done} · Door open` };
  return null;
}

/**
 * How full the ring is, 0 to 1, and how full it is heading for while E is
 * held: the engine opens the lock at `of` picks, one a turn, so while held the
 * ring fills on towards the next pick over the turn.
 */
export function ringFill(label: ActionLabel, still: boolean): { now: number; towards: number } {
  if (label.phase === "landed") return { now: 1, towards: 1 };
  const now = label.of > 0 ? Math.min(1, label.done / label.of) : 0;
  if (label.phase !== "hold" || still) return { now, towards: now };
  return { now, towards: label.of > 0 ? Math.min(1, (label.done + 1) / label.of) : 1 };
}

/** What the live region says the turn something lands; null for nothing. */
export function announcement(landed: { kind: "door"; doorId: string } | { kind: "take" } | null, wordsFor: (doorId: string) => ActionWords, noun: string): string | null {
  if (!landed) return null;
  if (landed.kind === "door") return `${wordsFor(landed.doorId).done}. Door open.`;
  return `${takeWords(noun).done}. Get to the exit.`;
}
