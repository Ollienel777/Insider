import { describe, expect, it } from "vitest";
import { ChiefCalls, LOCKDOWN_REASK_MS, afterFailure, askDelay, worthAsking } from "./chief-calls";

describe("one Chief call out at a time (issue 172)", () => {
  it("sends the first event's call at once", () => {
    const calls = new ChiefCalls();
    expect(calls.ask(0)).toBe(true);
    expect(calls.isOut(0)).toBe(true);
    expect(calls.settled(0)).toBeNull();
    expect(calls.ask(1)).toBe(true);
  });

  it("lets a call out finish when the alarm moves again, then asks once about the newest event", () => {
    const calls = new ChiefCalls();
    calls.ask(0);
    expect(calls.ask(1)).toBe(false);
    expect(calls.ask(2)).toBe(false);
    expect(calls.isOut(0)).toBe(true);
    expect(calls.settled(0)).toBe(2);
    expect(calls.isOut(2)).toBe(true);
    expect(calls.settled(2)).toBeNull();
  });

  it("does not ask twice about the event already out (a retry while it is out)", () => {
    const calls = new ChiefCalls();
    calls.ask(3);
    expect(calls.ask(3)).toBe(false);
    expect(calls.settled(3)).toBeNull();
  });

  it("ignores an answer for a call that is not the one out", () => {
    const calls = new ChiefCalls();
    calls.ask(0);
    calls.reset();
    expect(calls.settled(0)).toBeNull();
    expect(calls.ask(0)).toBe(true);
  });
});

describe("which alarm events are worth a Chief call (issue 190)", () => {
  const lockdown = (zone: string | null) => ({ from: "lockdown", to: "lockdown", lastKnownZone: zone });
  const asked = (zone: string | null, at = 0, to = "lockdown") => ({ to, zone, at });

  it("asks about every change of alarm level, however soon", () => {
    expect(worthAsking({ from: "alert", to: "lockdown", lastKnownZone: "corridor" }, asked("corridor", 0, "alert"), 1)).toBe(true);
    expect(worthAsking({ from: "lockdown", to: "alert", lastKnownZone: "corridor" }, asked("corridor"), 1)).toBe(true);
    expect(worthAsking(lockdown("corridor"), null, 0)).toBe(true);
  });

  it("at Lockdown, never re-asks about the same zone, and asks about a new one only once the last re-plan has had its read-out", () => {
    expect(worthAsking(lockdown("corridor"), asked("corridor"), LOCKDOWN_REASK_MS * 5)).toBe(false);
    expect(worthAsking(lockdown("lobby"), asked("corridor"), LOCKDOWN_REASK_MS - 1)).toBe(false);
    expect(worthAsking(lockdown("lobby"), asked("corridor"), LOCKDOWN_REASK_MS)).toBe(true);
    // The call that raised Lockdown (asked about as Alert → Lockdown, so `to` is "lockdown") counts: a new zone 2 s later waits.
    expect(worthAsking(lockdown("lobby"), asked("corridor", 0, "lockdown"), 2_000)).toBe(false);
  });

  it("keeps a new zone that came too soon for later, never drops it, and never keeps the same zone", () => {
    // Seen in the Lobby 3 s after the re-plan about the Corridor: asked about 7 s later, not thrown away.
    expect(askDelay(lockdown("lobby"), asked("corridor", 1_000), 4_000)).toBe(LOCKDOWN_REASK_MS - 3_000);
    expect(askDelay(lockdown("lobby"), asked("corridor", 1_000), 1_000 + LOCKDOWN_REASK_MS)).toBe(0);
    expect(askDelay(lockdown("corridor"), asked("corridor", 1_000), 4_000)).toBeNull();
    expect(askDelay({ from: "alert", to: "lockdown", lastKnownZone: "lobby" }, asked("corridor", 1_000), 1_001)).toBe(0);
  });

  it("on the turn-based board, asks about a new zone at once: only a run on the clock waits for the radio", () => {
    expect(askDelay(lockdown("lobby"), asked("corridor", 1_000), 1_500, false)).toBe(0);
    expect(askDelay(lockdown("corridor"), asked("corridor", 1_000), 1_500, false)).toBeNull();
  });

  it("forgets a call that failed, so Retry, or the next re-sighting in that zone, asks again", () => {
    const before = asked("corridor", 0);
    const failed = asked("lobby", LOCKDOWN_REASK_MS);
    const now = afterFailure(failed, failed, before);
    expect(now).toBe(before);
    expect(worthAsking(lockdown("lobby"), now, LOCKDOWN_REASK_MS + 1)).toBe(true);
    // A later call already out stays remembered when an older one fails.
    const later = asked("vault", LOCKDOWN_REASK_MS * 2);
    expect(afterFailure(later, failed, before)).toBe(later);
  });

  it("turns a sweep's stream of re-sightings into a re-plan at most every LOCKDOWN_REASK_MS", () => {
    // Re-seen every 1.4 s for 61 s, moving between two zones every 7 s, as in the walk issue 190 timed.
    let last: { to: string; zone: string | null; at: number } | null = { to: "lockdown", zone: "corridor", at: 0 };
    let calls = 0;
    for (let t = 1400; t <= 61_000; t += 1400) {
      const event = lockdown(Math.floor(t / 7000) % 2 === 0 ? "corridor" : "lobby");
      if (worthAsking(event, last, t)) {
        calls += 1;
        last = { to: "lockdown", zone: event.lastKnownZone, at: t };
      }
    }
    expect(calls).toBeLessThanOrEqual(Math.ceil(61_000 / LOCKDOWN_REASK_MS));
    expect(calls).toBeGreaterThan(0);
  });
});
