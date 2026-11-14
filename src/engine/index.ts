// The turn engine (SPEC §4.2, D9): pure, seeded and authoritative. Start a
// run with `createRun(level)`, play it with `act`, steer guards with
// `orderGuard`, and read the log with `toRunLog`.
export { act, type Action, type ActResult } from "./actions";
export { moveGuards, orderGuard, setAlarm, type OrderResult } from "./guards";
export { toRunLog } from "./log";
export { neighbours, shortestPath } from "./path";
export {
  compileBoard,
  createRun,
  LevelError,
  type Board,
  type Exit,
  type GuardSpec,
  type GuardState,
  type Level,
  type RunState,
  type RunStatus,
} from "./state";
