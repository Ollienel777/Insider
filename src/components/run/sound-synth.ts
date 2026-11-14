// The run's sounds, made in the browser (issue 101). There are no audio files:
// every cue is a few oscillators and noise bursts, each through its own short
// envelope, all into one master gain, so mute is one switch.
//
// Nothing loops. A source is given its stop time as it starts, so every cue
// ends by itself, and `stop` ends early whatever is still sounding.
//
// The tone (DESIGN.md) is an after-hours office and a patient thief: dry,
// quiet and short. Soft ticks, a muffled step, low tones, a tense pulse; no
// tunes. The numbers in `play` are the whole mix, there to be tuned by ear.
import { LEVELS } from "@/engine";
import { PULSE_RANGE, type Cue } from "./sound";

/** The level of everything together. Voices peak well under 1 before it. */
export const MASTER_LEVEL = 0.5;

/**
 * Seconds into the turn that each cue starts, so a turn's cues are heard in
 * order (the step, who saw it, the alarm, the outcome) and not as one blur.
 */
export const CUE_START: Readonly<Record<Cue["kind"], number>> = {
  step: 0,
  pick: 0,
  unlock: 0,
  take: 0,
  spotted: 0.08,
  pulse: 0.1,
  "alarm-rise": 0.16,
  "alarm-fall": 0.16,
  escape: 0.28,
  caught: 0.28,
};

/** A little ahead of the clock, so the first sample of a cue is never in the past. */
const LEAD = 0.02;
/** Where a decay ends: an exponential ramp cannot reach zero, so it lands 60 dB down and the source stops. */
const FLOOR = 0.001;

/**
 * The guard pulse for one turn: more beats, closer together and a little
 * louder, the nearer the guard. One slow beat at the edge of its range, four
 * quick ones with the guard next to the player.
 */
export function pulseBeats(hops: number): { beats: number; gap: number; peak: number } {
  const near = PULSE_RANGE - Math.min(Math.max(hops, 1), PULSE_RANGE);
  return { beats: 1 + near, gap: 0.34 - 0.06 * near, peak: 0.24 + 0.06 * near };
}

/** How a voice's loudness moves: up to `peak` in `attack` seconds, then away over `decay`. */
interface Envelope {
  peak: number;
  attack?: number;
  decay: number;
}

interface Tone extends Envelope {
  type?: OscillatorType;
  freq: number;
  /** The pitch it slides to by the end of the decay. */
  glideTo?: number;
}

interface Noise extends Envelope {
  /** A lowpass keeps what is under `freq`; a bandpass keeps a band `freq / q` wide around it. */
  filter: "lowpass" | "bandpass";
  freq: number;
  q?: number;
}

export interface Voices {
  /** Schedules `cue`, starting `CUE_START` seconds from now. */
  play(cue: Cue): void;
  /** Ends what is sounding or still to sound: everything, or the guard pulse alone. */
  stop(only?: "pulse"): void;
  /** The one switch. Muted, the master gain is zero and everything sounding is ended. */
  setMuted(muted: boolean): void;
}

