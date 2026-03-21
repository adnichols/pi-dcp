/**
 * DCP Context Event Handler
 *
 * Handles the 'session_start' event which fires on new sessions.
 * Applies pruning workflow to reduce token usage while preserving coherence.
 */
import type { SessionStartEvent, ExtensionContext, SessionSwitchEvent } from "@mariozechner/pi-coding-agent";
import type { DcpConfigWithPruneRuleObjects } from "../types.js";
export interface SessionStartEventHandlerOptions {
    config: DcpConfigWithPruneRuleObjects;
}
/**
 * Creates a context event handler that applies pruning to messages.
 *
 * @param options - Configuration and stats tracker
 * @returns Event handler function
 */
export declare function createSessionStartEventHandler(options: SessionStartEventHandlerOptions): (event: SessionStartEvent, ctx: ExtensionContext) => void;
export declare function createSessionSwitchEventHandler(options: SessionStartEventHandlerOptions): (event: SessionSwitchEvent, ctx: ExtensionContext) => void;
//# sourceMappingURL=sessionStart.d.ts.map