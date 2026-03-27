/**
 * Tool Pairing Rule
 *
 * Ensures that tool calls and tool results are never separated.
 * This supports both Claude-style nested `tool_use` / `tool_result` content blocks
 * and pi-mono's assistant `toolCall` plus top-level `role: "toolResult"` messages.
 *
 * Algorithm:
 * 1. Prepare: Extract tool IDs and type flags from each message
 * 2. Process: Two passes:
 *    - First pass (forward): If a tool call message is pruned, cascade prune to matching tool results
 *    - Second pass (backward): If a tool result is kept, protect its matching tool call message
 *    - Fallback: If no matching tool call exists anywhere in history, prune the orphaned tool result
 *
 * This rule MUST run AFTER all other pruning rules to protect tool pairs.
 */
import { clearDestructiveAction, extractToolUseIds, getMessageAction, hasToolUse, hasToolResult, markForPrune } from "../metadata.js";
export const toolPairingRule = {
    name: "tool-pairing",
    description: "Preserve tool call/tool result pairing required by provider APIs",
    prepare(msg) {
        msg.metadata.toolUseIds = extractToolUseIds(msg.message);
        msg.metadata.hasToolUse = hasToolUse(msg.message);
        msg.metadata.hasToolResult = hasToolResult(msg.message);
    },
    process(msg, ctx) {
        cascadePruneForward(msg, ctx);
        protectToolUseBackward(msg, ctx);
    },
};
/**
 * Forward pass: If a tool call is pruned, prune its corresponding tool result.
 * Intentionally does NOT resurrect tool results that another rule already chose
 * to prune; provider APIs tolerate a tool call without a retained result, but not
 * a retained result without a matching tool call.
 */
function cascadePruneForward(msg, ctx) {
    if (!msg.metadata.hasToolUse)
        return;
    if (!msg.metadata.toolUseIds || msg.metadata.toolUseIds.length === 0)
        return;
    if (getMessageAction(msg.metadata) !== "prune")
        return;
    const toolUseIds = msg.metadata.toolUseIds;
    for (let i = ctx.index + 1; i < ctx.messages.length; i++) {
        const nextMsg = ctx.messages[i];
        if (!nextMsg.metadata.hasToolResult)
            continue;
        if (!nextMsg.metadata.toolUseIds)
            continue;
        const hasMatchingToolResult = toolUseIds.some((id) => nextMsg.metadata.toolUseIds?.includes(id));
        if (!hasMatchingToolResult || getMessageAction(nextMsg.metadata) === "prune")
            continue;
        markForPrune(nextMsg, "orphaned tool_result (tool call was pruned)", {
            providerSafetyPrune: true,
        });
        if (ctx.config.debug) {
            console.log(`[pi-dcp] Tool-pairing: cascade pruning tool_result at index ${i} ` +
                `(tool call at index ${ctx.index} was pruned)`);
        }
    }
}
/**
 * Backward pass: If a tool result is kept, protect its tool call.
 * If no matching tool call exists in history, prune the orphaned tool result.
 */
function protectToolUseBackward(msg, ctx) {
    if (!msg.metadata.hasToolResult || getMessageAction(msg.metadata) === "prune")
        return;
    if (!msg.metadata.toolUseIds || msg.metadata.toolUseIds.length === 0)
        return;
    const toolUseIds = msg.metadata.toolUseIds;
    let foundMatchingToolUse = false;
    for (let i = ctx.index - 1; i >= 0; i--) {
        const prevMsg = ctx.messages[i];
        if (!prevMsg.metadata.hasToolUse)
            continue;
        if (!prevMsg.metadata.toolUseIds)
            continue;
        const hasMatchingToolUse = toolUseIds.some((id) => prevMsg.metadata.toolUseIds?.includes(id));
        if (!hasMatchingToolUse)
            continue;
        foundMatchingToolUse = true;
        if (getMessageAction(prevMsg.metadata) !== "prune")
            continue;
        clearDestructiveAction(prevMsg);
        prevMsg.metadata.protectedByToolPairing = true;
        if (ctx.config.debug) {
            console.log(`[pi-dcp] Tool-pairing: protecting tool call at index ${i} ` +
                `(referenced by kept tool_result at index ${ctx.index})`);
        }
    }
    if (foundMatchingToolUse)
        return;
    markForPrune(msg, "orphaned tool_result (no matching tool call in history)", {
        providerSafetyPrune: true,
    });
    if (ctx.config.debug) {
        console.log(`[pi-dcp] Tool-pairing: pruning orphaned tool_result at index ${ctx.index} ` +
            `(no matching tool call found in history)`);
    }
}
//# sourceMappingURL=tool-pairing.js.map