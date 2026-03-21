/**
 * DCP Context Event Handler
 *
 * Handles the 'session_start' event which fires on new sessions.
 * Applies pruning workflow to reduce token usage while preserving coherence.
 */
/**
 * Creates a context event handler that applies pruning to messages.
 *
 * @param options - Configuration and stats tracker
 * @returns Event handler function
 */
export function createSessionStartEventHandler(options) {
    const { config } = options;
    return (event, ctx) => {
        ctx.ui.notify(`DCP: Active with ${config.rules.length} rules \n${config.rules.map(r => `\t- ${r.name}`).join("\n")}`, "info");
    };
}
export function createSessionSwitchEventHandler(options) {
    const { config } = options;
    return (event, ctx) => {
        ctx.ui.notify(`DCP: Switched to session [${event.reason}]`, "info");
    };
}
//# sourceMappingURL=sessionStart.js.map