/** The voices on `ctx`, all through one master gain into its destination. */
export function createVoices(ctx: BaseAudioContext): Voices {
  const master = ctx.createGain();
  master.gain.value = MASTER_LEVEL;
  master.connect(ctx.destination);

  // A quarter second of white noise, shared by every burst (the longest is far shorter).
  const hiss = ctx.createBuffer(1, Math.ceil(ctx.sampleRate / 4), ctx.sampleRate);
  const samples = hiss.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;

  /** Every source started and not yet ended, and whether it belongs to the guard pulse. */
  const live = new Map<AudioScheduledSourceNode, boolean>();

  /** Starts `source` at `at` through its own envelope (fed from `last`, the end of its chain), and stops it when the envelope has died away. */
  function voice(source: AudioScheduledSourceNode, last: AudioNode, at: number, env: Envelope, pulse: boolean) {
    const { peak, attack = 0.004, decay } = env;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(peak, at + attack);
    gain.gain.exponentialRampToValueAtTime(FLOOR, at + attack + decay);
    last.connect(gain);
    gain.connect(master);
    live.set(source, pulse);
    source.onended = () => {
      live.delete(source);
      gain.disconnect();
    };
    source.start(at);
    source.stop(at + attack + decay);
  }

  function tone(at: number, { type = "sine", freq, glideTo, ...env }: Tone, pulse = false) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (glideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(glideTo, at + (env.attack ?? 0.004) + env.decay);
    voice(osc, osc, at, env, pulse);
  }

  function noise(at: number, { filter, freq, q = 1, peak, ...env }: Noise) {
    const source = ctx.createBufferSource();
    source.buffer = hiss;
    const band = ctx.createBiquadFilter();
    band.type = filter;
    band.frequency.value = freq;
    if (filter === "bandpass") band.Q.value = q;
    source.connect(band);
    // A filter keeps only a slice of the noise's power. This gives the loudness back, so `peak`
    // means the same for a narrow band as for a wide one, and about the same as for a tone.
    const kept = (filter === "bandpass" ? freq / q : freq) / (ctx.sampleRate / 2);
    voice(source, band, at, { ...env, peak: peak / Math.sqrt(Math.min(1, kept)) }, false);
  }

  function play(cue: Cue) {
    const at = ctx.currentTime + LEAD + CUE_START[cue.kind];
    switch (cue.kind) {
      // A muffled footfall: low noise with a small thud under it. A sprint lands harder, once per hop.
      case "step": {
        const weight = cue.sprint ? 1.4 : 1;
        for (let hop = 0; hop < cue.hops; hop++) {
          const t = at + hop * 0.13;
          noise(t, { filter: "lowpass", freq: cue.sprint ? 800 : 600, peak: 0.32 * weight, decay: 0.07 });
          tone(t, { freq: 110, glideTo: 70, peak: 0.3 * weight, decay: 0.08 });
        }
        break;
      }
      // Picks working a lock: three dry ticks, the last one late.
      case "pick":
        for (const after of [0, 0.06, 0.14]) {
          noise(at + after, { filter: "bandpass", freq: 3200, q: 3, peak: 0.22, attack: 0.001, decay: 0.015 });
        }
        break;
      // The door gives: one tick, then the latch falling back.
      case "unlock":
        noise(at, { filter: "bandpass", freq: 2400, q: 2, peak: 0.2, attack: 0.001, decay: 0.02 });
        noise(at + 0.05, { filter: "lowpass", freq: 900, peak: 0.26, decay: 0.07 });
        tone(at + 0.05, { freq: 170, glideTo: 110, peak: 0.3, decay: 0.09 });
        break;
      // The objective in hand: one soft low tone and its fifth. Not a tune.
      case "take":
        tone(at, { freq: 220, peak: 0.32, attack: 0.015, decay: 0.3 });
        tone(at, { freq: 330, peak: 0.18, attack: 0.015, decay: 0.26 });
        break;
      // Seen: a dry snap, nothing like the soft step before it.
      case "spotted":
        noise(at, { filter: "bandpass", freq: 1700, q: 1.2, peak: 0.3, attack: 0.001, decay: 0.04 });
        tone(at, { type: "triangle", freq: 310, peak: 0.36, attack: 0.001, decay: 0.06 });
        break;
      // The alarm rises: two low tones a semitone apart, leaning upward. Higher and louder with each level.
      case "alarm-rise": {
        const level = LEVELS.indexOf(cue.to); // 1 Suspicious, 2 Alert, 3 Lockdown
        const freq = 165 * 2 ** (level / 4);
        const peak = 0.17 + 0.07 * level;
        tone(at, { type: "triangle", freq, glideTo: freq * 1.04, peak, attack: 0.008, decay: 0.3 });
        tone(at, { type: "triangle", freq: freq * 1.06, glideTo: freq * 1.1, peak, attack: 0.008, decay: 0.3 });
        break;
      }
      // The alarm falls: one quiet tone settling downward. Softer than the rise.
      case "alarm-fall": {
        const freq = cue.to === "calm" ? 220 : 262;
        tone(at, { type: "triangle", freq, glideTo: freq * 0.75, peak: 0.24, attack: 0.03, decay: 0.3 });
        break;
      }
      // Out: the door shuts behind, and a low open fifth rings on a moment.
      case "escape":
        noise(at, { filter: "lowpass", freq: 500, peak: 0.24, decay: 0.08 });
        tone(at + 0.02, { freq: 196, peak: 0.3, attack: 0.03, decay: 0.4 });
        tone(at + 0.02, { freq: 294, peak: 0.18, attack: 0.03, decay: 0.36 });
        break;
      // Caught: a dull blow, and a tone dropping away under it.
      case "caught":
        noise(at, { filter: "lowpass", freq: 500, peak: 0.3, decay: 0.12 });
        tone(at, { type: "triangle", freq: 220, glideTo: 62, peak: 0.5, attack: 0.006, decay: 0.4 });
        break;
      // The guard pulse: low beats. The upper tone is what a laptop's speakers carry; the lower one is felt on headphones.
      case "pulse": {
        const { beats, gap, peak } = pulseBeats(cue.hops);
        for (let beat = 0; beat < beats; beat++) {
          const t = at + beat * gap;
          tone(t, { freq: 110, glideTo: 80, peak: peak * 0.7, attack: 0.008, decay: 0.15 }, true);
          tone(t, { type: "triangle", freq: 220, glideTo: 160, peak, attack: 0.008, decay: 0.13 }, true);
        }
        break;
      }
    }
  }

  function stop(only?: "pulse") {
    for (const [source, pulse] of [...live]) {
      if (only === "pulse" && !pulse) continue;
      live.delete(source);
      try {
        source.stop();
      } catch {
        // Already ended: there is nothing left to stop.
      }
    }
  }

  function setMuted(muted: boolean) {
    master.gain.value = muted ? 0 : MASTER_LEVEL;
    if (muted) stop();
  }

  return { play, stop, setMuted };
}
