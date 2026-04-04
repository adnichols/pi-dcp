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
    return (_event, ctx) => {
        if (ctx.hasUI && ctx.ui?.setStatus) {
            ctx.ui.setStatus("pi-dcp", `DCP active · ${config.rules.length} rules`);
        }
    };
}
export function createSessionSwitchEventHandler(options) {
    const { config } = options;
    return (event, ctx) => {
        if (ctx.hasUI && ctx.ui?.setStatus) {
            const reason = event?.reason ? ` · switched (${event.reason})` : "";
            ctx.ui.setStatus("pi-dcp", `DCP active · ${config.rules.length} rules${reason}`);
        }
    };
}
//# sourceMappingURL=sessionStart.js.map