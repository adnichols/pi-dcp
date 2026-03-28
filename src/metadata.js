/**
 * Message metadata utilities
 */
import { posix as pathPosix } from "node:path";

/**
 * Wrap an AgentMessage with metadata container
 */
export function createMessageWithMetadata(message) {
    return {
        message,
        metadata: {},
    };
}

function unwrapMessage(entry) {
    if (entry && typeof entry === "object" && "message" in entry && entry.message) {
        return entry.message;
    }
    return entry;
}

function getContentParts(message) {
    if ("content" in message && Array.isArray(message.content)) {
        return message.content;
    }
    return [];
}

function serializeUnknown(value) {
    if (value === undefined)
        return "undefined";
    if (typeof value === "string")
        return value;
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}

function serializeToolResultContent(message) {
    if (!("content" in message))
        return "";
    if (typeof message.content === "string")
        return message.content;
    if (!Array.isArray(message.content))
        return serializeUnknown(message.content);
    return message.content
        .map((part) => {
        if (!part || typeof part !== "object")
            return "";
        if (part.type === "text")
            return part.text || "";
        if (part.type === "image")
            return `[image:${part.mimeType || "unknown"}]`;
        return serializeUnknown(part);
    })
        .join("");
}

export function normalizeFilePath(value) {
    if (typeof value !== "string")
        return null;
    const normalized = value.trim().replace(/\\/g, "/");
    if (normalized.length === 0)
        return null;
    const collapsed = pathPosix.normalize(normalized);
    return collapsed.length > 0 ? collapsed : null;
}
function normalizePathLike(value) {
    return normalizeFilePath(value);
}

function escapeRegExp(value) {
    return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegExp(pattern) {
    const normalized = normalizePathLike(pattern);
    if (!normalized) {
        return /^$/;
    }
    const placeholder = "__PI_DCP_DOUBLE_STAR__";
    const escaped = escapeRegExp(normalized)
        .replace(/\*\*/g, placeholder)
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]")
        .replace(new RegExp(placeholder, "g"), ".*");
    return new RegExp(`^${escaped}$`);
}

/**
 * Create a stable hash of message content for deduplication
 */
export function hashMessage(message) {
    let content = "";
    if (message.role === "toolResult") {
        const toolCallId = message.toolCallId || "unknown";
        const toolName = message.toolName || "unknown";
        const isError = message.isError ? "error" : "ok";
        content = `[toolResult:${toolName}:${toolCallId}:${isError}:${serializeToolResultContent(message)}]`;
    }
    else if ("content" in message) {
        if (typeof message.content === "string") {
            content = message.content;
        }
        else if (Array.isArray(message.content)) {
            content = message.content
                .map((part) => {
                if (!part || typeof part !== "object")
                    return "";
                if (part.type === "text")
                    return part.text || "";
                if (part.type === "image")
                    return `[image:${part.source?.type || part.mimeType || "unknown"}]`;
                if (part.type === "tool_use") {
                    return `[tool_use:${part.id || "unknown"}:${part.name || "unknown"}:${serializeUnknown(part.input)}]`;
                }
                if (part.type === "toolCall") {
                    return `[toolCall:${part.id || "unknown"}:${part.name || "unknown"}:${serializeUnknown(part.arguments)}]`;
                }
                if (part.type === "tool_result") {
                    return `[tool_result:${part.tool_use_id || "unknown"}:${serializeUnknown(part.content)}]`;
                }
                return serializeUnknown(part);
            })
                .join("");
        }
    }
    // Simple hash function (djb2)
    let hash = 5381;
    for (let i = 0; i < content.length; i++) {
        hash = (hash * 33) ^ content.charCodeAt(i);
    }
    return hash.toString(36);
}

/**
 * Extract normalized tool call descriptors from a message.
 */
export function extractToolCalls(message) {
    const descriptors = [];
    for (const part of getContentParts(message)) {
        if (!part || typeof part !== "object")
            continue;
        if (part.type !== "tool_use" && part.type !== "toolCall")
            continue;
        descriptors.push({
            id: part.id,
            name: part.name,
            args: part.arguments ?? part.input,
        });
    }
    return descriptors.filter((descriptor) => typeof descriptor.id === "string" && descriptor.id.length > 0);
}

/**
 * Resolve the assistant-side tool call that produced a tool result.
 */
