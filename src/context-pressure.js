/**
 * Shared context pressure and compaction recommendation helpers.
 */
import { analyzeConversationPressure, formatPressureSummary } from "./analysis.js";
import { extractToolCalls } from "./metadata.js";
import { estimateMessageTokens } from "./token-estimation.js";
import { applyPruningWorkflowDetailed } from "./workflow.js";

const DEFAULT_EXCLUDED_TOOL_NAMES = ["dcp_pressure", "dcp_compact"];
const DEFAULT_THRESHOLDS = {
    compactContextPercent: 80,
    meaningfulSavingsTokens: 400,
    repeatedOperationCount: 2,
    previousTurnMessageCount: 12,
    previousTurnToolResultCount: 6,
    previousTurnEstimatedTokens: 1200,
    totalMessages: 40,
    totalToolResults: 20,
    branchShiftContextPercent: 70,
    branchShiftGraceToolResults: 2,
    branchShiftGraceMessages: 6,
};
const CONTINUATION_EXACT_MATCHES = new Set(["continue", "keep going", "go on", "one more tweak", "retry"]);
const CONTINUATION_PREFIXES = ["continue ", "keep going ", "go on ", "retry ", "fix ", "update ", "finish "];
const CONTINUATION_CONTAINS = ["same file", "failing test"];

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

function getUserText(message) {
    if (message?.role !== "user") {
        return "";
    }
    if (typeof message.content === "string") {
        return message.content.trim();
    }
    if (!Array.isArray(message.content)) {
        return "";
    }
    return message.content
        .filter((part) => part && typeof part === "object" && part.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("\n")
        .trim();
}

function isContinuationFollowup(normalizedText) {
    if (!normalizedText) {
        return false;
    }
    if (CONTINUATION_EXACT_MATCHES.has(normalizedText)) {
        return true;
    }
    if (CONTINUATION_PREFIXES.some((prefix) => normalizedText.startsWith(prefix))) {
        return true;
    }
    return CONTINUATION_CONTAINS.some((needle) => normalizedText.includes(needle));
}

function getLatestUserIndex(messages) {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i]?.role === "user") {
            return i;
        }
    }
    return -1;
}

function getPreviousCompletedTurnRange(messages, latestUserIndex) {
    if (!Array.isArray(messages) || latestUserIndex <= 0) {
        return null;
    }
    let previousUserIndex = -1;
    for (let i = latestUserIndex - 1; i >= 0; i -= 1) {
        if (messages[i]?.role === "user") {
            previousUserIndex = i;
            break;
        }
    }
    if (previousUserIndex < 0) {
        return null;
    }
    return {
        start: previousUserIndex,
        end: latestUserIndex - 1,
    };
}

function countSuccessfulNonDcpToolResults(messages, latestUserIndex) {
    if (!Array.isArray(messages) || latestUserIndex < 0) {
        return 0;
    }
    let count = 0;
    for (let i = latestUserIndex + 1; i < messages.length; i += 1) {
        const message = messages[i];
        if (message?.role === "toolResult" && !message.isError) {
            count += 1;
        }
    }
    return count;
}

