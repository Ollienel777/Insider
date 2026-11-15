import { describe, expect, it } from "vitest";
import { ChiefCalls } from "./chief-calls";

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
    expect(calls.newest()).toBe(2);
    expect(calls.settled(0)).toBe(2);
    expect(calls.isOut(2)).toBe(true);
    expect(calls.settled(2)).toBeNull();
  });

  it("ignores an answer for a call that is not the one out", () => {
    const calls = new ChiefCalls();
    calls.ask(0);
    calls.reset();
    expect(calls.settled(0)).toBeNull();
    expect(calls.ask(0)).toBe(true);
  });
});
