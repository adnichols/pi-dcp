/**
 * DCP Debug Command
 *
 * Toggle debug logging to see what gets pruned.
 */
export function createDebugCommand(config) {
    return {
        description: "Toggle DCP debug logging",
        handler: async (args, ctx) => {
            config.debug = !config.debug;
            ctx.ui.notify(`DCP debug: ${config.debug ? "ON" : "OFF"}`, "info");
        },
    };
}
//# sourceMappingURL=debug.js.map