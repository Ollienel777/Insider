// The synth (issue 101) on a stand-in audio context: what each cue schedules,
// that all of it ends by itself, and that mute and stop end it early. What it
// sounds like is not tested here; nobody can hear a unit test.
import { describe, expect, it } from "vitest";
import { LEVELS } from "@/engine";
import { PULSE_RANGE, type Cue } from "./sound";
import { FakeAudioContext, FakeGain, reaches, type FakeNode, type FakeSource } from "./sound-fake-audio";
import { createVoices, CUE_START, MASTER_LEVEL, pulseBeats } from "./sound-synth";

const walk: Cue = { kind: "step", hops: 1, sprint: false };
const sprint: Cue = { kind: "step", hops: 2, sprint: true };
const pulse = (hops: number): Cue => ({ kind: "pulse", hops });

/** One of every cue, in every form that changes what is scheduled. */
const EVERY_CUE: readonly Cue[] = [
  walk,
  sprint,
  { kind: "step", hops: 1, sprint: true },
  { kind: "pick" },
  { kind: "unlock" },
  { kind: "take" },
  { kind: "spotted" },
  { kind: "alarm-rise", to: "suspicious" },
  { kind: "alarm-rise", to: "alert" },
  { kind: "alarm-rise", to: "lockdown" },
  { kind: "alarm-fall", to: "alert" },
  { kind: "alarm-fall", to: "suspicious" },
  { kind: "alarm-fall", to: "calm" },
  { kind: "escape" },
  { kind: "caught" },
  ...[0, 1, 2, 3, 4].map(pulse),
];

const name = (cue: Cue) => JSON.stringify(cue);

function setup() {
  const ctx = new FakeAudioContext();
  const voices = createVoices(ctx.asContext());
  const master = ctx.nodes.find((node) => node.outputs.has(ctx.destination)) as FakeGain;
  return { ctx, voices, master };
}

/** The envelope a source plays through: the first gain after it. */
function envelopeOf(source: FakeNode): FakeGain {
  for (const next of source.outputs) return next instanceof FakeGain ? next : envelopeOf(next);
  throw new Error("the source is connected to nothing");
}

/** What `cue` schedules on a fresh context at time 10: its sources, and the master gain. */
function scheduled(cue: Cue) {
  const { ctx, voices, master } = setup();
  ctx.currentTime = 10;
  voices.play(cue);
  return { ctx, master, sources: ctx.started };
}

const firstStart = (sources: readonly FakeSource[]) => Math.min(...sources.map((s) => s.startAt!));
const lastStop = (sources: readonly FakeSource[]) => Math.max(...sources.map((s) => s.stopAt!));
const loudness = (sources: readonly FakeSource[]) => sources.reduce((sum, s) => sum + envelopeOf(s).gain.peak, 0);

