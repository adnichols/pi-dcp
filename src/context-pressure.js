/**
 * Shared context pressure and compaction recommendation helpers.
 */
import { analyzeConversationPressure, formatPressureSummary } from "./analysis.js";
import { extractToolCalls } from "./metadata.js";
import { applyPruningWorkflowDetailed } from "./workflow.js";

const DEFAULT_EXCLUDED_TOOL_NAMES = ["dcp_pressure", "dcp_compact"];
const DEFAULT_THRESHOLDS = {
    compactContextPercent: 80,
    meaningfulSavingsTokens: 400,
    repeatedOperationCount: 2,
    manualCleanupMessages: 60,
    manualCleanupToolResults: 30,
};

export function getSessionMessages(entries) {
    if (!Array.isArray(entries)) {
        return [];
    }
    if (entries.length === 0) {
        return [];
    }
    if (entries[0] && typeof entries[0] === "object" && "type" in entries[0] && entries[0].type === "message") {
        return entries
            .filter((entry) => entry?.type === "message" && entry.message && typeof entry.message === "object")
            .map((entry) => entry.message);
    }
    return entries;
}
function filterMessagesForPressure(messages, excludeToolNames = DEFAULT_EXCLUDED_TOOL_NAMES) {
    if (!Array.isArray(messages) || excludeToolNames.length === 0) {
        return Array.isArray(messages) ? [...messages] : [];
    }
    const excludedNames = new Set(excludeToolNames);
    const excludedToolCallIds = new Set();
    return messages.filter((message) => {
        if (message?.role === "assistant") {
            const toolCalls = extractToolCalls(message);
            if (toolCalls.length > 0 && toolCalls.every((toolCall) => excludedNames.has(toolCall.name))) {
                for (const toolCall of toolCalls) {
                    excludedToolCallIds.add(toolCall.id);
                }
                return false;
            }
        }
        if (message?.role === "toolResult") {
            if (excludedNames.has(message.toolName)) {
                return false;
            }
            if (message.toolCallId && excludedToolCallIds.has(message.toolCallId)) {
                return false;
            }
        }
        return true;
    });
}

function countRepeatedPressure(analysis) {
    const repeatedReads = analysis.repeatedReads.reduce((max, entry) => Math.max(max, entry.count), 0);
    const repeatedBashCommands = analysis.repeatedBashCommands.reduce((max, entry) => Math.max(max, entry.count), 0);
    return Math.max(repeatedReads, repeatedBashCommands);
}

function buildRecommendation(analysis, predicted, usage, thresholds = DEFAULT_THRESHOLDS) {
    const rationale = [];
    const repeatedPressure = countRepeatedPressure(analysis);
    const meaningfulSavings = predicted.estimatedTokensSaved >= thresholds.meaningfulSavingsTokens;
    const contextPercent = typeof usage?.percent === "number" ? usage.percent : undefined;

    if (typeof contextPercent === "number" && contextPercent >= thresholds.compactContextPercent) {
        rationale.push(`context usage is high at ${contextPercent.toFixed(0)}%`);
        return {
            recommendation: "compact-now",
            rationale,
        };
    }

    if (repeatedPressure >= thresholds.repeatedOperationCount && meaningfulSavings) {
        rationale.push(`repeated inspection churn is present (${repeatedPressure} repeated observations)`);
        rationale.push(`predicted DCP savings are meaningful (~${predicted.estimatedTokensSaved} tokens)`);
        return {
            recommendation: "compact-now",
            rationale,
        };
    }

    if (analysis.totalMessages >= thresholds.manualCleanupMessages || analysis.roleCounts.toolResult >= thresholds.manualCleanupToolResults) {
        rationale.push(`session volume is high (${analysis.totalMessages} messages / ${analysis.roleCounts.toolResult} tool results)`);
        if (!meaningfulSavings) {
            rationale.push(`ordinary DCP pruning would only save about ${predicted.estimatedTokensSaved} tokens`);
        }
        return {
            recommendation: "clean-up-manually-first",
            rationale,
        };
    }

    rationale.push("pressure and predicted savings are currently low");
    return {
        recommendation: "wait",
        rationale,
    };
}

function estimateFilteredMessages(messages, filteredMessages) {
    return {
        originalMessageCount: Array.isArray(messages) ? messages.length : 0,
        filteredMessageCount: filteredMessages.length,
        excludedMessageCount: Math.max(0, (Array.isArray(messages) ? messages.length : 0) - filteredMessages.length),
    };
}

export function getContextPressureSnapshot(messages, config, usage, options = {}) {
    const baseMessages = getSessionMessages(messages);
    const filteredMessages = filterMessagesForPressure(baseMessages, options.excludeToolNames || DEFAULT_EXCLUDED_TOOL_NAMES);
    const analysis = analyzeConversationPressure(filteredMessages);
    const workflow = applyPruningWorkflowDetailed(filteredMessages, config);
    const predicted = {
        prunedCount: workflow.stats.prunedCount,
        redactedCount: workflow.stats.redactedCount,
        estimatedTokensSaved: workflow.stats.estimatedTokensSaved,
        estimatedTokensPruned: workflow.stats.estimatedTokensPruned,
        estimatedTokensRedacted: workflow.stats.estimatedTokensRedacted,
        pruneReasons: workflow.stats.pruneReasons,
        redactionReasons: workflow.stats.redactionReasons,
    };
    const decision = buildRecommendation(analysis, predicted, usage, options.thresholds);
    return {
        usage: usage || null,
        analysis: {
            ...analysis,
            ...estimateFilteredMessages(baseMessages, filteredMessages),
        },
        predicted,
        recommendation: decision.recommendation,
        rationale: decision.rationale,
        summary: formatPressureSummary(analysis, { maxItems: options.maxItems ?? 2 }),
        filteredMessages,
    };
}

export { DEFAULT_EXCLUDED_TOOL_NAMES, DEFAULT_THRESHOLDS };
