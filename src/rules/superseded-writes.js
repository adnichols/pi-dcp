/**
 * Superseded Writes Rule
 *
 * Removes older non-tool file write/edit messages when a later successful version exists.
 * Top-level tool results are allowed here so stale successful writes can be dropped,
 * but failed retries must not supersede the last known-good write result.
 */
import { extractFilePath, hashMessage, hasToolUse, isErrorMessage } from "../metadata.js";
export const supersededWritesRule = {
    name: "superseded-writes",
    description: "Remove older file writes when a later successful write exists",
    prepare(msg, ctx) {
        const filePath = extractFilePath(msg.message);
        if (filePath) {
            msg.metadata.filePath = filePath;
            msg.metadata.fileVersion = hashMessage(msg.message);
            if (ctx.config.debug) {
                console.log(`[pi-dcp] SupersededWrites: found file operation at index ${ctx.index}: ${filePath}`);
            }
        }
    },
    process(msg, ctx) {
        if (msg.metadata.shouldPrune)
            return;
        if (!msg.metadata.filePath)
            return;
        if (msg.message.role === "user")
            return;
        if (hasToolUse(msg.message))
            return;
        const laterWrite = ctx.messages.slice(ctx.index + 1).find((m) => {
            if (hasToolUse(m.message))
                return false;
            if (m.metadata.filePath !== msg.metadata.filePath)
                return false;
            return !isErrorMessage(m.message);
        });
        if (!laterWrite)
            return;
        msg.metadata.shouldPrune = true;
        msg.metadata.pruneReason = `superseded by later successful write to ${msg.metadata.filePath}`;
        if (ctx.config.debug) {
            console.log(`[pi-dcp] SupersededWrites: marking superseded write at index ${ctx.index}: ${msg.metadata.filePath}`);
        }
    },
};
//# sourceMappingURL=superseded-writes.js.map