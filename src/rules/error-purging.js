/**
 * Error Purging Rule
 *
 * Removes resolved errors from context.
 * Assistant messages that contain tool calls are skipped because pruning the
 * call side can orphan provider-facing tool results. Top-level toolResult
 * messages may still be pruned when a later success supersedes them.
 */
import { extractFilePath, getDestructiveActionGuard, getOperationKey, getToolResultDescriptor, hasDestructiveAction, hasToolUse, isErrorMessage, isSameOperation, markForPrune, markForRedaction } from "../metadata.js";

export const errorPurgingRule = {
    name: "error-purging",
    description: "Remove resolved errors from context",
    prepare(msg, ctx) {
        const isError = isErrorMessage(msg.message);
        msg.metadata.isError = isError;
        if (!isError)
            return;
        if (hasToolUse(msg.message))
            return;
        const currentFilePath = extractFilePath(msg.message, ctx.messages, ctx.index);
        const currentDescriptor = getToolResultDescriptor(msg.message, ctx.messages, ctx.index);
        const currentToolName = currentDescriptor?.toolName || msg.message.toolName;
        if (currentToolName) {
            msg.metadata.toolName = currentToolName;
        }
        if (currentFilePath) {
            msg.metadata.filePath = currentFilePath;
        }
        const currentOperationKey = getOperationKey(msg.message, ctx.messages, ctx.index);
        const laterSuccess = ctx.messages
            .slice(ctx.index + 1)
            .find((candidate, offset) => {
            if (hasToolUse(candidate.message))
                return false;
            if (isErrorMessage(candidate.message))
                return false;
            const candidateFilePath = extractFilePath(candidate.message, ctx.messages, ctx.index + 1 + offset);
            const candidateDescriptor = getToolResultDescriptor(candidate.message, ctx.messages, ctx.index + 1 + offset);
            const candidateToolName = candidateDescriptor?.toolName || candidate.message.toolName;
            if (currentToolName && candidateToolName && currentToolName !== candidateToolName) {
                return false;
            }
            if (currentFilePath && candidateFilePath) {
                return currentFilePath === candidateFilePath;
            }
            const candidateOperationKey = getOperationKey(candidate.message, ctx.messages, ctx.index + 1 + offset);
            if (currentOperationKey && candidateOperationKey) {
                return currentOperationKey === candidateOperationKey;
            }
            return isSameOperation(candidate.message, msg.message);
        });
        msg.metadata.errorResolved = !!laterSuccess;
        if (ctx.config.debug && laterSuccess) {
            console.log(`[pi-dcp] ErrorPurging: found resolved error at index ${ctx.index}`);
        }
    },
    process(msg, ctx) {
        if (hasDestructiveAction(msg.metadata))
            return;
        if (msg.message.role === "user")
            return;
        if (hasToolUse(msg.message))
            return;
        if (msg.metadata.isError && msg.metadata.errorResolved) {
            const guard = getDestructiveActionGuard(msg.message, ctx.messages, ctx.index, ctx.config, ctx.config.ageGates?.errorPurging ?? 0);
            msg.metadata.laterCompletedUserTurns = guard.laterCompletedUserTurns;
            msg.metadata.protectedTool = guard.protectedTool;
            msg.metadata.protectedFilePath = guard.protectedFilePath;
            if (guard.toolName) {
                msg.metadata.toolName = guard.toolName;
            }
            if (guard.filePath) {
                msg.metadata.filePath = guard.filePath;
            }
            if (!guard.allowed) {
                msg.metadata.destructiveActionBlockedReason = guard.reason;
                return;
            }
            const reason = "error resolved by later success";
            if (ctx.config.redaction?.resolvedErrors) {
                markForRedaction(msg, reason, {
                    redactionKind: "resolved-error",
                });
            }
            else {
                markForPrune(msg, reason);
            }
            if (ctx.config.debug) {
                console.log(`[pi-dcp] ErrorPurging: marking resolved error at index ${ctx.index}`);
            }
        }
    },
};
