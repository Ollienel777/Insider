// The run's sound, between the screen and the synth (issue 101). It owns the
// audio context: none exists until the player's first click or key press, as
// browsers require, and none is opened while muted. It follows the run from
// state to state and plays what `cuesFor` returns for each change.
//
// Sound is never worth a broken run. Where Web Audio is missing or refused,
// or anything in it throws, this does nothing and the run plays on.
import type { RunState } from "@/engine";
import { cuesFor, sameRun } from "./sound";
import { createVoices, type Voices } from "./sound-synth";

export interface SoundPlayer {
  /** A click or a key press happened: from now on audio may start. Call it on every one. */
  wake(): void;
  setMuted(muted: boolean): void;
  /** The run as it now stands (null: no run on the board). Plays what changed since the last call. */
  follow(run: RunState | null): void;
  /** Ends every sound and gives the audio device back. The player does nothing afterwards. */
  close(): void;
}

/** The browser's audio context, or null where Web Audio is missing or refused. */
export function openAudio(): AudioContext | null {
  try {
    const Context = globalThis.AudioContext;
    return Context ? new Context() : null;
  } catch {
    return null;
  }
}

export function createSoundPlayer(open: () => AudioContext | null = openAudio): SoundPlayer {
  let ctx: AudioContext | null = null;
  let voices: Voices | null = null;
  /** Web Audio is missing, refused or closed: never ask again. */
  let dead = false;
  let woken = false;
  let muted = false;
  let last: RunState | null = null;

  const quietly = (work: () => void) => {
    try {
      work();
    } catch {
      // Dropped: see the top of this file.
    }
  };

  /** Opens the context once a gesture has allowed it and sound is wanted, and resumes one the browser holds suspended. */
  function start() {
    if (dead || muted || !woken) return;
    try {
      if (!ctx) {
        ctx = open();
        if (!ctx) {
          dead = true;
          return;
        }
        voices = createVoices(ctx);
      }
      if (ctx.state !== "running") Promise.resolve(ctx.resume()).catch(() => {});
    } catch {
      close();
    }
  }

  function wake() {
    woken = true;
    start();
  }

  function setMuted(next: boolean) {
    muted = next;
    if (!muted) start();
    quietly(() => voices?.setMuted(muted));
  }

  function follow(run: RunState | null) {
    const previous = last;
    last = run;
    quietly(() => {
      if (!ctx || !voices) return;
      // A restart, or the board going away: nothing of the old run plays on.
      if (!previous || !run || !sameRun(previous, run)) return voices.stop();
      // Each turn's pulse replaces the last. A turn without one (the guard is far, the run is over) ends it.
      if (run.turn > previous.turn) voices.stop("pulse");
      if (muted) return;
      const cues = cuesFor(previous, run);
      // A context not running yet (just opened, or held by the browser) has sounded none of what is
      // queued on it. Only the newest turn's cues stay queued, so they never come back as a burst.
      if (cues.length > 0 && ctx.state !== "running") voices.stop();
      for (const cue of cues) voices.play(cue);
    });
  }

  function close() {
    dead = true;
    last = null;
    quietly(() => voices?.stop());
    quietly(() => {
      if (ctx && ctx.state !== "closed") Promise.resolve(ctx.close()).catch(() => {});
    });
    ctx = null;
    voices = null;
  }

  return { wake, setMuted, follow, close };
}
