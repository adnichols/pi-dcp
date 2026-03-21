/**
 * Message metadata utilities
 */
/**
 * Wrap an AgentMessage with metadata container
 */
export function createMessageWithMetadata(message) {
    return {
        message,
        metadata: {},
    };
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
 * Extract file path from write/edit tool result
 */
export function extractFilePath(message) {
    if (message.role !== "toolResult")
        return null;
    const toolName = message.toolName;
    if (toolName !== "write" && toolName !== "edit")
        return null;
    // Try to extract from details
    const details = message.details;
    if (details?.path)
        return details.path;
    if (details?.file)
        return details.file;
    return null;
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
    const tool1 = msg1.toolName;
    const tool2 = msg2.toolName;
    if (tool1 !== tool2)
        return false;
    // For file operations, check if same file
    const path1 = extractFilePath(msg1);
    const path2 = extractFilePath(msg2);
    if (path1 && path2) {
        return path1 === path2;
    }
    // For other operations, compare the serialized operation payload
    return hashMessage(msg1) === hashMessage(msg2);
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
//# sourceMappingURL=metadata.js.map