/**
 * Stale File Reads Rule
 *
 * Removes older successful read tool results once a later successful write/edit
 * to the same normalized file path exists.
 */
import { extractFilePath, getDestructiveActionGuard, getToolResultDescriptor, hasDestructiveAction, isErrorMessage, markForPrune, markForRedaction } from "../metadata.js";

function getToolName(message, messages, index) {
    const descriptor = getToolResultDescriptor(message, messages, index);
    return descriptor?.toolName || message.toolName;
}

export const staleFileReadsRule = {
    name: "stale-file-reads",
    description: "Remove older successful read tool results after a later successful write/edit to the same file",
    prepare(msg, ctx) {
        if (msg.message.role !== "toolResult")
            return;
        if (isErrorMessage(msg.message))
            return;
        const toolName = getToolName(msg.message, ctx.messages, ctx.index);
        if (toolName !== "read")
            return;
        const filePath = extractFilePath(msg.message, ctx.messages, ctx.index);
        if (!filePath)
            return;
        msg.metadata.toolName = toolName;
        msg.metadata.filePath = filePath;
        msg.metadata.operationKind = "read";
    },
    process(msg, ctx) {
        if (hasDestructiveAction(msg.metadata))
            return;
        if (msg.message.role !== "toolResult")
            return;
        if (isErrorMessage(msg.message))
            return;
        if (msg.metadata.toolName !== "read" || !msg.metadata.filePath)
            return;
        const laterMutation = ctx.messages.slice(ctx.index + 1).find((candidate, offset) => {
            if (candidate.message.role !== "toolResult")
                return false;
            if (isErrorMessage(candidate.message))
                return false;
            const candidateIndex = ctx.index + 1 + offset;
            const toolName = getToolName(candidate.message, ctx.messages, candidateIndex);
            if (toolName !== "write" && toolName !== "edit")
                return false;
            const candidatePath = extractFilePath(candidate.message, ctx.messages, candidateIndex);
            return !!candidatePath && candidatePath === msg.metadata.filePath;
        });
        if (!laterMutation)
            return;
        const guard = getDestructiveActionGuard(msg.message, ctx.messages, ctx.index, ctx.config, ctx.config.ageGates?.staleFileReads ?? 0);
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
        const reason = `stale read invalidated by later successful write/edit to ${msg.metadata.filePath}`;
        if (ctx.config.redaction?.staleFileReads) {
            markForRedaction(msg, reason, {
                redactionKind: "stale-file-read",
            });
        }
        else {
            markForPrune(msg, reason);
        }
        if (ctx.config.debug) {
            console.log(`[pi-dcp] StaleFileReads: marking stale read at index ${ctx.index}: ${msg.metadata.filePath}`);
        }
    },
};
