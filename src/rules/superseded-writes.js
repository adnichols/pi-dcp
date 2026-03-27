/**
 * Superseded Writes Rule
 *
 * Removes older non-tool file write/edit messages when a later successful version exists.
 * Top-level tool results are allowed here so stale successful writes can be dropped,
 * but failed retries must not supersede the last known-good write result.
 */
import { extractFilePath, getDestructiveActionGuard, getOperationKey, getToolResultDescriptor, hasDestructiveAction, hashMessage, hasToolUse, isErrorMessage, markForPrune } from "../metadata.js";

export const supersededWritesRule = {
    name: "superseded-writes",
    description: "Remove older file writes when a later successful write exists",
    prepare(msg, ctx) {
        const descriptor = getToolResultDescriptor(msg.message, ctx.messages, ctx.index);
        const toolName = descriptor?.toolName || msg.message.toolName;
        if (toolName !== "write" && toolName !== "edit") {
            return;
        }
        const filePath = extractFilePath(msg.message, ctx.messages, ctx.index);
        const operationKey = getOperationKey(msg.message, ctx.messages, ctx.index);
        if (filePath) {
            msg.metadata.filePath = filePath;
            msg.metadata.fileVersion = hashMessage(msg.message);
            msg.metadata.operationKey = operationKey;
            if (ctx.config.debug) {
                console.log(`[pi-dcp] SupersededWrites: found file operation at index ${ctx.index}: ${filePath}`);
            }
        }
    },
    process(msg, ctx) {
        if (hasDestructiveAction(msg.metadata))
            return;
        if (!msg.metadata.filePath)
            return;
        if (msg.message.role === "user")
            return;
        if (hasToolUse(msg.message))
            return;
        const laterWrite = ctx.messages.slice(ctx.index + 1).find((m, offset) => {
            if (hasToolUse(m.message))
                return false;
            const descriptor = getToolResultDescriptor(m.message, ctx.messages, ctx.index + 1 + offset);
            const toolName = descriptor?.toolName || m.message.toolName;
            if (toolName !== "write" && toolName !== "edit")
                return false;
            const candidateOperationKey = m.metadata.operationKey || getOperationKey(m.message, ctx.messages, ctx.index + 1 + offset);
            if (!candidateOperationKey || candidateOperationKey !== msg.metadata.operationKey)
                return false;
            return !isErrorMessage(m.message);
        });
        if (!laterWrite)
            return;
        const guard = getDestructiveActionGuard(msg.message, ctx.messages, ctx.index, ctx.config, ctx.config.ageGates?.supersededWrites ?? 0);
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
        markForPrune(msg, `superseded by later successful write to ${msg.metadata.filePath}`);
        if (ctx.config.debug) {
            console.log(`[pi-dcp] SupersededWrites: marking superseded write at index ${ctx.index}: ${msg.metadata.filePath}`);
        }
    },
};