function getBranchShiftMetrics(filteredMessages, workflow, usage, thresholds) {
    const latestUserIndex = getLatestUserIndex(filteredMessages);
    const latestUserTextRaw = latestUserIndex >= 0 ? getUserText(filteredMessages[latestUserIndex]) : "";
    const latestUserText = latestUserTextRaw.toLowerCase();
    const previousTurnRange = getPreviousCompletedTurnRange(filteredMessages, latestUserIndex);
    const nonUserMessagesSinceLatestUser = latestUserIndex >= 0
        ? filteredMessages.slice(latestUserIndex + 1).filter((message) => message?.role !== "user").length
        : 0;
    const successfulNonDcpToolResultsSinceLatestUser = countSuccessfulNonDcpToolResults(filteredMessages, latestUserIndex);
    const messagesSinceLatestUser = latestUserIndex >= 0 ? Math.max(0, filteredMessages.length - latestUserIndex - 1) : 0;
    const hasGraceWindow = latestUserIndex >= 0
        && successfulNonDcpToolResultsSinceLatestUser < thresholds.branchShiftGraceToolResults
        && nonUserMessagesSinceLatestUser < thresholds.branchShiftGraceMessages;

    let previousTurnMessageCount = 0;
    let previousTurnToolResultCount = 0;
    let previousTurnEstimatedTokens = 0;
    let previousTurnUnresolvedErrorCount = 0;

    if (previousTurnRange) {
        for (let i = previousTurnRange.start; i <= previousTurnRange.end; i += 1) {
            const message = filteredMessages[i];
            const metadata = workflow.withMetadata[i]?.metadata;
            previousTurnMessageCount += 1;
            previousTurnEstimatedTokens += estimateMessageTokens(message);
            if (message?.role === "toolResult") {
                previousTurnToolResultCount += 1;
            }
            if (metadata?.isError === true && metadata?.errorResolved !== true) {
                previousTurnUnresolvedErrorCount += 1;
            }
        }
    }

    const substantialPreviousTurn = previousTurnMessageCount >= thresholds.previousTurnMessageCount
        || previousTurnToolResultCount >= thresholds.previousTurnToolResultCount
        || previousTurnEstimatedTokens >= thresholds.previousTurnEstimatedTokens;
    const sufficientlyLargeSession = filteredMessages.length >= thresholds.totalMessages
        || workflow.finalContextSummary.roles.toolResult.messages >= thresholds.totalToolResults
        || (typeof usage?.percent === "number" && usage.percent >= thresholds.branchShiftContextPercent);
    const continuationSuppressed = isContinuationFollowup(latestUserText);
    const hasClosedWorkstreamBoundary = latestUserIndex >= 0
        && !!previousTurnRange
        && hasGraceWindow
        && substantialPreviousTurn
        && previousTurnUnresolvedErrorCount === 0
        && !continuationSuppressed
        && sufficientlyLargeSession;

    return {
        latestUserIndex,
        latestUserText,
        latestUserTextRaw,
        messagesSinceLatestUser,
        nonUserMessagesSinceLatestUser,
        successfulNonDcpToolResultsSinceLatestUser,
        previousTurnMessageCount,
        previousTurnToolResultCount,
        previousTurnEstimatedTokens,
        previousTurnUnresolvedErrorCount,
        hasClosedWorkstreamBoundary,
        continuationSuppressed,
        boundaryWindowActive: hasGraceWindow,
    };
}

function buildRecommendation(analysis, predicted, usage, branchShift, thresholds = DEFAULT_THRESHOLDS) {
    const rationale = [];
    const repeatedPressure = countRepeatedPressure(analysis);
    const meaningfulSavings = predicted.estimatedTokensSaved >= thresholds.meaningfulSavingsTokens;
    const contextPercent = typeof usage?.percent === "number" ? usage.percent : undefined;

    const hardPressure = (typeof contextPercent === "number" && contextPercent >= thresholds.compactContextPercent)
        || (repeatedPressure >= thresholds.repeatedOperationCount && meaningfulSavings);

    if (hardPressure) {
        if (typeof contextPercent === "number" && contextPercent >= thresholds.compactContextPercent) {
            rationale.push(`context usage is high at ${contextPercent.toFixed(0)}%`);
        }
        if (repeatedPressure >= thresholds.repeatedOperationCount && meaningfulSavings) {
            rationale.push(`repeated inspection churn is present (${repeatedPressure} repeated observations)`);
            rationale.push(`predicted DCP savings are meaningful (~${predicted.estimatedTokensSaved} tokens)`);
        }
        return {
            recommendation: "compact-now",
            opportunityKind: "hard-pressure",
            rationale,
        };
    }

    if (branchShift.hasClosedWorkstreamBoundary) {
        rationale.push(`a substantial prior turn appears closed before the new branch starts`);
        rationale.push(`previous turn carried ${branchShift.previousTurnMessageCount} messages / ~${branchShift.previousTurnEstimatedTokens} tokens`);
        return {
            recommendation: "compact-before-next-branch",
            opportunityKind: "closed-workstream",
            rationale,
        };
    }

    rationale.push("pressure and branch-shift compaction signals are currently low");
    return {
        recommendation: "wait",
        opportunityKind: "none",
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
    const thresholds = options.thresholds || DEFAULT_THRESHOLDS;
    const branchShift = getBranchShiftMetrics(filteredMessages, workflow, usage, thresholds);
    const decision = buildRecommendation(analysis, predicted, usage, branchShift, thresholds);
    return {
        usage: usage || null,
        analysis: {
            ...analysis,
            ...estimateFilteredMessages(baseMessages, filteredMessages),
            ...branchShift,
        },
        predicted,
        recommendation: decision.recommendation,
        opportunityKind: decision.opportunityKind,
        rationale: decision.rationale,
        summary: formatPressureSummary(analysis, { maxItems: options.maxItems ?? 2 }),
        filteredMessages,
    };
}

export { DEFAULT_EXCLUDED_TOOL_NAMES, DEFAULT_THRESHOLDS };
