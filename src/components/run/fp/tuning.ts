// Every number the first-person view is tuned by (issue 115), in one place.
// Lengths are metres and times seconds unless the name says otherwise.
/** A first-person turn, in milliseconds: the turn clock's length while first person is on. */
export const FP_TURN_MS = 700;

export const FP = Object.freeze({
  /** One floor-plan unit in metres: F1's 4-unit corridors come out 2.8 m wide. */
  unitM: 0.7,
  /** The camera's height off the floor. */
  eyeM: 1.6,
  /** The player's body, a circle on the floor plan. */
  radiusM: 0.35,

  /** Running, the default: constant, the same forwards, sideways and diagonally. */
  runMps: 4.4,
  /** Walking, with Shift held. */
  walkMps: 2.0,
  /** Speeding up: full run speed in about five frames at 60 Hz. */
  accelMps2: 60,
  /** Stopping, with no key held: from a run in about four frames. */
  stopMps2: 80,
  /** The movement update's fixed step. */
  stepS: 1 / 120,

  /** The radius of the disc drawn on a watched node's ground. */
  watchedM: 0.9,
  /** How near a locked door or the objective E works from. */
  reachM: 1.5,
  turnMs: FP_TURN_MS,
  /** Crossing into an area this many legal moves away plays them all; further, the player is held back. */
  maxHops: 3,
  /** An action the engine has not answered after this long is taken as refused. */
  answerS: 0.4,

  /** A doorway's clear width. */
  doorWidthM: 1.2,
  doorHeightM: 2.1,
  /** Half a wall's thickness: each room's walls stand this far inside its rectangle. */
  wallHalfM: 0.1,
  wallHeightM: 3.0,

  /** Mouse look, radians per pixel. */
  lookRadPerPx: 0.0022,
  /** Looking by dragging with the button held, where the mouse cannot be locked: radians per pixel. */
  dragRadPerPx: 0.004,
  /** Arrow-key turning, radians per second. */
  turnRadPerS: 2.4,
  /** How far up or down the view tips. */
  pitchLimitRad: 1.2,
  /** The view bob: two steps every this many metres walked. */
  strideM: 1.5,
  bobM: 0.035,

  /** A guard's glide from its last node to its new one when no turn clock sets the pace. */
  glideMs: 600,
});
