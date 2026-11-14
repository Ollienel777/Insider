// Small building blocks shared by the domain schemas.
import { z } from "zod";

/** A non-empty identifier: building, node, room, zone, guard, entry, mission. */
export const Id = z.string().min(1);

/** A non-empty line of human-readable text. */
export const Text = z.string().min(1);

export const City = z.enum(["LA", "Houston"]);
export type City = z.infer<typeof City>;

/** Reports each value in `ids` that appears more than once. */
export function checkUnique(
  ids: readonly string[],
  what: string,
  path: (string | number)[],
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      ctx.addIssue({ code: "custom", path, message: `duplicate ${what} id "${id}"` });
    }
    seen.add(id);
  }
}
