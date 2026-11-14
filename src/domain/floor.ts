// The board: nodes, edges, rooms and sightlines (SPEC §4.1). In live mode it
// is built from Matterport in the browser and held in memory only (SPEC §4.5).
// The schema checks that every reference resolves, so the engine can index
// nodes and rooms without guarding against dangling ids.
import { z } from "zod";
import { checkUnique, Id, Text } from "./common";

export const NodeTag = z.enum(["stair", "lift", "entry"]);
export type NodeTag = z.infer<typeof NodeTag>;

export const FloorNode = z.object({
  id: Id,
  x: z.number(),
  y: z.number(),
  roomId: Id,
  tags: z.array(NodeTag),
});
export type FloorNode = z.infer<typeof FloorNode>;

export const Door = z.object({ id: Id, lockable: z.boolean() });
export type Door = z.infer<typeof Door>;

/** An undirected edge between nodes `a` and `b`. */
export const FloorEdge = z.object({ a: Id, b: Id, door: Door.optional() });
export type FloorEdge = z.infer<typeof FloorEdge>;

export const Rect = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
});
export type Rect = z.infer<typeof Rect>;

export const Room = z.object({ id: Id, label: Text, rect: Rect });
export type Room = z.infer<typeof Room>;

export const FloorGraph = z
  .object({
    nodes: z.array(FloorNode).min(1),
    edges: z.array(FloorEdge),
    rooms: z.array(Room).min(1),
    /** node id -> the node ids visible from it. */
    sightlines: z.record(Id, z.array(Id)),
    source: z.enum(["matterport", "fixture"]),
  })
  .superRefine((graph, ctx) => {
    checkUnique(graph.nodes.map((n) => n.id), "node", ["nodes"], ctx);
    checkUnique(graph.rooms.map((r) => r.id), "room", ["rooms"], ctx);
    const doorIds = graph.edges.flatMap((e) => (e.door ? [e.door.id] : []));
    checkUnique(doorIds, "door", ["edges"], ctx);

    const nodes = new Set(graph.nodes.map((n) => n.id));
    const rooms = new Set(graph.rooms.map((r) => r.id));
    const report = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });

    graph.nodes.forEach((node, i) => {
      if (!rooms.has(node.roomId)) {
        report(["nodes", i, "roomId"], `node "${node.id}" is in unknown room "${node.roomId}"`);
      }
    });
    graph.edges.forEach((edge, i) => {
      for (const end of ["a", "b"] as const) {
        if (!nodes.has(edge[end])) {
          report(["edges", i, end], `edge ends at unknown node "${edge[end]}"`);
        }
      }
      if (edge.a === edge.b) report(["edges", i], `edge loops on node "${edge.a}"`);
    });
    for (const [from, seen] of Object.entries(graph.sightlines)) {
      if (!nodes.has(from)) report(["sightlines", from], `sightline from unknown node "${from}"`);
      for (const to of seen) {
        if (!nodes.has(to)) report(["sightlines", from], `sightline to unknown node "${to}"`);
      }
    }
  });
export type FloorGraph = z.infer<typeof FloorGraph>;
