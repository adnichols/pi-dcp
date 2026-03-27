/**
 * DCP Context Command
 *
 * Show a rough estimated current-context breakdown plus DCP savings.
 */
import { analyzeConversationPressure, formatPressureSummary } from "../analysis.js";
import { summarizeContextMessages } from "../token-estimation.js";

function formatTokenEstimate(tokens) {
    return `~${Math.round(tokens || 0)}`;
}

function getSessionMessages(ctx) {
    const entries = ctx.sessionManager?.getEntries?.() || [];
    return entries
        .filter((entry) => entry?.type === "message")
        .map((entry) => entry.message)
        .filter(Boolean);
}

export function createContextCommand(statsTracker) {
    return {
        description: "Show a rough current-context breakdown and estimated DCP savings",
        handler: async (_args, ctx) => {
            const messages = getSessionMessages(ctx);
            const summary = summarizeContextMessages(messages);
            const pressureSummary = formatPressureSummary(analyzeConversationPressure(messages), { maxItems: 2 });
            const estimatedTokensSaved = (statsTracker.estimatedTokensPruned || 0) + (statsTracker.estimatedTokensRedacted || 0);
            const lines = [
                "DCP Context:",
                `  Messages: ${summary.totalMessages}`,
                `  Estimated current context: ${formatTokenEstimate(summary.estimatedTokens)} tokens`,
                `  user: ${summary.roles.user.messages} msgs / ${formatTokenEstimate(summary.roles.user.estimatedTokens)} tokens`,
                `  assistant: ${summary.roles.assistant.messages} msgs / ${formatTokenEstimate(summary.roles.assistant.estimatedTokens)} tokens`,
                `  toolResult: ${summary.roles.toolResult.messages} msgs / ${formatTokenEstimate(summary.roles.toolResult.estimatedTokens)} tokens`,
                summary.roles.other.messages > 0
                    ? `  other: ${summary.roles.other.messages} msgs / ${formatTokenEstimate(summary.roles.other.estimatedTokens)} tokens`
                    : undefined,
                `  Tool result payloads: ${formatTokenEstimate(summary.toolResultPayloadTokens)} tokens`,
                `  Estimated DCP savings this session: ${formatTokenEstimate(estimatedTokensSaved)} tokens`,
                pressureSummary ? `  Pressure summary: ${pressureSummary}` : undefined,
            ].filter(Boolean).join("\n");
            ctx.ui.notify(lines, "info");
        },
    };
}
