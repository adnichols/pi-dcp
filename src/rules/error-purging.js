/**
 * Error Purging Rule
 *
 * Removes resolved errors from context.
 * Assistant messages that contain tool calls are skipped because pruning the
 * call side can orphan provider-facing tool results. Top-level toolResult
 * messages may still be pruned when a later success supersedes them.
 */
import { hasToolUse, isErrorMessage, isSameOperation } from "../metadata.js";
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
        const laterSuccess = ctx.messages
            .slice(ctx.index + 1)
            .find((m) => !hasToolUse(m.message) && isSameOperation(m.message, msg.message) && !isErrorMessage(m.message));
        msg.metadata.errorResolved = !!laterSuccess;
        if (ctx.config.debug && laterSuccess) {
            console.log(`[pi-dcp] ErrorPurging: found resolved error at index ${ctx.index}`);
        }
    },
    process(msg, ctx) {
        if (msg.metadata.shouldPrune)
            return;
        if (msg.message.role === "user")
            return;
        if (hasToolUse(msg.message))
            return;
        if (msg.metadata.isError && msg.metadata.errorResolved) {
            msg.metadata.shouldPrune = true;
            msg.metadata.pruneReason = "error resolved by later success";
            if (ctx.config.debug) {
                console.log(`[pi-dcp] ErrorPurging: marking resolved error at index ${ctx.index}`);
            }
        }
    },
};
//# sourceMappingURL=error-purging.js.map