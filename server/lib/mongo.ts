import type { QueryFilter } from "mongoose";

/**
 * Mongoose 9 types filters strictly per model. Filters assembled at runtime from validated input
 * (dynamic keys, operator objects) go through this helper so call sites stay readable.
 */
export function qf<T = unknown>(filter: Record<string, unknown>): QueryFilter<T> {
  return filter as unknown as QueryFilter<T>;
}
