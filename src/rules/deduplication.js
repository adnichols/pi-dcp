/**
 * Deduplication Rule
 *
 * Removes duplicate non-tool messages based on content hash.
 * Tool-bearing messages are skipped because pruning whole tool-call or tool-result
 * messages can break provider-level pairing invariants.
 */
import { hasDestructiveAction, hashMessage, isToolBearingMessage, markForPrune } from "../metadata.js";
export const deduplicationRule = {
    name: "deduplication",
    description: "Remove duplicate non-tool messages based on content hash",
    prepare(msg) {
        msg.metadata.hash = hashMessage(msg.message);
    },
    process(msg, ctx) {
        if (hasDestructiveAction(msg.metadata))
            return;
        // Never prune user messages.
        if (msg.message.role === "user")
            return;
        // Never prune tool-bearing messages as standalone messages.
        if (isToolBearingMessage(msg.message))
            return;
        const currentHash = msg.metadata.hash;
        if (!currentHash)
            return;
        const seenBefore = ctx.messages
            .slice(0, ctx.index)
            .some((m) => !isToolBearingMessage(m.message) && m.metadata.hash === currentHash);
        if (!seenBefore)
            return;
        markForPrune(msg, "duplicate content");
        if (ctx.config.debug) {
            console.log(`[pi-dcp] Dedup: marking duplicate message at index ${ctx.index} (hash: ${currentHash})`);
        }
    },
};
//# sourceMappingURL=deduplication.js.map