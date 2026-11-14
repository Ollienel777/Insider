// The Security Chief's orders, clamped to the board (SPEC §4.2, §4.4). The
// model names guards and zones; anything the level does not have is dropped
// with a reason, never thrown. A kept order sets the guard's target from its
// next hop, and the guard still moves one hop per tempo by A*, so no order
// can teleport a guard or walk it through a wall. A locked zone gets every
// lockable door on its edge locked.
//
// Orders answer an alarm, so they last only while there is one: at Calm every
// order and lock is dropped (a late answer to an event the alarm has since
// decayed from), and the decay to Calm ends the Chief's targets and unlocks
// the doors the Chief locked (alarm.ts), a level door the player picked open
// and the Chief then re-locked among them. Doors the level locked and nobody
// opened stay locked.
import type { ChiefOrders, GuardOrder } from "@/domain";
import { orderGuard } from "./guards";
import { zoneTarget, type RunState } from "./state";

export interface DroppedOrder {
  /** The order as the Chief gave it, or the zone it asked to lock. */
  order: GuardOrder | { lockZone: string };
  reason: string;
}

export interface AppliedOrders {
  run: RunState;
  /** The orders kept, in the Chief's order. A guard ordered twice keeps its last order. */
  applied: GuardOrder[];
  /** The zones locked, and the doors this order locked (empty when they all were already). */
  locked: { zoneId: string; doors: string[] }[];
  dropped: DroppedOrder[];
}

/**
 * Applies the Chief's orders to the run, from the guards' next hop. Unknown
 * guards and zones are dropped, and at Calm everything is. The orders are
 * kept on the run, so the next turn's log entry carries them (RunTurn.chief).
 */
export function applyChiefOrders(run: RunState, chief: ChiefOrders): AppliedOrders {
  let state = run;
  const applied: GuardOrder[] = [];
  const dropped: DroppedOrder[] = [];
  if (run.alarm === "calm") {
    const reason = "the alarm is calm";
    dropped.push(...chief.orders.map((order) => ({ order, reason })));
    dropped.push(...chief.lockZones.map((lockZone) => ({ order: { lockZone }, reason })));
    return { run: { ...run, chief }, applied, locked: [], dropped };
  }
  for (const order of chief.orders) {
    const result = orderGuard(state, order.guardId, order.zoneId, order.intent);
    if (!result.ok) {
      dropped.push({ order, reason: result.reason });
      continue;
    }
    state = result.run;
    applied.push(order);
  }

  const locked: AppliedOrders["locked"] = [];
  let doors = new Set(state.locked);
  for (const zoneId of chief.lockZones) {
    const zone = zoneTarget(state.board, zoneId);
    if (!zone) {
      dropped.push({ order: { lockZone: zoneId }, reason: `no zone "${zoneId}"` });
      continue;
    }
    const inside = new Set(zone.nodes);
    const edge = state.board.level.floor.edges.filter((e) => e.door?.lockable && inside.has(e.a) !== inside.has(e.b));
    if (edge.length === 0) {
      dropped.push({ order: { lockZone: zoneId }, reason: `zone "${zoneId}" has no lockable door` });
      continue;
    }
    // Doors already locked stay locked; `doors` lists only the ones this order locked.
    const ids = edge.map((e) => e.door!.id).filter((id) => !doors.has(id));
    doors = new Set([...doors, ...ids]);
    locked.push({ zoneId, doors: ids });
  }
  const chiefLocks = [...new Set([...state.chiefLocks, ...locked.flatMap((l) => l.doors)])].sort();
  state = { ...state, locked: [...doors].sort(), chiefLocks, chief };
  return { run: state, applied, locked, dropped };
}
