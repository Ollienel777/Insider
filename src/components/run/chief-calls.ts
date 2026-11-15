// One Chief call out at a time (issue 172). In real time the alarm can move
// twice inside one call (Suspicious, then Alert a second later), and aborting
// the first call for the second threw its answer away: 4 of 10 calls never
// landed. Now a call out is let finish, and its orders apply; the events that
// arrived meanwhile wait, and only the newest of them is asked about next,
// with the run as it stands then. A run's restart drops everything.
//
// An answer about an older event applies even when the alarm has moved since
// (Alert's orders landing at Suspicious), its locks included: they are real
// orders the player watched arrive, and the next call re-plans from the board
// they left. Nothing unlocks a superseded answer's doors; only calm drops
// orders (`applyChiefOrders`). A call has the browser's own deadline
// (`CHIEF_CLIENT_TIMEOUT_MS`), so a hung one fails and frees the queue.

export class ChiefCalls {
  private out: number | null = null;
  private waiting: number | null = null;

  /** An alarm event: true when its call should go out now, false when it waits behind the one out. */
  ask(seq: number): boolean {
    if (this.out === null) {
      this.out = seq;
      return true;
    }
    // Asked again about the event already out (a retry while it is out): its answer is coming.
    if (seq === this.out) return false;
    this.waiting = Math.max(this.waiting ?? -1, seq);
    return false;
  }

  /**
   * The call for `seq` answered or failed: the newest event that waited, to ask about next, or null.
   * That event is marked out, so the caller sends its call, or calls `reset` when it can't.
   */
  settled(seq: number): number | null {
    if (this.out !== seq) return null;
    this.out = null;
    const next = this.waiting;
    this.waiting = null;
    if (next === null) return null;
    this.out = next;
    return next;
  }

  /** Whether `seq`'s call is the one out. */
  isOut(seq: number): boolean {
    return this.out === seq;
  }

  /** A restart: no call out, nothing waiting. */
  reset(): void {
    this.out = null;
    this.waiting = null;
  }
}

// At Lockdown the engine adds an event each time the player is seen again
// after a gap (`detect`, the `elsewhere` branch): a sweeping camera makes one
// every second or so. Asking the Chief about each one restarted the radio on
// every answer, so only the first sentence was ever heard (issue 190). A
// Lockdown re-sighting is asked about only when it is somewhere new, and not
// before the last re-plan has had time to be read out in full.

/** How long a re-plan at Lockdown keeps the air before another re-sighting may ask again: about a full read-out on the radio. */
export const LOCKDOWN_REASK_MS = 10_000;

/** The last event a Chief call went out about: its alarm level, its zone, and when (ms, any clock that only goes forward). */
export interface AskedAbout {
  to: string;
  zone: string | null;
  at: number;
}

/**
 * Whether an alarm event is worth a Chief call. Every change of alarm level is.
 * A Lockdown re-sighting (`from` and `to` both "lockdown") is not when it is in
 * the zone last asked about, or when the last call at Lockdown went out under
 * `LOCKDOWN_REASK_MS` ago. The engine still records every event.
 */
export function worthAsking(
  event: { from: string; to: string; lastKnownZone: string | null },
  last: AskedAbout | null,
  now: number,
): boolean {
  if (event.from !== "lockdown" || event.to !== "lockdown") return true;
  if (!last || last.to !== "lockdown") return true;
  if (event.lastKnownZone === last.zone) return false;
  return now - last.at >= LOCKDOWN_REASK_MS;
}
