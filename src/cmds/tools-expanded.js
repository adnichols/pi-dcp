/**
 * DCP Tools Expanded Command
 *
 * Toggle or set tool output expansion for the current session.
 */
function parseDesiredState(args) {
    if (!args) {
        return null;
    }
    const normalized = args.trim().toLowerCase();
    if (!normalized) {
        return null;
    }
    if (["on", "true", "1", "yes", "expand", "expanded"].includes(normalized)) {
        return true;
    }
    if (["off", "false", "0", "no", "collapse", "collapsed"].includes(normalized)) {
        return false;
    }
    return undefined;
}
export function createToolsExpandedCommand() {
    return {
        description: "Toggle tool output expansion (on/off)",
        handler: async (args, ctx) => {
            const ui = ctx.ui;
            if (!ui.getToolsExpanded || !ui.setToolsExpanded) {
                ctx.ui.notify("Tool output expansion controls are not available in this pi version.", "warning");
                return;
            }
            const desired = parseDesiredState(args);
            if (desired === undefined) {
                ctx.ui.notify("Usage: /dcp-tools [on|off]", "warning");
                return;
            }
            const current = ui.getToolsExpanded();
            const next = desired === null ? !current : desired;
            ui.setToolsExpanded(next);
            ctx.ui.notify(`Tool outputs: ${next ? "expanded" : "collapsed"}`, "info");
        },
    };
}
//# sourceMappingURL=tools-expanded.js.map