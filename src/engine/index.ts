// The turn engine (SPEC §4.2, D9, D10): pure, seeded and authoritative.
// Start a run with `createRun(level)`, play it with `act`, steer guards with
// `orderGuard` or a whole Chief re-plan with `applyChiefOrders`, set the
// alarm with `setAlarm`, and read the log with `toRunLog` and the alarm's
// transitions from `run.alarmEvents`.
export { act, type Action, type ActResult } from "./actions";
export { HOLD, LEVELS, setAlarm, type AlarmCause, type AlarmEvent } from "./alarm";
export { moveGuards, orderGuard, plannedPath, type OrderResult } from "./guards";
export { RUN_RULES, toRunLog } from "./log";
export { hearingRange, withinHops } from "./noise";
export { applyChiefOrders, type AppliedOrders, type DroppedOrder } from "./orders";
export { neighbours, shortestPath } from "./path";
export {
  compileBoard,
  createRun,
  DEFAULT_HEARING,
  LevelError,
  zoneOf,
  zoneTarget,
  type Board,
  type Camera,
  type CameraSpec,
  type Exit,
  type Facing,
  type GuardSpec,
  type GuardState,
  type GuardTarget,
  type Level,
  type RunState,
  type RunStatus,
  type Sighted,
  type ZoneTarget,
} from "./state";
export { visibleFrom, watched } from "./vision";
