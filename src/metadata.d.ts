/**
 * Message metadata utilities
 */
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { MessageWithMetadata } from "./types.js";
/**
 * Wrap an AgentMessage with metadata container
 */
export declare function createMessageWithMetadata(message: AgentMessage): MessageWithMetadata;
/**
 * Create a stable hash of message content for deduplication
 */
export declare function hashMessage(message: AgentMessage): string;
/**
 * Resolve a tool name from a message when available.
 */
export declare function getToolName(message: AgentMessage, messages?: MessageWithMetadata[] | AgentMessage[], index?: number): string | undefined;
/**
 * Extract file path from write/edit tool result
 */
export declare function extractFilePath(message: AgentMessage, messages?: MessageWithMetadata[] | AgentMessage[], index?: number): string | null;
/**
 * Extract bash command from a tool result by looking at the originating tool call.
 */
export declare function extractCommand(message: AgentMessage, messages?: MessageWithMetadata[] | AgentMessage[], index?: number): string | null;
/**
 * Build a stable operation signature for supported tools.
 */
export declare function getToolArgumentsSignature(toolName: string | undefined, args: unknown, fallbacks?: {
    filePath?: string | null;
    command?: string | null;
}): string | null;
/**
 * Build a stable operation signature for result-side pruning.
 */
export declare function getOperationKey(message: AgentMessage, messages?: MessageWithMetadata[] | AgentMessage[], index?: number): string | null;
/**
 * Check if message is an error
 */
export declare function isErrorMessage(message: AgentMessage): boolean;
/**
 * Check if two messages represent the same operation (for error resolution tracking)
 */
export declare function isSameOperation(msg1: AgentMessage, msg2: AgentMessage): boolean;
/**
 * Check whether a tool name is protected from destructive pruning actions.
 */
export declare function isProtectedToolName(toolName: string | undefined, config?: {
    protectedTools?: string[];
}): boolean;
/**
 * Check whether a path matches any protected file pattern.
 */
export declare function isProtectedFilePath(filePath: string | null | undefined, config?: {
    protectedFilePatterns?: string[];
}): boolean;
/**
 * Count completed later user turns after a candidate message.
 */
export declare function countCompletedLaterUserTurns(messages: MessageWithMetadata[] | AgentMessage[], index: number): number;
/**
 * Evaluate whether a prune/redact action is blocked by configured protections or age gates.
 */
export declare function getDestructiveActionGuard(message: AgentMessage, messages: MessageWithMetadata[] | AgentMessage[], index: number, config: {
    protectedTools?: string[];
    protectedFilePatterns?: string[];
}, minimumCompletedTurns?: number): {
    allowed: boolean;
    reason?: string;
    toolName?: string;
    filePath: string | null;
    laterCompletedUserTurns: number;
    protectedTool: boolean;
    protectedFilePath: boolean;
};
/**
 * Resolve the effective destructive action for a message.
 */
export declare function getMessageAction(metadata: MessageWithMetadata["metadata"]): "keep" | "prune" | "redact";
/**
 * Check whether a message already has a destructive action assigned.
 */
export declare function hasDestructiveAction(metadata: MessageWithMetadata["metadata"]): boolean;
/**
 * Mark a message for pruning.
 */
export declare function markForPrune(messageWithMetadata: MessageWithMetadata, reason: string, extraMetadata?: Record<string, unknown>): void;
/**
 * Mark a message for redaction.
 */
export declare function markForRedaction(messageWithMetadata: MessageWithMetadata, reason: string, extraMetadata?: Record<string, unknown>): void;
/**
 * Clear any prior prune/redact decision and keep the full message.
 */
export declare function clearDestructiveAction(messageWithMetadata: MessageWithMetadata): void;
/**
 * Extract tool call IDs from supported message shapes.
 */
export declare function extractToolUseIds(message: AgentMessage): string[];
/**
 * Check if a message contains tool call blocks.
 */
export declare function hasToolUse(message: AgentMessage): boolean;
/**
 * Check if a message contains tool result content.
 */
export declare function hasToolResult(message: AgentMessage): boolean;
/**
 * Check whether a message participates in tool execution flow.
 */
export declare function isToolBearingMessage(message: AgentMessage): boolean;
//# sourceMappingURL=metadata.d.ts.map