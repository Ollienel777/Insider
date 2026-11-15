import { describe, expect, it } from "vitest";
import { ChiefCalls, LOCKDOWN_REASK_MS, worthAsking } from "./chief-calls";

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
    // The first Lockdown re-sighting after the call that raised Lockdown (asked about as Alert → Lockdown) counts that call.
    expect(worthAsking(lockdown("corridor"), asked("corridor", 0, "lockdown"), 2_000)).toBe(false);
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
