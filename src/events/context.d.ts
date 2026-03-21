/**
 * DCP Context Event Handler
 *
 * Handles the 'context' event which fires before each LLM call.
 * Applies pruning workflow to reduce token usage while preserving coherence.
 */
import type { ContextEvent, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { DcpConfigWithPruneRuleObjects } from "../types.js";
import type { StatsTracker } from "../cmds/stats.ts";
export interface ContextEventHandlerOptions {
    config: DcpConfigWithPruneRuleObjects;
    statsTracker: StatsTracker;
}
/**
 * Creates a context event handler that applies pruning to messages.
 *
 * @param options - Configuration and stats tracker
 * @returns Event handler function
 */
export declare function createContextEventHandler(options: ContextEventHandlerOptions): (event: ContextEvent, ctx: ExtensionContext) => Promise<{
    messages: any;
}>;
//# sourceMappingURL=context.d.ts.map