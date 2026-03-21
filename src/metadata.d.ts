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
 * Extract file path from write/edit tool result
 */
export declare function extractFilePath(message: AgentMessage): string | null;
/**
 * Check if message is an error
 */
export declare function isErrorMessage(message: AgentMessage): boolean;
/**
 * Check if two messages represent the same operation (for error resolution tracking)
 */
export declare function isSameOperation(msg1: AgentMessage, msg2: AgentMessage): boolean;
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