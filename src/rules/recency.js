/**
 * Recency Rule
 *
 * Always preserves recent messages from pruning.
 * The last N messages (configurable via keepRecentCount) are protected,
 * except for tool-result messages that another rule has already chosen to prune.
 * Those prunes preserve provider replay invariants or intentional result-side cleanup
 * and must remain in force even when the messages are recent.
 *
 * This rule should typically run LAST in the process phase to override
 * other pruning decisions for recent messages.
 */
import { clearDestructiveAction, getMessageAction } from "../metadata.js";
export const recencyRule = {
    name: "recency",
    description: "Always preserve recent messages from pruning",
    process(msg, ctx) {
        const distanceFromEnd = ctx.messages.length - ctx.index - 1;
        if (distanceFromEnd >= ctx.config.keepRecentCount)
            return;
        const action = getMessageAction(msg.metadata);
        if (msg.metadata.providerSafetyPrune && action === "prune") {
            if (ctx.config.debug) {
                console.log(`[pi-dcp] Recency: not protecting provider-safety prune at index ${ctx.index} ` +
                    `(distance from end: ${distanceFromEnd}, threshold: ${ctx.config.keepRecentCount})`);
            }
            return;
        }
        const hadDestructiveAction = action === "prune" || action === "redact";
        if (hadDestructiveAction) {
            clearDestructiveAction(msg);
        }
        msg.metadata.protectedByRecency = true;
        if (ctx.config.debug && hadDestructiveAction) {
            console.log(`[pi-dcp] Recency: protecting message at index ${ctx.index} ` +
                `(distance from end: ${distanceFromEnd}, threshold: ${ctx.config.keepRecentCount})`);
        }
    },
};
//# sourceMappingURL=recency.js.map