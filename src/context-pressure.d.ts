import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { DcpConfigWithPruneRuleObjects } from "./types.js";

export interface ContextPressureUsage {
    percent?: number;
    tokens?: number;
}

export interface ContextPressureSnapshot {
    usage: ContextPressureUsage | null;
    analysis: {
        totalMessages: number;
        originalMessageCount: number;
        filteredMessageCount: number;
        excludedMessageCount: number;
        roleCounts: {
            user: number;
            assistant: number;
            toolResult: number;
            other: number;
        };
        assistantToolCalls: number;
        repeatedReads: Array<{ path: string; count: number; signature: string; label: string; shortPath: string; shortLabel: string }>;
        repeatedBashCommands: Array<{ command: string; count: number; signature: string; shortCommand: string }>;
    };
    predicted: {
        prunedCount: number;
        redactedCount: number;
        estimatedTokensSaved: number;
        estimatedTokensPruned: number;
        estimatedTokensRedacted: number;
        pruneReasons: Record<string, number>;
        redactionReasons: Record<string, number>;
    };
    recommendation: "compact-now" | "clean-up-manually-first" | "wait";
    rationale: string[];
    summary: string;
    filteredMessages: AgentMessage[];
}

export declare const DEFAULT_EXCLUDED_TOOL_NAMES: string[];
export declare const DEFAULT_THRESHOLDS: {
    compactContextPercent: number;
    meaningfulSavingsTokens: number;
    repeatedOperationCount: number;
    manualCleanupMessages: number;
    manualCleanupToolResults: number;
};

export declare function getSessionMessages(entries: any[]): AgentMessage[];

export declare function getContextPressureSnapshot(
    messages: AgentMessage[] | any[],
    config: DcpConfigWithPruneRuleObjects,
    usage?: ContextPressureUsage,
    options?: {
        excludeToolNames?: string[];
        maxItems?: number;
        thresholds?: typeof DEFAULT_THRESHOLDS;
    },
): ContextPressureSnapshot;