describe("every cue", () => {
  it.each(EVERY_CUE.map((cue) => [name(cue), cue] as const))("%s makes sound, starting at its place in the turn", (_name, cue) => {
    const { sources } = scheduled(cue);
    expect(sources.length).toBeGreaterThan(0);
    const start = firstStart(sources) - 10;
    expect(start).toBeGreaterThanOrEqual(CUE_START[cue.kind]);
    expect(start).toBeLessThan(CUE_START[cue.kind] + 0.05);
  });

  it.each(EVERY_CUE.map((cue) => [name(cue), cue] as const))("%s ends by itself: every source has its stop time", (_name, cue) => {
    const { ctx, sources } = scheduled(cue);
    for (const source of sources) {
      expect(source.stopAt).not.toBeNull();
      expect(source.stopAt!).toBeGreaterThan(source.startAt!);
    }
    // A cue is short: under half a second from its first sound to its last. The pulse may run longer.
    expect(lastStop(sources) - firstStart(sources)).toBeLessThan(cue.kind === "pulse" ? 1 : 0.5);
    ctx.advance(2);
    expect(ctx.sounding()).toEqual([]);
  });

  it.each(EVERY_CUE.map((cue) => [name(cue), cue] as const))("%s reaches the speakers through the master gain alone", (_name, cue) => {
    const { ctx, master, sources } = scheduled(cue);
    const intoSpeakers = ctx.nodes.filter((node) => node.outputs.has(ctx.destination));
    expect(intoSpeakers).toEqual([master]);
    for (const source of sources) expect(reaches(source, master)).toBe(true);
  });

  it.each(EVERY_CUE.map((cue) => [name(cue), cue] as const))("%s rises from silence and dies away, each voice in its own envelope", (_name, cue) => {
    const { sources } = scheduled(cue);
    for (const source of sources) {
      const { events } = envelopeOf(source).gain;
      expect(events.map((event) => event.kind)).toEqual(["set", "linear", "exponential"]);
      const [from, top, end] = events;
      expect(from).toEqual({ kind: "set", value: 0, at: source.startAt });
      expect(top.value).toBeGreaterThan(0);
      expect(top.at).toBeGreaterThan(from.at);
      expect(end.value).toBeLessThan(top.value / 50);
      expect(end.at).toBe(source.stopAt);
    }
  });

  it("is tidied away once it has ended: its envelopes leave the master gain", () => {
    const { ctx, voices, master } = setup();
    for (const cue of EVERY_CUE) voices.play(cue);
    expect(ctx.nodes.filter((node) => node.outputs.has(master)).length).toBe(ctx.started.length);
    ctx.advance(3);
    expect(ctx.nodes.filter((node) => node.outputs.has(master))).toEqual([]);
  });

  it("keeps its tones modest: those that start together stay under full scale, before a master gain under 1", () => {
    expect(MASTER_LEVEL).toBeGreaterThan(0);
    expect(MASTER_LEVEL).toBeLessThanOrEqual(0.6);
    for (const cue of EVERY_CUE) {
      const tones = scheduled(cue).sources.filter((source) => source.kind === "oscillator");
      for (const at of new Set(tones.map((tone) => tone.startAt))) {
        expect(loudness(tones.filter((tone) => tone.startAt === at)), name(cue)).toBeLessThan(1);
      }
    }
  });
});

describe("the footstep", () => {
  it("lands once per hop, and harder on a sprint", () => {
    const one = scheduled(walk).sources;
    const two = scheduled(sprint).sources;
    expect(two.length).toBe(one.length * 2);
    expect(new Set(two.map((s) => s.startAt)).size).toBe(2);
    expect(new Set(one.map((s) => s.startAt)).size).toBe(1);
    // Hop for hop, the sprint's step is the louder.
    expect(loudness(two) / 2).toBeGreaterThan(loudness(one) * 1.2);
  });
});

describe("the alarm's cues", () => {
  it("the rise is louder and higher with each level", () => {
    const rises = (["suspicious", "alert", "lockdown"] as const).map((to) => scheduled({ kind: "alarm-rise", to }).sources);
    const pitch = (sources: readonly FakeSource[]) => Math.min(...sources.map((s) => s.frequency.events[0].value));
    expect(loudness(rises[1])).toBeGreaterThan(loudness(rises[0]));
    expect(loudness(rises[2])).toBeGreaterThan(loudness(rises[1]));
    expect(pitch(rises[1])).toBeGreaterThan(pitch(rises[0]));
    expect(pitch(rises[2])).toBeGreaterThan(pitch(rises[1]));
  });

  it("the fall is softer than any rise, and slides down where the rise leans up", () => {
    const quietestRise = loudness(scheduled({ kind: "alarm-rise", to: "suspicious" }).sources);
    for (const to of LEVELS.slice(0, 3)) {
      const fall = scheduled({ kind: "alarm-fall", to }).sources;
      expect(loudness(fall), to).toBeLessThan(quietestRise);
      for (const source of fall) {
        const [from, end] = source.frequency.events;
        expect(end.value).toBeLessThan(from.value);
      }
    }
    for (const source of scheduled({ kind: "alarm-rise", to: "alert" }).sources) {
      const [from, end] = source.frequency.events;
      expect(end.value).toBeGreaterThan(from.value);
    }
  });
});

