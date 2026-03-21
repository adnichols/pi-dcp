/**
 * Error Purging Rule
 *
 * Removes resolved errors from context.
 * Assistant messages that contain tool calls are skipped because pruning the
 * call side can orphan provider-facing tool results. Top-level toolResult
 * messages may still be pruned when a later success supersedes them.
 */
import type { PruneRule } from "../types.js";
export declare const errorPurgingRule: PruneRule;
//# sourceMappingURL=error-purging.d.ts.map