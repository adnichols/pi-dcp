/**
 * DCP Stats Command
 *
 * Show pruning statistics for the current session.
 */
import { CommandDefinition } from "../types.js";
export interface StatsTracker {
    totalPruned: number;
    totalRedacted?: number;
    totalProcessed: number;
    totalNudges?: number;
    estimatedTokensPruned?: number;
    estimatedTokensRedacted?: number;
    lastEstimatedTokensSaved?: number;
    lastProcessed?: number;
    lastPruned?: number;
    lastRedacted?: number;
    maxMessagesSeen?: number;
    lastPressureSummary?: string;
    lastContextSummary?: {
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
    lastNudge?: {
        at: string;
        summary: string;
        totalMessages: number;
    };
}
export declare function createStatsCommand(statsTracker: StatsTracker, ruleCount: number): CommandDefinition;