export function findMatchingToolCall(messages, toolCallId, beforeIndex = messages.length) {
    if (!toolCallId)
        return undefined;
    const safeEnd = Math.max(0, Math.min(beforeIndex, messages.length));
    for (let i = safeEnd - 1; i >= 0; i--) {
        const message = unwrapMessage(messages[i]);
        const descriptors = extractToolCalls(message);
        const match = descriptors.find((descriptor) => descriptor.id === toolCallId);
        if (!match)
            continue;
        return {
            ...match,
            index: i,
        };
    }
    return undefined;
}

/**
 * Resolve the originating tool call metadata for a tool result.
 */
export function getToolResultDescriptor(message, messages, index = messages?.length ?? 0) {
    if (message.role !== "toolResult")
        return undefined;
    const match = Array.isArray(messages)
        ? findMatchingToolCall(messages, message.toolCallId, index)
        : undefined;
    return {
        toolCallId: message.toolCallId,
        toolName: message.toolName || match?.name,
        args: match?.args,
        toolCallIndex: match?.index,
    };
}

/**
 * Resolve a tool name from a message when available.
 */
export function getToolName(message, messages, index = messages?.length ?? 0) {
    if (message.role === "toolResult") {
        const descriptor = getToolResultDescriptor(message, messages, index);
        return descriptor?.toolName || message.toolName || undefined;
    }
    const toolCalls = extractToolCalls(message);
    if (toolCalls.length === 1 && typeof toolCalls[0]?.name === "string") {
        return toolCalls[0].name;
    }
    return undefined;
}

/**
 * Extract file path from read/write/edit tool results.
 * Falls back to the originating tool call arguments when tool result details omit the path.
 */
export function extractFilePath(message, messages, index = messages?.length ?? 0) {
    if (message.role !== "toolResult")
        return null;
    const details = message.details;
    const detailPath = normalizePathLike(details?.path) || normalizePathLike(details?.file);
    if (detailPath)
        return detailPath;
    const descriptor = getToolResultDescriptor(message, messages, index);
    const toolName = descriptor?.toolName || message.toolName;
    if (toolName !== "read" && toolName !== "write" && toolName !== "edit")
        return null;
    const args = descriptor?.args;
    if (args && typeof args === "object") {
        const argPath = normalizePathLike(args.path) || normalizePathLike(args.file);
        if (argPath) {
            return argPath;
        }
    }
    return null;
}

/**
 * Extract bash command from a tool result by looking at the originating tool call.
 */
export function extractCommand(message, messages, index = messages?.length ?? 0) {
    if (message.role !== "toolResult")
        return null;
    const details = message.details;
    if (typeof details?.command === "string" && details.command.length > 0) {
        return details.command;
    }
    const descriptor = getToolResultDescriptor(message, messages, index);
    const toolName = descriptor?.toolName || message.toolName;
    if (toolName !== "bash")
        return null;
    const args = descriptor?.args;
    if (args && typeof args === "object" && typeof args.command === "string" && args.command.length > 0) {
        return args.command;
    }
    return null;
}

function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeSignatureValue(value) {
    if (Array.isArray(value)) {
        return value.map((item) => normalizeSignatureValue(item));
    }
    if (isPlainObject(value)) {
        const normalized = {};
        for (const key of Object.keys(value).sort()) {
            const nextValue = normalizeSignatureValue(value[key]);
            if (nextValue === undefined || nextValue === null) {
                continue;
            }
            normalized[key] = nextValue;
        }
        return normalized;
    }
    return value;
}

function serializeSignatureValue(value) {
    try {
        return JSON.stringify(normalizeSignatureValue(value));
    }
    catch {
        return serializeUnknown(value);
    }
}

/**
 * Build a stable operation signature for supported tools.
 */
export function getToolArgumentsSignature(toolName, args, fallbacks = {}) {
    if (typeof toolName !== "string" || toolName.length === 0) {
        return null;
    }
    if (toolName === "read" || toolName === "bash") {
        let signatureArgs = isPlainObject(args) ? normalizeSignatureValue(args) : undefined;
        if (!signatureArgs) {
            if (toolName === "read" && fallbacks.filePath) {
                signatureArgs = { path: fallbacks.filePath };
            }
            if (toolName === "bash" && fallbacks.command) {
                signatureArgs = { command: fallbacks.command };
            }
        }
        if (!signatureArgs || (isPlainObject(signatureArgs) && Object.keys(signatureArgs).length === 0)) {
            return null;
        }
        return `${toolName}:exact:${serializeSignatureValue(signatureArgs)}`;
    }
    if (toolName === "write" || toolName === "edit") {
        const path = normalizePathLike(args?.path) || normalizePathLike(args?.file) || normalizePathLike(fallbacks.filePath);
        if (!path) {
            return null;
        }
        return `${toolName}:path:${serializeSignatureValue({ path })}`;
    }
    return null;
}

