/**
 * DCP Toggle Command
 *
 * Enable or disable the DCP extension.
 */
export function createToggleCommand(config) {
    return {
        description: "Toggle DCP on/off",
        handler: async (args, ctx) => {
            config.enabled = !config.enabled;
            ctx.ui.notify(`DCP: ${config.enabled ? "ENABLED" : "DISABLED"}`, "info");
        },
    };
}
//# sourceMappingURL=toggle.js.map