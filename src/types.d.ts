/**
 * Core type definitions for Pi-DCP
 */
import type { AgentMessage } from "@mariozechner/pi-agent-core";
/**
 * Message with pruning metadata attached
 */
export interface MessageWithMetadata {
    /** Original message from pi */
    message: AgentMessage;
    /** Pruning metadata annotated by rules */
    metadata: MessageMetadata;
}
/**
 * Metadata attached to messages during prepare/process phases
 */
export interface MessageMetadata {
    /** Content hash for deduplication */
    hash?: string;
    /** Resolved tool name when available */
    toolName?: string;
    /** File path for superseded writes tracking */
    filePath?: string;
    /** File content version for superseded writes */
    fileVersion?: string;
    /** Whether message is an error */
    isError?: boolean;
    /** Whether error was resolved by later success */
    errorResolved?: boolean;
    /** Completed later user turns after this message */
    laterCompletedUserTurns?: number;
    /** Whether destructive cleanup is blocked by tool protection */
    protectedTool?: boolean;
    /** Whether destructive cleanup is blocked by file protection */
    protectedFilePath?: boolean;
    /** Why a destructive cleanup decision was blocked */
    destructiveActionBlockedReason?: string;
    /** Effective action selected by pruning rules */
    action?: "keep" | "prune" | "redact";
    /** Reason for redaction when action is redact */
    redactionReason?: string;
    /** Workflow-specific redaction strategy */
    redactionKind?: string;
    /** Optional replacement message prepared by a rule */
    redactedMessage?: AgentMessage;
    /** Whether a prune is required for provider safety */
    providerSafetyPrune?: boolean;
    /** Recency score (distance from end) */
    recencyScore?: number;
    /** Whether protected by recency rule */
    protectedByRecency?: boolean;
    /** Final decision: should this message be pruned? */
    shouldPrune?: boolean;
    /** Reason for pruning (for debugging) */
    pruneReason?: string;
    /** Extensible: custom rule metadata */
    [key: string]: any;
}
/**
 * Context provided to prepare phase
 */
export interface PrepareContext {
    /** All messages being prepared */
    messages: MessageWithMetadata[];
    /** Current message index */
    index: number;
    /** Extension configuration */
    config: DcpConfigWithPruneRuleObjects;
}
/**
 * Context provided to process phase
 */
export interface ProcessContext {
    /** All messages with metadata from prepare phase */
    messages: MessageWithMetadata[];
    /** Current message index */
    index: number;
    /** Extension configuration */
    config: DcpConfigWithPruneRuleObjects;
}
/**
 * Pruning rule definition
 */
export interface PruneRule {
    /** Unique rule identifier */
    name: string;
    /** Human-readable description */
    description?: string;
    /** Prepare phase: annotate metadata */
    prepare?: (msg: MessageWithMetadata, context: PrepareContext) => void;
    /** Process phase: make pruning decisions */
    process?: (msg: MessageWithMetadata, context: ProcessContext) => void;
}
export declare const isPruneRuleObject: (obj: unknown) => obj is PruneRule;
/**
 * Extension configuration
 */
export interface DcpConfig {
    /** Master enable/disable toggle */
    enabled?: boolean;
    /** Enable debug logging */
    debug?: boolean;
    /** Always keep last N messages */
    keepRecentCount: number;
    /** Tool names that normal cleanup rules must never prune/redact */
    protectedTools?: string[];
    /** File paths or glob patterns that normal cleanup rules must never prune/redact */
    protectedFilePatterns?: string[];
    /** Minimum completed later user turns required before destructive cleanup is allowed */
    ageGates?: {
        supersededToolResults?: number;
        errorPurging?: number;
        supersededWrites?: number;
        staleFileReads?: number;
    };
    /** Redaction feature toggles for action-aware workflow stages */
    redaction?: {
        supersededToolResults?: boolean;
        resolvedErrors?: boolean;
        staleFileReads?: boolean;
    };
    /** Optional log directory override */
    logDir?: string;
    /** Optional long-session nudging configuration */
    nudge?: {
        enabled?: boolean;
        minMessages?: number;
        minToolResults?: number;
        minRepeatCount?: number;
        minContextPercent?: number;
        notify?: boolean;
        maxSummaryItems?: number;
    };
}
export type DcpConfigWithPruneRuleObjects = DcpConfig & {
    rules: PruneRule[];
};
export type DcpConfigWithRuleRefs = DcpConfig & {
    rules: (string | PruneRule)[];
};
export type CommandDefinition = any;
/**
 * Stats tracker for pruning statistics
 */
export interface StatsTracker {
    /** Total messages pruned */
    totalPruned: number;
    /** Total messages redacted */
    totalRedacted?: number;
    /** Total messages processed */
    totalProcessed: number;
    /** Estimated tokens removed by pruning */
    estimatedTokensPruned?: number;
    /** Estimated tokens removed by redaction */
    estimatedTokensRedacted?: number;
    /** Estimated tokens saved in the last workflow run */
    lastEstimatedTokensSaved?: number;
    totalNudges?: number;
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
//# sourceMappingURL=types.d.ts.map