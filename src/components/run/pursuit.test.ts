import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { LevelManifest } from "@/domain";
import { act, createRun, HOLD, withPursuit, type Action, type RunState } from "@/engine";
import { placeLevel } from "@/level/placer";
import cached from "../../../data/levels/F1.romaine-1974.json";
import { FP_TURN_MS } from "./fp/tuning";
import { PURSUIT_HOLD_S, PURSUIT_SEARCH_HOPS, realTimePursuit } from "./pursuit";
import { RUN_SEED } from "./run-screen";
import { LIVE_TURN_MS } from "./turn-clock";

describe("real-time play's pursuit (issue 219)", () => {
  it("turns its seconds into turns of the mode's clock", () => {
    const fp = realTimePursuit(FP_TURN_MS);
    expect(fp.hold.alert! * FP_TURN_MS).toBeGreaterThanOrEqual(PURSUIT_HOLD_S.alert * 1000);
    expect((fp.hold.alert! - 1) * FP_TURN_MS).toBeLessThan(PURSUIT_HOLD_S.alert * 1000);
    const live = realTimePursuit(LIVE_TURN_MS);
    expect(live.hold.alert!).toBeLessThan(fp.hold.alert!);
    expect(live.hold.suspicious! * LIVE_TURN_MS).toBeGreaterThanOrEqual(PURSUIT_HOLD_S.suspicious * 1000);
    expect(fp.searchHops).toBe(PURSUIT_SEARCH_HOPS);
  });

  it("is never shorter than the turn-based rules, and lets Lockdown fall", () => {
    for (const ms of [FP_TURN_MS, LIVE_TURN_MS, 60_000]) {
      const { hold } = realTimePursuit(ms);
      expect(hold.alert!).toBeGreaterThanOrEqual(HOLD.alert!);
      expect(hold.suspicious!).toBeGreaterThanOrEqual(HOLD.suspicious!);
      expect(hold.lockdown!).toBeGreaterThan(0);
    }
  });

  it("is one object per clock, so setting it every turn changes nothing", () => {
    expect(realTimePursuit(FP_TURN_MS)).toBe(realTimePursuit(FP_TURN_MS));
    expect(realTimePursuit(FP_TURN_MS)).not.toBe(realTimePursuit(LIVE_TURN_MS));
  });
});

describe("F1 under the pursuit (issue 219)", () => {
  const manifest = LevelManifest.parse(structuredClone(cached));
  const { level } = placeLevel(manifest, structuredClone(FIXTURE_FLOORS.F1), RUN_SEED);
  const pursuit = realTimePursuit(FP_TURN_MS);
  const wait: Action = { kind: "wait" };

  /** Plays `action` with the pursuit set or not, as the Run screen does each turn. */
  const step = (run: RunState, action: Action, on: boolean): RunState => {
    const result = act(withPursuit(run, on ? pursuit : null), action);
    if (!result.ok) throw new Error(result.reason);
    return result.run;
  };

  it("leaves a run nobody sees exactly as it was: the pursuit only matters once the alarm is up", () => {
    let plain = createRun(level);
    let chased = createRun(level);
    for (let i = 0; i < 12; i++) {
      plain = step(plain, wait, false);
      chased = step(chased, wait, true);
      if (plain.alarm !== "calm") break;
      expect(chased.guards).toEqual(plain.guards);
      expect(chased.alarm).toBe(plain.alarm);
    }
  });
});
