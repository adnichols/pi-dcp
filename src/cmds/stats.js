/**
 * DCP Stats Command
 *
 * Show pruning statistics for the current session.
 */
function formatTokenEstimate(tokens) {
    return `~${Math.round(tokens || 0)}`;
}

export function createStatsCommand(statsTracker, ruleCount) {
    return {
        description: "Show DCP pruning statistics for current session",
        handler: async (_args, ctx) => {
            const { totalPruned, totalProcessed } = statsTracker;
            const totalRedacted = statsTracker.totalRedacted || 0;
            const estimatedTokensPruned = statsTracker.estimatedTokensPruned || 0;
            const estimatedTokensRedacted = statsTracker.estimatedTokensRedacted || 0;
            const message = [
                `DCP Statistics:`,
                `  Total messages processed: ${totalProcessed}`,
                `  Total messages pruned: ${totalPruned}`,
                `  Total messages redacted: ${totalRedacted}`,
                `  Pruning rate: ${totalProcessed > 0 ? ((totalPruned / totalProcessed) * 100).toFixed(1) : 0}%`,
                `  Active rules: ${ruleCount}`,
                `  Estimated tokens pruned: ${formatTokenEstimate(estimatedTokensPruned)}`,
                `  Estimated tokens redacted: ${formatTokenEstimate(estimatedTokensRedacted)}`,
                `  Estimated total token savings: ${formatTokenEstimate(estimatedTokensPruned + estimatedTokensRedacted)}`,
                statsTracker.lastProcessed !== undefined
                    ? `  Last run: ${statsTracker.lastPruned || 0} pruned, ${statsTracker.lastRedacted || 0} redacted out of ${statsTracker.lastProcessed}`
                    : undefined,
                statsTracker.lastEstimatedTokensSaved !== undefined
                    ? `  Last run token savings: ${formatTokenEstimate(statsTracker.lastEstimatedTokensSaved)}`
                    : undefined,
                statsTracker.maxMessagesSeen !== undefined
                    ? `  Largest context seen: ${statsTracker.maxMessagesSeen} messages`
                    : undefined,
                statsTracker.lastPressureSummary
                    ? `  Last pressure summary: ${statsTracker.lastPressureSummary}`
                    : undefined,
                statsTracker.totalNudges !== undefined
                    ? `  Long-session nudges sent: ${statsTracker.totalNudges}`
                    : undefined,
                statsTracker.lastNudge?.summary
                    ? `  Last nudge: ${statsTracker.lastNudge.summary}`
                    : undefined,
            ].filter(Boolean).join("\n");
            ctx.ui.notify(message, "info");
        },
    };
}
