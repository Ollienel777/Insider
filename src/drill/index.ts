// Drill Mode's simulation (SPEC §2 beat 7, D21). The drill screen (#24) and
// the printable plan (#34) read a `DrillReport` from `simulateDrill`.
export {
  DRILL_FLOOR,
  DrillError,
  headcountFor,
  placeOccupants,
  resolveDrillFloor,
  SF_PER_PERSON,
  type DrillFloorChoice,
  type Headcount,
  type Placement,
} from "./occupancy";
export {
  NODE_CAPACITY,
  simulateDrill,
  TICK_S,
  WALK_SPEED_M_S,
  type Bottleneck,
  type DrillOccupant,
  type DrillOptions,
  type DrillReport,
  type DrillScenario,
  type DrillZone,
  type StrandedOccupant,
  type WardenPost,
} from "./simulate";
export { DrillFacts, drillFacts } from "./facts";
