/**
 * Superseded Tool Results Rule
 *
 * Removes older successful read/bash tool results when a later identical operation succeeds.
 * This is intentionally conservative:
 * - only exact same file path (`read`) or exact same command (`bash`)
 * - only top-level toolResult messages
 * - only successful results
 *
 * The goal is to trim repeated inspection churn that accumulates in long sessions
 * without touching the latest known-good observation.
 */
import { extractFilePath, getDestructiveActionGuard, getOperationKey, getToolResultDescriptor, hasDestructiveAction, isErrorMessage, markForPrune, markForRedaction } from "../metadata.js";

export const supersededToolResultsRule = {
    name: "superseded-tool-results",
    description: "Remove older successful read/bash tool results when the same operation succeeds later",
    prepare(msg, ctx) {
        if (msg.message.role !== "toolResult")
            return;
        const descriptor = getToolResultDescriptor(msg.message, ctx.messages, ctx.index);
        const toolName = descriptor?.toolName || msg.message.toolName;
        if (toolName !== "read" && toolName !== "bash")
            return;
        const operationKey = getOperationKey(msg.message, ctx.messages, ctx.index);
        if (!operationKey)
            return;
        msg.metadata.operationKey = operationKey;
        msg.metadata.operationKind = toolName;
        msg.metadata.toolName = toolName;
        const filePath = extractFilePath(msg.message, ctx.messages, ctx.index);
        if (filePath) {
            msg.metadata.filePath = filePath;
        }
    },
    process(msg, ctx) {
        if (hasDestructiveAction(msg.metadata))
            return;
        if (msg.message.role !== "toolResult")
            return;
        if (isErrorMessage(msg.message))
            return;
        if (!msg.metadata.operationKey)
            return;
        const laterMatch = ctx.messages.slice(ctx.index + 1).find((candidate) => {
            if (candidate.message.role !== "toolResult")
                return false;
            if (candidate.metadata.operationKey !== msg.metadata.operationKey)
                return false;
            return !isErrorMessage(candidate.message);
        });
        if (!laterMatch)
            return;
        const guard = getDestructiveActionGuard(msg.message, ctx.messages, ctx.index, ctx.config, ctx.config.ageGates?.supersededToolResults ?? 0);
        msg.metadata.toolName = guard.toolName;
        msg.metadata.laterCompletedUserTurns = guard.laterCompletedUserTurns;
        msg.metadata.protectedTool = guard.protectedTool;
        msg.metadata.protectedFilePath = guard.protectedFilePath;
        if (guard.filePath) {
            msg.metadata.filePath = guard.filePath;
        }
        if (!guard.allowed) {
            msg.metadata.destructiveActionBlockedReason = guard.reason;
            return;
        }
        const reason = `superseded by later successful ${msg.metadata.operationKind}`;
        if (ctx.config.redaction?.supersededToolResults) {
            markForRedaction(msg, reason, {
                redactionKind: "superseded-tool-result",
            });
        }
        else {
            markForPrune(msg, reason);
        }
        if (ctx.config.debug) {
            console.log(`[pi-dcp] SupersededToolResults: marking superseded ${msg.metadata.operationKind} result at index ${ctx.index}: ${msg.metadata.operationKey}`);
        }
    },
};
