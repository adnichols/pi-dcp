/**
 * Superseded Writes Rule
 *
 * Removes older non-tool file write/edit messages when a later successful version exists.
 * Top-level tool results are allowed here so stale successful writes can be dropped,
 * but failed retries must not supersede the last known-good write result.
 */
import type { PruneRule } from "../types.js";
export declare const supersededWritesRule: PruneRule;
//# sourceMappingURL=superseded-writes.d.ts.map