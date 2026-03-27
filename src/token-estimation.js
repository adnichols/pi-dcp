/**
 * Lightweight token estimation helpers.
 *
 * These deliberately avoid tokenizer/runtime dependencies and use a rough
 * chars/4 heuristic over a serialized approximation of the message payload.
 */

function serializeContent(content) {
    if (typeof content === "string") {
        return content;
    }
    if (!Array.isArray(content)) {
        try {
            return JSON.stringify(content ?? "");
        }
        catch {
            return String(content ?? "");
        }
    }
    return content
        .map((part) => {
        if (!part || typeof part !== "object") {
            return "";
        }
        if (part.type === "text") {
            return part.text || "";
        }
        if (part.type === "toolCall" || part.type === "tool_use") {
            try {
                return `[${part.type}:${part.name || "unknown"}:${JSON.stringify(part.arguments ?? part.input ?? {})}]`;
            }
            catch {
                return `[${part.type}:${part.name || "unknown"}]`;
            }
        }
        if (part.type === "tool_result") {
            try {
                return `[tool_result:${part.tool_use_id || "unknown"}:${JSON.stringify(part.content ?? "")}]`;
            }
            catch {
                return `[tool_result:${part.tool_use_id || "unknown"}]`;
            }
        }
        if (part.type === "image") {
            return `[image:${part.mimeType || part.source?.type || "unknown"}]`;
        }
        try {
            return JSON.stringify(part);
        }
        catch {
            return String(part);
        }
    })
        .join("\n");
}

function serializeMessage(message) {
    if (!message || typeof message !== "object") {
        return "";
    }
    if (message.role === "toolResult") {
        return [
            message.role,
            message.toolName || "",
            message.toolCallId || "",
            message.isError ? "error" : "ok",
            serializeContent(message.content),
        ].join("\n");
    }
    return [message.role || "unknown", serializeContent(message.content)].join("\n");
}

export function estimateTokensFromText(text) {
    if (typeof text !== "string" || text.length === 0) {
        return 0;
    }
    return Math.ceil(text.length / 4);
}

export function estimateMessageTokens(message) {
    return estimateTokensFromText(serializeMessage(message));
}

export function estimateToolResultPayloadTokens(message) {
    if (message?.role !== "toolResult") {
        return 0;
    }
    return estimateTokensFromText(serializeContent(message.content));
}

export function estimateRedactionSavings(originalMessage, redactedMessage) {
    return Math.max(0, estimateMessageTokens(originalMessage) - estimateMessageTokens(redactedMessage));
}

export function summarizeContextMessages(messages) {
    const summary = {
        totalMessages: Array.isArray(messages) ? messages.length : 0,
        estimatedTokens: 0,
        toolResultPayloadTokens: 0,
        roles: {
            user: { messages: 0, estimatedTokens: 0 },
            assistant: { messages: 0, estimatedTokens: 0 },
            toolResult: { messages: 0, estimatedTokens: 0 },
            other: { messages: 0, estimatedTokens: 0 },
        },
    };
    if (!Array.isArray(messages)) {
        return summary;
    }
    for (const message of messages) {
        const estimatedTokens = estimateMessageTokens(message);
        summary.estimatedTokens += estimatedTokens;
        if (message?.role === "user") {
            summary.roles.user.messages += 1;
            summary.roles.user.estimatedTokens += estimatedTokens;
            continue;
        }
        if (message?.role === "assistant") {
            summary.roles.assistant.messages += 1;
            summary.roles.assistant.estimatedTokens += estimatedTokens;
            continue;
        }
        if (message?.role === "toolResult") {
            summary.roles.toolResult.messages += 1;
            summary.roles.toolResult.estimatedTokens += estimatedTokens;
            summary.toolResultPayloadTokens += estimateToolResultPayloadTokens(message);
            continue;
        }
        summary.roles.other.messages += 1;
        summary.roles.other.estimatedTokens += estimatedTokens;
    }
    return summary;
}
