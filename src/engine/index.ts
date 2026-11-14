// The turn engine (SPEC §4.2, D9, D10): pure, seeded and authoritative.
// Start a run with `createRun(level)`, play it with `act`, steer guards with
// `orderGuard`, set the alarm with `setAlarm`, and read the log with
// `toRunLog` and the alarm's transitions from `run.alarmEvents`.
export { act, type Action, type ActResult } from "./actions";
export { HOLD, LEVELS, setAlarm, type AlarmCause, type AlarmEvent } from "./alarm";
export { moveGuards, orderGuard, type OrderResult } from "./guards";
export { toRunLog } from "./log";
export { hearingRange, withinHops } from "./noise";
export { neighbours, shortestPath } from "./path";
export {
  compileBoard,
  createRun,
  DEFAULT_HEARING,
  LevelError,
  zoneOf,
  type Board,
  type Camera,
  type CameraSpec,
  type Exit,
  type Facing,
  type GuardSpec,
  type GuardState,
  type Level,
  type RunState,
  type RunStatus,
  type ZoneTarget,
} from "./state";
export { visibleFrom, watched } from "./vision";
