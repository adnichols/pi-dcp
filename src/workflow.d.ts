/**
 * Pruning workflow engine
 *
 * Implements the prepare > process > filter workflow for message pruning.
 */
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { DcpConfigWithPruneRuleObjects, MessageWithMetadata } from "./types.js";
/**
 * Main workflow: prepare > process > filter
 *
 * @param messages - Original messages from pi
 * @param config - DCP configuration
 * @returns Filtered messages with pruned items removed
 */
export declare function applyPruningWorkflow(messages: AgentMessage[], config: DcpConfigWithPruneRuleObjects): AgentMessage[];
/**
 * Get pruning statistics (for future /dcp-stats command)
 */
export interface PruningStats {
    totalMessages: number;
    prunedCount: number;
    keptCount: number;
    pruneReasons: Record<string, number>;
}
export declare function getPruningStats(withMetadata: MessageWithMetadata[]): PruningStats;
//# sourceMappingURL=workflow.d.ts.map