/**
 * Build a stable operation signature for result-side pruning.
 */
export function getOperationKey(message, messages, index = messages?.length ?? 0) {
    if (message.role !== "toolResult")
        return null;
    const descriptor = getToolResultDescriptor(message, messages, index);
    const toolName = descriptor?.toolName || message.toolName;
    if (!toolName)
        return null;
    return getToolArgumentsSignature(toolName, descriptor?.args, {
        filePath: extractFilePath(message, messages, index),
        command: extractCommand(message, messages, index),
    });
}

/**
 * Check if message is an error
 */
export function isErrorMessage(message) {
    if (message.role === "toolResult") {
        return !!message.isError;
    }
    // Check content for error patterns
    if ("content" in message) {
        const content = typeof message.content === "string" ? message.content : "";
        const errorPatterns = [/error:/i, /failed:/i, /exception:/i, /\[error\]/i];
        return errorPatterns.some((pattern) => pattern.test(content));
    }
    return false;
}

/**
 * Check if two messages represent the same operation (for error resolution tracking)
 */
export function isSameOperation(msg1, msg2) {
    if (msg1.role !== "toolResult" || msg2.role !== "toolResult")
        return false;
    const tool1 = getToolName(msg1);
    const tool2 = getToolName(msg2);
    if (tool1 !== tool2)
        return false;
    const signature1 = getOperationKey(msg1);
    const signature2 = getOperationKey(msg2);
    if (signature1 && signature2) {
        return signature1 === signature2;
    }
    // For file operations, check if same file (details-only fallback for callers without history)
    const path1 = extractFilePath(msg1);
    const path2 = extractFilePath(msg2);
    if (path1 && path2) {
        return path1 === path2;
    }
    // For other operations, compare the serialized operation payload
    return hashMessage(msg1) === hashMessage(msg2);
}

/**
 * Check whether a tool name is protected from destructive pruning actions.
 */
export function isProtectedToolName(toolName, config) {
    if (typeof toolName !== "string" || toolName.length === 0)
        return false;
    const protectedTools = Array.isArray(config?.protectedTools) ? config.protectedTools : [];
    return protectedTools.includes(toolName);
}

/**
 * Check whether a path matches any protected file pattern.
 */
export function isProtectedFilePath(filePath, config) {
    const normalizedPath = normalizePathLike(filePath);
    if (!normalizedPath)
        return false;
    const patterns = Array.isArray(config?.protectedFilePatterns) ? config.protectedFilePatterns : [];
    return patterns.some((pattern) => {
        const normalizedPattern = normalizePathLike(pattern);
        if (!normalizedPattern)
            return false;
        if (normalizedPattern === normalizedPath)
            return true;
        return globToRegExp(normalizedPattern).test(normalizedPath);
    });
}

/**
 * Count completed later user turns after a candidate message.
 * A later user turn counts only when there is at least one non-user message after it,
 * so the current trailing user request does not age older context by itself.
 */
export function countCompletedLaterUserTurns(messages, index) {
    if (!Array.isArray(messages) || index >= messages.length - 1) {
        return 0;
    }
    let seenNonUserAfter = false;
    let completedTurns = 0;
    for (let i = messages.length - 1; i > index; i -= 1) {
        const message = unwrapMessage(messages[i]);
        if (!message)
            continue;
        if (message.role !== "user") {
            seenNonUserAfter = true;
            continue;
        }
        if (seenNonUserAfter) {
            completedTurns += 1;
        }
    }
    return completedTurns;
}

/**
 * Evaluate whether a prune/redact action is blocked by configured protections or age gates.
 */
