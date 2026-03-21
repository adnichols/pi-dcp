/**
 * Recency Rule
 *
 * Always preserves recent messages from pruning.
 * The last N messages (configurable via keepRecentCount) are protected,
 * except for tool-result messages that another rule has already chosen to prune.
 * Those prunes preserve provider replay invariants or intentional result-side cleanup
 * and must remain in force even when the messages are recent.
 *
 * This rule should typically run LAST in the process phase to override
 * other pruning decisions for recent messages.
 */
import type { PruneRule } from "../types.js";
export declare const recencyRule: PruneRule;
//# sourceMappingURL=recency.d.ts.map