// A stand-in for the browser's AudioContext, for the unit tests (which run in
// Node, where Web Audio does not exist). It makes no sound: it records what
// was built and scheduled, and its clock moves only when a test moves it. It
// refuses what a browser refuses (a ramp to zero, a source started twice or
// stopped before it started), so a test fails where the browser would throw.

/** A scheduled change of a parameter. */
export interface ParamEvent {
  kind: "set" | "linear" | "exponential";
  value: number;
  at: number;
}

export class FakeParam {
  readonly events: ParamEvent[] = [];
  constructor(public value: number) {}

  setValueAtTime(value: number, at: number) {
    return this.schedule("set", value, at);
  }

  linearRampToValueAtTime(value: number, at: number) {
    return this.schedule("linear", value, at);
  }

  exponentialRampToValueAtTime(value: number, at: number) {
    if (value === 0) throw new RangeError("an exponential ramp cannot reach zero");
    return this.schedule("exponential", value, at);
  }

  /** The highest value it is ever scheduled to; its plain value when nothing is scheduled. */
  get peak(): number {
    return this.events.length > 0 ? Math.max(...this.events.map((event) => event.value)) : this.value;
  }

  private schedule(kind: ParamEvent["kind"], value: number, at: number) {
    if (!Number.isFinite(value) || !Number.isFinite(at) || at < 0) throw new RangeError(`bad ${kind} to ${value} at ${at}`);
    this.events.push({ kind, value, at });
    return this;
  }
}

export class FakeNode {
  readonly outputs = new Set<FakeNode>();
  constructor(readonly kind: "destination" | "gain" | "filter" | "oscillator" | "buffer-source") {}

  connect(to: FakeNode) {
    this.outputs.add(to);
    return to;
  }

  disconnect() {
    this.outputs.clear();
  }
}

export class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);
  constructor() {
    super("gain");
  }
}

export class FakeFilter extends FakeNode {
  type = "lowpass";
  readonly frequency = new FakeParam(350);
  readonly Q = new FakeParam(1);
  constructor() {
    super("filter");
  }
}

/** An oscillator or a buffer source: something that starts and stops. */
export class FakeSource extends FakeNode {
  type = "sine";
  readonly frequency = new FakeParam(440);
  buffer: unknown = null;
  startAt: number | null = null;
  stopAt: number | null = null;
  ended = false;
  onended: (() => void) | null = null;

  constructor(
    kind: "oscillator" | "buffer-source",
    private readonly ctx: FakeAudioContext,
  ) {
    super(kind);
  }

  start(at = this.ctx.currentTime) {
    if (this.startAt !== null) throw new DOMException("cannot call start more than once", "InvalidStateError");
    if (!Number.isFinite(at) || at < 0) throw new RangeError(`bad start at ${at}`);
    this.startAt = at;
    this.ctx.started.push(this);
  }

  stop(at = this.ctx.currentTime) {
    if (this.startAt === null) throw new DOMException("cannot call stop without calling start first", "InvalidStateError");
    if (!Number.isFinite(at) || at < 0) throw new RangeError(`bad stop at ${at}`);
    this.stopAt = at;
  }

  /** Whether it makes sound at `time`: started by then, and not yet stopped. Without a stop, it never ends. */
  soundsAt(time: number): boolean {
    return this.startAt !== null && this.startAt <= time && (this.stopAt === null || time < this.stopAt);
  }
}

export class FakeAudioContext {
  currentTime = 0;
  readonly sampleRate = 48000;
  readonly destination = new FakeNode("destination");
  /** Every node made, in order. */
  readonly nodes: FakeNode[] = [];
  /** Every source started, in order. */
  readonly started: FakeSource[] = [];
  resumes = 0;

  /** A browser's context is suspended until a gesture allows it, and for a moment after it is made. */
  constructor(public state: "suspended" | "running" | "closed" = "running") {}

  createGain() {
    return this.made(new FakeGain());
  }

  createBiquadFilter() {
    return this.made(new FakeFilter());
  }

  createOscillator() {
    return this.made(new FakeSource("oscillator", this));
  }

  createBufferSource() {
    return this.made(new FakeSource("buffer-source", this));
  }

  createBuffer(_channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    return { length, sampleRate, getChannelData: () => data };
  }

  resume() {
    this.resumes++;
    if (this.state === "suspended") this.state = "running";
    return Promise.resolve();
  }

  close() {
    this.state = "closed";
    return Promise.resolve();
  }

  /** Moves the clock on, ending every source whose stop time has come. */
  advance(seconds: number) {
    this.currentTime += seconds;
    for (const source of this.started) {
      if (!source.ended && source.stopAt !== null && source.stopAt <= this.currentTime) {
        source.ended = true;
        source.onended?.();
      }
    }
  }

  /** The sources that make sound at `time` (by default, now). */
  sounding(time = this.currentTime): FakeSource[] {
    return this.started.filter((source) => source.soundsAt(time));
  }

  /** The sources that will still make sound at some moment after `time`. */
  soundingAfter(time = this.currentTime): FakeSource[] {
    return this.started.filter((source) => source.startAt !== null && (source.stopAt === null || source.stopAt > Math.max(time, source.startAt)));
  }

  /** As the type the code under test takes. */
  asContext(): AudioContext {
    return this as unknown as AudioContext;
  }

  private made<T extends FakeNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }
}

/** Whether a signal leaving `from` can reach `to`. */
export function reaches(from: FakeNode, to: FakeNode, seen = new Set<FakeNode>()): boolean {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return [...from.outputs].some((next) => reaches(next, to, seen));
}
