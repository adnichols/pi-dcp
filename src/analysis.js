/**
 * Conversation analysis helpers for status and long-session nudging.
 */
import { extractToolCalls, getToolArgumentsSignature } from "./metadata.js";

function collectMessages(input) {
    if (!Array.isArray(input))
        return [];
    if (input.length === 0)
        return [];
    if (input[0] && typeof input[0] === "object" && "message" in input[0] && "metadata" in input[0]) {
        return input.map((entry) => entry.message);
    }
    return input;
}

function shortenPath(value) {
    if (typeof value !== "string" || value.length === 0)
        return value;
    const normalized = value.replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length <= 3)
        return normalized;
    return parts.slice(-3).join("/");
}

function shortenCommand(value, maxLength = 60) {
    if (typeof value !== "string" || value.length <= maxLength)
        return value;
    return `${value.slice(0, maxLength - 1)}…`;
}

function describeReadArgs(args) {
    const path = typeof args?.path === "string" ? args.path : undefined;
    if (!path) {
        return undefined;
    }
    const offset = Number.isFinite(args?.offset) ? `@${args.offset}` : "";
    const limit = Number.isFinite(args?.limit) ? `#${args.limit}` : "";
    return `${path}${offset}${limit}`;
}

function incrementRepeatedOperation(map, signature, payload) {
    const existing = map.get(signature);
    if (existing) {
        existing.count += 1;
        return;
    }
    map.set(signature, {
        ...payload,
        count: 1,
    });
}

export function analyzeConversationPressure(input) {
    const messages = collectMessages(input);
    const roleCounts = { user: 0, assistant: 0, toolResult: 0, other: 0 };
    const toolCallById = new Map();
    const readCounts = new Map();
    const bashCounts = new Map();
    let assistantToolCalls = 0;
    for (const message of messages) {
        const role = message?.role;
        if (role === "user")
            roleCounts.user += 1;
        else if (role === "assistant")
            roleCounts.assistant += 1;
        else if (role === "toolResult")
            roleCounts.toolResult += 1;
        else
            roleCounts.other += 1;
        if (role !== "assistant")
            continue;
        const toolCalls = extractToolCalls(message);
        assistantToolCalls += toolCalls.length;
        for (const descriptor of toolCalls) {
            toolCallById.set(descriptor.id, descriptor);
        }
    }
    for (const message of messages) {
        if (message?.role !== "toolResult")
            continue;
        const descriptor = toolCallById.get(message.toolCallId);
        const toolName = message.toolName || descriptor?.name;
        const args = descriptor?.args;
        if (toolName === "read") {
            const signature = getToolArgumentsSignature(toolName, args, {
                filePath: typeof args?.path === "string" ? args.path : undefined,
            });
            const path = typeof args?.path === "string" ? args.path : undefined;
            if (signature && path) {
                incrementRepeatedOperation(readCounts, signature, {
                    signature,
                    path,
                    label: describeReadArgs(args) || path,
                    shortPath: shortenPath(path),
                });
            }
        }
        if (toolName === "bash") {
            const signature = getToolArgumentsSignature(toolName, args, {
                command: typeof args?.command === "string" ? args.command : undefined,
            });
            const command = typeof args?.command === "string" ? args.command : undefined;
            if (signature && command) {
                incrementRepeatedOperation(bashCounts, signature, {
                    signature,
                    command,
                    shortCommand: shortenCommand(command),
                });
            }
        }
    }
    const repeatedReads = Array.from(readCounts.values())
        .filter((entry) => entry.count > 1)
        .sort((a, b) => b.count - a.count)
        .map((entry) => ({
        path: entry.path,
        count: entry.count,
        signature: entry.signature,
        label: entry.label,
        shortPath: entry.shortPath,
        shortLabel: shortenPath(entry.label),
    }));
    const repeatedBashCommands = Array.from(bashCounts.values())
        .filter((entry) => entry.count > 1)
        .sort((a, b) => b.count - a.count)
        .map((entry) => ({
        command: entry.command,
        count: entry.count,
        signature: entry.signature,
        shortCommand: entry.shortCommand,
    }));
    return {
        totalMessages: messages.length,
        roleCounts,
        assistantToolCalls,
        repeatedReads,
        repeatedBashCommands,
    };
}

export function formatPressureSummary(analysis, options = {}) {
    const maxItems = options.maxItems ?? 2;
    const parts = [`${analysis.totalMessages} msgs`, `${analysis.roleCounts.toolResult} tool results`];
    if (analysis.repeatedReads.length > 0) {
        const reads = analysis.repeatedReads
            .slice(0, maxItems)
            .map((entry) => `${entry.shortLabel || entry.shortPath}×${entry.count}`)
            .join(", ");
        parts.push(`reads ${reads}`);
    }
    if (analysis.repeatedBashCommands.length > 0) {
        const commands = analysis.repeatedBashCommands
            .slice(0, maxItems)
            .map((entry) => `${entry.shortCommand}×${entry.count}`)
            .join(", ");
        parts.push(`bash ${commands}`);
    }
    return parts.join(" · ");
}
