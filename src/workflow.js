/**
 * Pruning workflow engine
 *
 * Implements the prepare > process > mutate > filter workflow for message pruning.
 */
import { createMessageWithMetadata, extractCommand, getMessageAction } from "./metadata.js";
import { getLogger } from "./logger.js";
import { resolveRule } from "./registry.js";
import { estimateMessageTokens, estimateRedactionSavings, summarizeContextMessages } from "./token-estimation.js";

function cloneMessage(message) {
    if (typeof structuredClone === "function") {
        return structuredClone(message);
    }
    return JSON.parse(JSON.stringify(message));
}

function getMessageTextSummary(message, maxLength = 160) {
    let rawText = "";
    if (typeof message?.content === "string") {
        rawText = message.content;
    }
    else if (Array.isArray(message?.content)) {
        rawText = message.content
            .filter((part) => part && typeof part === "object" && part.type === "text")
            .map((part) => part.text || "")
            .join(" ");
    }
    const normalized = rawText.replace(/\s+/g, " ").trim();
    if (!normalized) {
        return "";
    }
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.slice(0, maxLength - 1)}…`;
}

function getCompactResolvedErrorSummary(message) {
    const normalized = getMessageTextSummary(message, 400);
    if (!normalized) {
        return "";
    }
    const interestingPatterns = [/ENOENT\b/i, /EACCES\b/i, /EPERM\b/i, /ECONNREFUSED\b/i, /ETIMEDOUT\b/i, /not found/i, /permission denied/i, /timeout/i];
    for (const pattern of interestingPatterns) {
        const match = normalized.match(pattern);
        if (!match || match.index == null) {
            continue;
        }
        return normalized.slice(match.index, match.index + 80).trim();
    }
    if (normalized.length <= 80) {
        return normalized;
    }
    return "";
}

function buildRedactionText(entry, withMetadata, index) {
    const { message, metadata } = entry;
    const toolName = metadata.toolName || message.toolName;
    const filePath = metadata.filePath;
    const command = extractCommand(message, withMetadata, index);
    const label = metadata.redactionKind === "resolved-error"
        ? "redacted resolved error"
        : metadata.redactionKind === "stale-file-read"
            ? "redacted stale file read"
            : "redacted superseded tool result";
    const descriptor = [toolName, filePath, command].filter((value) => typeof value === "string" && value.length > 0);
    const heading = descriptor.length > 0
        ? `[pi-dcp ${label}: ${descriptor.join(" · ")}]`
        : `[pi-dcp ${label}]`;
    if (metadata.redactionKind !== "resolved-error") {
        return heading;
    }
    const summary = getCompactResolvedErrorSummary(message);
    return summary ? `${heading}\nSummary: ${summary}` : heading;
}

function buildRedactedMessage(entry, withMetadata, index) {
    if (entry.metadata.redactedMessage) {
        return entry.metadata.redactedMessage;
    }
    const redactedText = buildRedactionText(entry, withMetadata, index);
    const cloned = cloneMessage(entry.message);
    if (cloned.role === "toolResult" || Array.isArray(cloned.content)) {
        cloned.content = [{ type: "text", text: redactedText }];
    }
    else if ("content" in cloned) {
        cloned.content = redactedText;
    }
    return cloned;
}

function applyMessageMutations(withMetadata, config) {
    let redactedCount = 0;
    withMetadata.forEach((entry, index) => {
        if (getMessageAction(entry.metadata) !== "redact") {
            return;
        }
        const originalMessage = entry.message;
        const redactedMessage = buildRedactedMessage(entry, withMetadata, index);
        entry.metadata.estimatedTokensRedacted = estimateRedactionSavings(originalMessage, redactedMessage);
        entry.message = redactedMessage;
        entry.metadata.redactedMessage = redactedMessage;
        entry.metadata.wasRedacted = true;
        redactedCount += 1;
        if (config.debug) {
            const reason = entry.metadata.redactionReason || "unknown";
            console.log(`[pi-dcp] Workflow: redacted message at index ${index} (${reason})`);
        }
    });
    return redactedCount;
}

function runPreparePhase(withMetadata, config, logger) {
    for (const ruleRef of config.rules) {
        const rule = resolveRule(ruleRef);
        if (!rule.prepare) {
            continue;
        }
        withMetadata.forEach((msg, index) => {
            try {
                rule.prepare(msg, {
                    messages: withMetadata,
                    index,
                    config,
                });
            }
            catch (error) {
                logger.error(`Error in prepare phase for rule "${rule.name}"`, {
                    error: error instanceof Error ? error.message : String(error),
                    rule: rule.name,
                    index,
                });
            }
        });
    }
}

function runProcessPhase(withMetadata, config, logger) {
    for (const ruleRef of config.rules) {
        const rule = resolveRule(ruleRef);
        if (!rule.process) {
            continue;
        }
        withMetadata.forEach((msg, index) => {
            try {
                rule.process(msg, {
                    messages: withMetadata,
                    index,
                    config,
                });
            }
            catch (error) {
                logger.error(`Error in process phase for rule "${rule.name}"`, {
                    error: error instanceof Error ? error.message : String(error),
                    rule: rule.name,
                    index,
                });
            }
        });
    }
}

/**
 * Main workflow with detailed stats.
 */
export function applyPruningWorkflowDetailed(messages, config) {
    const originalContextSummary = summarizeContextMessages(messages);
    if (!config.enabled || messages.length === 0) {
        return {
            messages,
            withMetadata: messages.map(createMessageWithMetadata),
            stats: {
                totalMessages: messages.length,
                prunedCount: 0,
                redactedCount: 0,
                keptCount: messages.length,
                pruneReasons: {},
                redactionReasons: {},
                estimatedTokensPruned: 0,
                estimatedTokensRedacted: 0,
                estimatedTokensSaved: 0,
            },
            originalContextSummary,
            finalContextSummary: originalContextSummary,
        };
    }
    const withMetadata = messages.map(createMessageWithMetadata);
    const logger = getLogger();
    runPreparePhase(withMetadata, config, logger);
    if (config.debug) {
        logger.debug(`Prepare phase complete. Processed ${withMetadata.length} messages.`);
    }
    runProcessPhase(withMetadata, config, logger);
    if (config.debug) {
        logger.debug(`Process phase complete.`);
    }
    const redactedCount = applyMessageMutations(withMetadata, config);
    const filteredMessages = withMetadata
        .filter((messageWithMetadata) => getMessageAction(messageWithMetadata.metadata) !== "prune")
        .map((messageWithMetadata) => messageWithMetadata.message);
    const stats = getPruningStats(withMetadata);
    const finalContextSummary = summarizeContextMessages(filteredMessages);
    if (config.debug || stats.prunedCount > 0 || redactedCount > 0) {
        logPruningResults(withMetadata, filteredMessages.length, config, stats);
    }
    return {
        messages: filteredMessages,
        withMetadata,
        stats,
        originalContextSummary,
        finalContextSummary,
    };
}

/**
 * Main workflow: prepare > process > mutate > filter
 *
 * @param messages - Original messages from pi
 * @param config - DCP configuration
 * @returns Filtered messages with pruned items removed
 */
export function applyPruningWorkflow(messages, config) {
    return applyPruningWorkflowDetailed(messages, config).messages;
}

/**
 * Log pruning results for debugging
 */
function logPruningResults(withMetadata, finalCount, config, stats = getPruningStats(withMetadata)) {
    const logger = getLogger();
    const prunedMessages = withMetadata.filter((messageWithMetadata) => getMessageAction(messageWithMetadata.metadata) === "prune");
    const redactedMessages = withMetadata.filter((messageWithMetadata) => messageWithMetadata.metadata.wasRedacted);
    const originalCount = withMetadata.length;
    logger.info(`Filter phase complete: ${stats.prunedCount} pruned, ${stats.redactedCount} redacted, ${finalCount} kept (${originalCount} total)`);
    if (config.debug && (stats.prunedCount > 0 || stats.redactedCount > 0)) {
        logger.debug(`Pruning results:`, {
            pruned: prunedMessages.map((msg) => ({
                index: withMetadata.indexOf(msg),
                role: msg.message.role,
                reason: msg.metadata.pruneReason || "unknown",
            })),
            redacted: redactedMessages.map((msg) => ({
                index: withMetadata.indexOf(msg),
                role: msg.message.role,
                reason: msg.metadata.redactionReason || "unknown",
            })),
            estimatedTokensPruned: stats.estimatedTokensPruned,
            estimatedTokensRedacted: stats.estimatedTokensRedacted,
        });
    }
}

export function getPruningStats(withMetadata) {
    const pruned = withMetadata.filter((messageWithMetadata) => getMessageAction(messageWithMetadata.metadata) === "prune");
    const redacted = withMetadata.filter((messageWithMetadata) => messageWithMetadata.metadata.wasRedacted);
    const pruneReasons = {};
    const redactionReasons = {};
    let estimatedTokensPruned = 0;
    let estimatedTokensRedacted = 0;
    pruned.forEach((msg) => {
        const reason = msg.metadata.pruneReason || "unknown";
        pruneReasons[reason] = (pruneReasons[reason] || 0) + 1;
        estimatedTokensPruned += estimateMessageTokens(msg.message);
    });
    redacted.forEach((msg) => {
        const reason = msg.metadata.redactionReason || "unknown";
        redactionReasons[reason] = (redactionReasons[reason] || 0) + 1;
        estimatedTokensRedacted += msg.metadata.estimatedTokensRedacted || 0;
    });
    return {
        totalMessages: withMetadata.length,
        prunedCount: pruned.length,
        redactedCount: redacted.length,
        keptCount: withMetadata.length - pruned.length,
        pruneReasons,
        redactionReasons,
        estimatedTokensPruned,
        estimatedTokensRedacted,
        estimatedTokensSaved: estimatedTokensPruned + estimatedTokensRedacted,
    };
}
