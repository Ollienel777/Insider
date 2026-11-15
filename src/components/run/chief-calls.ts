// One Chief call out at a time (issue 172). In real time the alarm can move
// twice inside one call (Suspicious, then Alert a second later), and aborting
// the first call for the second threw its answer away: 4 of 10 calls never
// landed. Now a call out is let finish, and its orders apply; the events that
// arrived meanwhile wait, and only the newest of them is asked about next,
// with the run as it stands then. A run's restart drops everything.

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

  /** The call for `seq` answered or failed: the newest event that waited, to ask about next, or null. */
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

  /** The newest event asked about or waiting, or null. */
  newest(): number | null {
    return this.waiting ?? this.out;
  }

  /** A restart: no call out, nothing waiting. */
  reset(): void {
    this.out = null;
    this.waiting = null;
  }
}