describe("the guard pulse", () => {
  it("quickens as the guard closes: more beats, closer together, a little louder", () => {
    const far = pulseBeats(PULSE_RANGE);
    expect(far.beats).toBe(1);
    for (let hops = PULSE_RANGE - 1; hops >= 1; hops--) {
      const nearer = pulseBeats(hops);
      const than = pulseBeats(hops + 1);
      expect(nearer.beats, `${hops} hops`).toBeGreaterThan(than.beats);
      expect(nearer.gap, `${hops} hops`).toBeLessThan(than.gap);
      expect(nearer.peak, `${hops} hops`).toBeGreaterThan(than.peak);
    }
    // A guard on the player's own node is as close as it gets.
    expect(pulseBeats(0)).toEqual(pulseBeats(1));
  });

  it("schedules those beats, that far apart", () => {
    for (const hops of [1, 2, 3, 4]) {
      const { beats, gap } = pulseBeats(hops);
      const starts = [...new Set(scheduled(pulse(hops)).sources.map((s) => s.startAt!))].sort((a, b) => a - b);
      expect(starts.length, `${hops} hops`).toBe(beats);
      starts.slice(1).forEach((at, i) => expect(at - starts[i], `${hops} hops`).toBeCloseTo(gap, 6));
    }
  });

  it("is low: every beat is a tone that starts under middle C and sinks", () => {
    for (const source of scheduled(pulse(1)).sources) {
      expect(source.kind).toBe("oscillator");
      const [from, end] = source.frequency.events;
      expect(from.value).toBeLessThan(262);
      expect(end.value).toBeLessThan(from.value);
    }
  });
});

describe("stopping", () => {
  it("stop('pulse') ends the pulse now and leaves the rest to play out", () => {
    const { ctx, voices } = setup();
    voices.play(walk);
    const steps = [...ctx.started];
    const stepEnds = steps.map((s) => s.stopAt);
    voices.play(pulse(1));
    const beats = ctx.started.filter((s) => !steps.includes(s));
    ctx.advance(0.05);
    voices.stop("pulse");
    for (const beat of beats) expect(beat.stopAt).toBe(ctx.currentTime);
    expect(steps.map((s) => s.stopAt)).toEqual(stepEnds);
    expect(ctx.soundingAfter().every((s) => steps.includes(s))).toBe(true);
  });

  it("stop() ends everything, sounding or still to sound", () => {
    const { ctx, voices } = setup();
    for (const cue of EVERY_CUE) voices.play(cue);
    ctx.advance(0.05);
    expect(ctx.soundingAfter().length).toBeGreaterThan(0);
    voices.stop();
    expect(ctx.soundingAfter()).toEqual([]);
  });

  it("stopping twice, or after everything has ended, is harmless", () => {
    const { ctx, voices } = setup();
    voices.play(walk);
    voices.stop();
    expect(() => voices.stop()).not.toThrow();
    ctx.advance(2);
    expect(() => voices.stop("pulse")).not.toThrow();
  });
});

describe("mute", () => {
  it("is one switch: the master gain goes to zero and everything sounding ends", () => {
    const { ctx, voices, master } = setup();
    expect(master.gain.value).toBe(MASTER_LEVEL);
    for (const cue of EVERY_CUE) voices.play(cue);
    ctx.advance(0.05);
    voices.setMuted(true);
    expect(master.gain.value).toBe(0);
    expect(ctx.soundingAfter()).toEqual([]);
  });

  it("unmuted, the master gain is back at its level", () => {
    const { voices, master } = setup();
    voices.setMuted(true);
    voices.setMuted(false);
    expect(master.gain.value).toBe(MASTER_LEVEL);
  });
});
