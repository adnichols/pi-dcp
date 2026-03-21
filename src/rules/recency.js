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
export const recencyRule = {
    name: "recency",
    description: "Always preserve recent messages from pruning",
    process(msg, ctx) {
        const distanceFromEnd = ctx.messages.length - ctx.index - 1;
        if (distanceFromEnd >= ctx.config.keepRecentCount)
            return;
        if (msg.metadata.hasToolResult && msg.metadata.shouldPrune) {
            if (ctx.config.debug) {
                console.log(`[pi-dcp] Recency: not protecting pruned tool_result at index ${ctx.index} ` +
                    `(distance from end: ${distanceFromEnd}, threshold: ${ctx.config.keepRecentCount})`);
            }
            return;
        }
        const wasPruned = msg.metadata.shouldPrune;
        msg.metadata.shouldPrune = false;
        msg.metadata.pruneReason = undefined;
        msg.metadata.protectedByRecency = true;
        if (ctx.config.debug && wasPruned) {
            console.log(`[pi-dcp] Recency: protecting message at index ${ctx.index} ` +
                `(distance from end: ${distanceFromEnd}, threshold: ${ctx.config.keepRecentCount})`);
        }
    },
};
//# sourceMappingURL=recency.js.map