/**
 * Deduplication Rule
 *
 * Removes duplicate non-tool messages based on content hash.
 * Tool-bearing messages are skipped because pruning whole tool-call or tool-result
 * messages can break provider-level pairing invariants.
 */
import type { PruneRule } from "../types.js";
export declare const deduplicationRule: PruneRule;
//# sourceMappingURL=deduplication.d.ts.map