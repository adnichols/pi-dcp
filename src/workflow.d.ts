/**
 * Pruning workflow engine
 *
 * Implements the prepare > process > mutate > filter workflow for message pruning.
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
 * Detailed workflow result including metadata and estimated savings.
 */
export interface WorkflowResult {
    messages: AgentMessage[];
    withMetadata: MessageWithMetadata[];
    stats: PruningStats;
    originalContextSummary: {
        totalMessages: number;
        estimatedTokens: number;
        toolResultPayloadTokens: number;
        roles: {
            user: { messages: number; estimatedTokens: number };
            assistant: { messages: number; estimatedTokens: number };
            toolResult: { messages: number; estimatedTokens: number };
            other: { messages: number; estimatedTokens: number };
        };
    };
    finalContextSummary: {
        totalMessages: number;
        estimatedTokens: number;
        toolResultPayloadTokens: number;
        roles: {
            user: { messages: number; estimatedTokens: number };
            assistant: { messages: number; estimatedTokens: number };
            toolResult: { messages: number; estimatedTokens: number };
            other: { messages: number; estimatedTokens: number };
        };
    };
}
export declare function applyPruningWorkflowDetailed(messages: AgentMessage[], config: DcpConfigWithPruneRuleObjects): WorkflowResult;
/**
 * Get pruning statistics (for future /dcp-stats command)
 */
export interface PruningStats {
    totalMessages: number;
    prunedCount: number;
    redactedCount: number;
    keptCount: number;
    pruneReasons: Record<string, number>;
    redactionReasons: Record<string, number>;
    estimatedTokensPruned: number;
    estimatedTokensRedacted: number;
    estimatedTokensSaved: number;
}
export declare function getPruningStats(withMetadata: MessageWithMetadata[]): PruningStats;