export function getDestructiveActionGuard(message, messages, index, config, minimumCompletedTurns = 0) {
    const toolName = getToolName(message, messages, index);
    const filePath = extractFilePath(message, messages, index);
    const laterCompletedUserTurns = countCompletedLaterUserTurns(messages, index);
    const protectedTool = isProtectedToolName(toolName, config);
    if (protectedTool) {
        return {
            allowed: false,
            reason: `protected tool: ${toolName}`,
            toolName,
            filePath,
            laterCompletedUserTurns,
            protectedTool,
            protectedFilePath: false,
        };
    }
    const protectedFilePath = isProtectedFilePath(filePath, config);
    if (protectedFilePath) {
        return {
            allowed: false,
            reason: `protected file: ${filePath}`,
            toolName,
            filePath,
            laterCompletedUserTurns,
            protectedTool: false,
            protectedFilePath,
        };
    }
    if (laterCompletedUserTurns < minimumCompletedTurns) {
        return {
            allowed: false,
            reason: `age gate not met: ${laterCompletedUserTurns}/${minimumCompletedTurns} completed user turns`,
            toolName,
            filePath,
            laterCompletedUserTurns,
            protectedTool: false,
            protectedFilePath: false,
        };
    }
    return {
        allowed: true,
        reason: undefined,
        toolName,
        filePath,
        laterCompletedUserTurns,
        protectedTool: false,
        protectedFilePath: false,
    };
}

/**
 * Resolve the effective destructive action for a message.
 */
export function getMessageAction(metadata) {
    if (metadata?.action === "prune" || metadata?.action === "redact" || metadata?.action === "keep") {
        return metadata.action;
    }
    return metadata?.shouldPrune ? "prune" : "keep";
}

/**
 * Check whether a message already has a destructive action assigned.
 */
export function hasDestructiveAction(metadata) {
    const action = getMessageAction(metadata);
    return action === "prune" || action === "redact";
}

/**
 * Mark a message for pruning.
 */
export function markForPrune(messageWithMetadata, reason, extraMetadata = {}) {
    messageWithMetadata.metadata.action = "prune";
    messageWithMetadata.metadata.shouldPrune = true;
    messageWithMetadata.metadata.pruneReason = reason;
    messageWithMetadata.metadata.redactionReason = undefined;
    messageWithMetadata.metadata.redactionKind = undefined;
    messageWithMetadata.metadata.redactedMessage = undefined;
    Object.assign(messageWithMetadata.metadata, extraMetadata);
}

/**
 * Mark a message for redaction.
 */
export function markForRedaction(messageWithMetadata, reason, extraMetadata = {}) {
    messageWithMetadata.metadata.action = "redact";
    messageWithMetadata.metadata.shouldPrune = false;
    messageWithMetadata.metadata.pruneReason = undefined;
    messageWithMetadata.metadata.redactionReason = reason;
    messageWithMetadata.metadata.providerSafetyPrune = undefined;
    messageWithMetadata.metadata.redactedMessage = undefined;
    Object.assign(messageWithMetadata.metadata, extraMetadata);
}

/**
 * Clear any prior prune/redact decision and keep the full message.
 */
export function clearDestructiveAction(messageWithMetadata) {
    messageWithMetadata.metadata.action = "keep";
    messageWithMetadata.metadata.shouldPrune = false;
    messageWithMetadata.metadata.pruneReason = undefined;
    messageWithMetadata.metadata.redactionReason = undefined;
    messageWithMetadata.metadata.redactionKind = undefined;
    messageWithMetadata.metadata.redactedMessage = undefined;
    messageWithMetadata.metadata.providerSafetyPrune = undefined;
}

/**
 * Extract tool call IDs from supported message shapes.
 */
export function extractToolUseIds(message) {
    const ids = new Set();
    if (message.role === "toolResult") {
        const toolCallId = message.toolCallId;
        if (typeof toolCallId === "string" && toolCallId.length > 0) {
            ids.add(toolCallId);
        }
    }
    for (const part of getContentParts(message)) {
        if (!part || typeof part !== "object")
            continue;
        if ((part.type === "tool_use" || part.type === "toolCall") && part.id) {
            ids.add(part.id);
        }
        if (part.type === "tool_result" && part.tool_use_id) {
            ids.add(part.tool_use_id);
        }
    }
    return Array.from(ids);
}

/**
 * Check if a message contains tool call blocks.
 */
export function hasToolUse(message) {
    return getContentParts(message).some((part) => part && typeof part === "object" && (part.type === "tool_use" || part.type === "toolCall"));
}

/**
 * Check if a message contains tool result content.
 */
export function hasToolResult(message) {
    if (message.role === "toolResult")
        return true;
    return getContentParts(message).some((part) => part && typeof part === "object" && part.type === "tool_result");
}

/**
 * Check whether a message participates in tool execution flow.
 */
export function isToolBearingMessage(message) {
    return hasToolUse(message) || hasToolResult(message);
}
